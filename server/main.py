"""lixelv.com: the static site plus a small chat API.

The chat API proxies OpenRouter so the key never reaches the browser, and
gives each visitor a fixed number of messages per day.

The model is also given tools (tools.json). The server never runs them: a tool
call is passed to the page, the page carries it out (it drives the demos) and
posts the result back, and the model goes on. Those follow-up requests do not
cost the visitor a message; a short-lived signed token ties them to the message
that started the turn.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
log = logging.getLogger("lixelv")


def load_env(path: Path) -> None:
    """Reads KEY=VALUE lines from .env without overriding the real environment."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env(ROOT / ".env")

OPENROUTER_URL = os.environ.get("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions").strip()
API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()


def env(name: str, default: str) -> str:
    """A variable that is not set, or is set to nothing, means the default."""
    return os.environ.get(name, "").strip() or default


MODEL = env("OPENROUTER_MODEL", "anthropic/claude-haiku-5.5")
# The only provider OpenRouter may route to. "any" lets OpenRouter choose.
PROVIDER = env("OPENROUTER_PROVIDER", "google-vertex/europe")
if PROVIDER.lower() in {"any", "auto"}:
    PROVIDER = ""
DAILY_LIMIT = int(os.environ.get("CHAT_DAILY_LIMIT", "8"))
# A ceiling for everyone together, so rotating addresses cannot run up the bill. 0 turns it off.
GLOBAL_DAILY_LIMIT = int(os.environ.get("CHAT_GLOBAL_DAILY_LIMIT", "300"))
# Set to 1 only behind a reverse proxy you control: the visitor's address is then read from X-Forwarded-For.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
SITE_URL = os.environ.get("SITE_URL", "https://lixelv.com").strip()
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))

# Guides (the Guide button: the model presents the demos) are long turns on what may be an expensive
# model, so they have their own ceiling for everyone together. 0 turns it off.
GUIDE_GLOBAL_DAILY_LIMIT = int(env("GUIDE_GLOBAL_DAILY_LIMIT", "60"))

MAX_USER_CHARS = 300
MAX_HISTORY = 180  # tool calls and their results are messages too, and a guide is one long turn
MAX_TOKENS = 2000
MAX_TOOL_ROUNDS = 6  # model calls one visitor message may lead to after the first
MAX_TOOL_CALLS = 4  # tool calls accepted from one model answer
GUIDE_TOOL_ROUNDS = 24  # the same two limits for a guide
GUIDE_TOOL_CALLS = 6
GUIDE_SECONDS = 600  # a guide may go on for this long after it started
GUIDE_REQUEST = "Give me the guided tour."  # what the Guide button sends as the visitor's message
TURN_TTL = 240  # seconds a page has to run the tools and come back
SYSTEM_PROMPT = (Path(__file__).parent / "prompt.md").read_text(encoding="utf-8").strip()
GUIDE_PROMPT = SYSTEM_PROMPT + "\n\n" + (Path(__file__).parent / "guide.md").read_text(encoding="utf-8").strip()
TOOLS: list[dict] = json.loads((Path(__file__).parent / "tools.json").read_text(encoding="utf-8"))
TOOL_NAMES = {tool["function"]["name"] for tool in TOOLS}


class Quota:
    """Counts messages per visitor per UTC day. Stores a hash, never the address."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute("CREATE TABLE IF NOT EXISTS usage (day TEXT, who TEXT, n INTEGER NOT NULL, PRIMARY KEY (day, who))")
        self.db.commit()

    @staticmethod
    def today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @staticmethod
    def who(address: str, day: str) -> str:
        return hashlib.sha256(f"{day}:{address}".encode()).hexdigest()[:32]

    def _count(self, day: str, who: str) -> int:
        row = self.db.execute("SELECT n FROM usage WHERE day = ? AND who = ?", (day, who)).fetchone()
        return row[0] if row else 0

    def _add(self, day: str, who: str, by: int) -> None:
        self.db.execute(
            "INSERT INTO usage (day, who, n) VALUES (?, ?, MAX(?, 0)) "
            "ON CONFLICT (day, who) DO UPDATE SET n = MAX(n + ?, 0)",
            (day, who, by, by),
        )

    def remaining(self, address: str) -> int:
        day = self.today()
        with self.lock:
            return max(DAILY_LIMIT - self._count(day, self.who(address, day)), 0)

    def take(self, address: str, guide: bool = False) -> int | None:
        """Spends one message. Returns how many are left, or None when a limit is reached."""
        day = self.today()
        who = self.who(address, day)
        with self.lock:
            self.db.execute("DELETE FROM usage WHERE day < ?", (day,))
            used = self._count(day, who)
            over_global = GLOBAL_DAILY_LIMIT and self._count(day, "*") >= GLOBAL_DAILY_LIMIT
            over_guides = guide and GUIDE_GLOBAL_DAILY_LIMIT and self._count(day, "*guide") >= GUIDE_GLOBAL_DAILY_LIMIT
            if used >= DAILY_LIMIT or over_global or over_guides:
                self.db.commit()
                return None
            self._add(day, who, 1)
            self._add(day, "*", 1)
            if guide:
                self._add(day, "*guide", 1)
            self.db.commit()
            return DAILY_LIMIT - used - 1

    def follow_up(self) -> bool:
        """Counts a tool follow-up call against its own ceiling for everyone together."""
        if not GLOBAL_DAILY_LIMIT:
            return True
        day = self.today()
        with self.lock:
            if self._count(day, "*tools") >= GLOBAL_DAILY_LIMIT * MAX_TOOL_ROUNDS + GUIDE_GLOBAL_DAILY_LIMIT * GUIDE_TOOL_ROUNDS:
                return False
            self._add(day, "*tools", 1)
            self.db.commit()
            return True

    def refund(self, address: str, guide: bool = False) -> None:
        """Gives the message back when the model never answered."""
        day = self.today()
        with self.lock:
            self._add(day, self.who(address, day), -1)
            self._add(day, "*", -1)
            if guide:
                self._add(day, "*guide", -1)
            self.db.commit()


class Turns:
    """Signed, single-use tokens that let a page continue a turn after running tools.

    A token says: this visitor may make `left` more model calls for the message they
    already paid for. The key lives in memory, so a restart ends the turns in flight.
    """

    def __init__(self) -> None:
        self.key = secrets.token_bytes(32)
        self.used: dict[str, int] = {}  # signature -> expiry
        self.lock = threading.Lock()

    def _sign(self, who: str, body: str) -> str:
        return hmac.new(self.key, f"{who}.{body}".encode(), hashlib.sha256).hexdigest()[:40]

    def issue(self, who: str, left: int, guide: bool, born: int) -> str:
        """`born`: when the visitor's message arrived; a guide may not outlive GUIDE_SECONDS from then."""
        body = f"{int(time.time()) + TURN_TTL}.{left}.{'g' if guide else 'c'}.{born}.{secrets.token_hex(6)}"
        return f"{body}.{self._sign(who, body)}"

    def redeem(self, who: str, token: str) -> tuple[int, bool, int] | None:
        """Returns (model calls the token still allows, is it a guide, when the turn began), or None if it is not valid."""
        try:
            expires, left, kind, born, nonce, signature = token.split(".")
            expires_at, calls_left, born_at = int(expires), int(left), int(born)
        except ValueError:
            return None
        now = int(time.time())
        if expires_at < now or calls_left < 1 or kind not in ("g", "c") or born_at + GUIDE_SECONDS < now:
            return None
        if not hmac.compare_digest(signature, self._sign(who, f"{expires}.{left}.{kind}.{born}.{nonce}")):
            return None
        with self.lock:
            for old in [s for s, exp in self.used.items() if exp < now]:
                del self.used[old]
            if signature in self.used:
                return None
            self.used[signature] = expires_at
        return calls_left, kind == "g", born_at


quota = Quota(DATA_DIR / "chat.sqlite3")
turns = Turns()
http: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global http
    http = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    if not API_KEY:
        log.warning("OPENROUTER_API_KEY is not set: /api/chat will answer 503")
    yield
    await http.aclose()


app = FastAPI(title="lixelv.com", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

CSP = "; ".join(
    [
        "default-src 'self'",
        # Pyodide (the Polycode demo) is loaded from jsDelivr inside a worker and compiles WebAssembly.
        "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' https://cdn.jsdelivr.net https://pypi.org https://files.pythonhosted.org",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ]
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    # Cross-origin isolation: lets the Python worker block on input() through a SharedArrayBuffer.
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    h["Cross-Origin-Embedder-Policy"] = "require-corp"
    h["Cross-Origin-Resource-Policy"] = "same-origin"
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "strict-origin-when-cross-origin"
    h["Content-Security-Policy"] = CSP
    # Always revalidate the page's own files (they carry an ETag, so this costs a 304). Without it
    # a browser may pair a cached script with a newer one that imports from it; Safari is keen on that.
    h.setdefault("Cache-Control", "no-cache")
    return response


def client_address(request: Request) -> str:
    if TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def seconds_to_reset() -> int:
    now = datetime.now(timezone.utc)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((midnight - now).total_seconds())


class ToolCall(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=40)
    arguments: str = Field(default="{}", max_length=60_000)  # a program for Polycode may be long


class Message(BaseModel):
    role: Literal["user", "assistant", "tool"]
    content: str = Field(default="", max_length=4000)
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=GUIDE_TOOL_CALLS)
    tool_call_id: str | None = Field(default=None, max_length=120)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=240)
    turn: str | None = Field(default=None, max_length=200)
    guide: bool = False  # the Guide button: counts only on a new message, a follow-up carries it in its token


def check_messages(messages: list[Message]) -> str | None:
    """Returns what is wrong with the conversation, or None. It comes from the page, so nothing in it is trusted."""
    asked: set[str] = set()  # ids of tool calls the assistant made and nobody answered yet
    for m in messages:
        if m.role == "tool":
            if m.tool_call_id not in asked:
                return "a tool result without its call"
            asked.discard(m.tool_call_id)
            continue
        if asked:
            return "a tool call without its result"
        if m.role == "assistant" and m.tool_calls:
            if any(call.name not in TOOL_NAMES for call in m.tool_calls):
                return "unknown tool"
            asked = {call.id for call in m.tool_calls}
        elif not m.content.strip():
            return "an empty message"
        elif m.tool_calls or m.tool_call_id:
            return "tool fields on the wrong message"
    return "a tool call without its result" if asked else None


def to_openai(m: Message) -> dict:
    if m.role == "tool":
        return {"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content or "(no output)"}
    if m.role == "assistant" and m.tool_calls:
        calls = [{"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments or "{}"}} for c in m.tool_calls]
        return {"role": "assistant", "content": m.content or None, "tool_calls": calls}
    return {"role": m.role, "content": m.content}


def event(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


@app.get("/api/chat/quota")
async def chat_quota(request: Request):
    return JSONResponse(
        {
            "configured": bool(API_KEY),
            "limit": DAILY_LIMIT,
            "remaining": quota.remaining(client_address(request)),
            "model": MODEL.split("/")[-1],
            "tools": sorted(TOOL_NAMES),
            "guide": GUIDE_REQUEST,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    """Answers as a stream of JSON lines: {"type": "text"}, then any {"type": "tool_call"}, then {"type": "done"}."""
    if not API_KEY:
        return JSONResponse({"error": "not_configured"}, status_code=503)

    messages = body.messages[-MAX_HISTORY:]
    while messages and messages[0].role != "user":
        messages = messages[1:]
    problem = "no user message" if not messages else check_messages(messages)
    if problem:
        return JSONResponse({"error": "bad_request", "detail": problem}, status_code=400)
    last = messages[-1]
    if last.role == "assistant":
        return JSONResponse({"error": "bad_request", "detail": "the last message must be from the user or a tool"}, status_code=400)

    address = client_address(request)
    who = quota.who(address, quota.today())
    paid = last.role == "user"  # a new message from the visitor; otherwise the page is returning tool results
    if paid:
        if len(last.content) > MAX_USER_CHARS:
            return JSONResponse({"error": "too_long", "limit": MAX_USER_CHARS}, status_code=400)
        guide = body.guide and last.content.strip() == GUIDE_REQUEST
        born = int(time.time())
        left = quota.take(address, guide)
        if left is None:
            reset = seconds_to_reset()
            return JSONResponse(
                {"error": "rate_limited", "limit": DAILY_LIMIT, "reset_in": reset},
                status_code=429,
                headers={"Retry-After": str(reset)},
            )
        rounds = GUIDE_TOOL_ROUNDS if guide else MAX_TOOL_ROUNDS
    else:
        allowed = turns.redeem(who, body.turn or "")
        if allowed is None or not quota.follow_up():
            return JSONResponse({"error": "turn_expired"}, status_code=403)
        rounds, guide, born = allowed[0] - 1, allowed[1], allowed[2]
        left = quota.remaining(address)
    max_calls = GUIDE_TOOL_CALLS if guide else MAX_TOOL_CALLS

    payload: dict = {
        "model": MODEL,
        "stream": True,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "system", "content": GUIDE_PROMPT if guide else SYSTEM_PROMPT}, *(to_openai(m) for m in messages)],
        # The tools stay in the request even on the last round (the conversation refers to them); the model is just told not to call any.
        "tools": TOOLS,
        "tool_choice": "auto" if rounds > 0 else "none",
    }
    if PROVIDER:
        payload["provider"] = {"order": [PROVIDER], "allow_fallbacks": False}

    def refund() -> None:
        if paid:
            quota.refund(address, guide)

    assert http is not None
    upstream_headers = {"Authorization": f"Bearer {API_KEY}", "HTTP-Referer": SITE_URL, "X-Title": "lixelv.com"}
    # The first call can fail (a slow connect, a provider rate-limited for a moment): try again, with a
    # short pause, up to three times before giving up, so the visitor does not have to send the message twice.
    upstream = None
    for attempt in (1, 2, 3):
        if attempt > 1:
            await asyncio.sleep(0.8 * (attempt - 1))  # a shared rate limit needs a moment, not an instant retry
        try:
            upstream = await http.send(http.build_request("POST", OPENROUTER_URL, json=payload, headers=upstream_headers), stream=True)
        except httpx.HTTPError as exc:
            log.error("OpenRouter unreachable (attempt %d): %r", attempt, exc)
            upstream = None
            continue
        if upstream.status_code == 200:
            break
        detail = (await upstream.aread()).decode("utf-8", "replace")[:500]
        await upstream.aclose()
        log.error("OpenRouter answered %s (attempt %d): %s", upstream.status_code, attempt, detail)
        retry = upstream.status_code >= 500 or upstream.status_code in (408, 429)
        upstream = None
        if not retry:
            break
    if upstream is None:
        refund()
        return JSONResponse({"error": "upstream"}, status_code=502)

    async def stream():
        calls: dict[int, dict] = {}  # tool calls arrive in pieces, keyed by their index
        try:
            async for line in upstream.aiter_lines():
                if not line.startswith("data:"):
                    continue  # keep-alive comments and blank lines
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta") or {}
                except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                    continue
                text = delta.get("content")
                if text and isinstance(text, str):
                    yield event({"type": "text", "text": text})
                for piece in delta.get("tool_calls") or []:
                    try:
                        call = calls.setdefault(int(piece.get("index") or 0), {"id": "", "name": "", "arguments": ""})
                        function = piece.get("function") or {}
                        call["id"] = piece.get("id") or call["id"]
                        call["name"] = function.get("name") or call["name"]
                        call["arguments"] += function.get("arguments") or ""
                    except (TypeError, ValueError, AttributeError):
                        continue
        except httpx.HTTPError as exc:
            log.error("OpenRouter stream broke: %r", exc)
            yield event({"type": "error"})
            return
        finally:
            await upstream.aclose()

        wanted = [c for _, c in sorted(calls.items()) if c["id"] and c["name"] in TOOL_NAMES][:max_calls] if rounds > 0 else []
        for call in wanted:
            yield event({"type": "tool_call", **call})
        done: dict = {"type": "done"}
        if wanted:
            done["turn"] = turns.issue(who, rounds, guide, born)
        yield event(done)

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"X-Chat-Remaining": str(left), "Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.exception_handler(StarletteHTTPException)
async def not_found(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and not request.url.path.startswith("/api/"):
        return FileResponse(SITE / "404.html", status_code=404)
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


app.mount("/", StaticFiles(directory=SITE, html=True), name="site")
