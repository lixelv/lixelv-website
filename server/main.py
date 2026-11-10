"""lixelv.com: the static site plus a small chat API.

The chat API proxies OpenRouter so the key never reaches the browser, and
gives each visitor a fixed number of messages per day.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
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
MODEL = os.environ.get("OPENROUTER_MODEL", "anthropic/claude-haiku-5.5").strip()
PROVIDER = os.environ.get("OPENROUTER_PROVIDER", "google-vertex/europe").strip()
DAILY_LIMIT = int(os.environ.get("CHAT_DAILY_LIMIT", "8"))
# A ceiling for everyone together, so rotating addresses cannot run up the bill. 0 turns it off.
GLOBAL_DAILY_LIMIT = int(os.environ.get("CHAT_GLOBAL_DAILY_LIMIT", "300"))
# Set to 1 only behind a reverse proxy you control: the visitor's address is then read from X-Forwarded-For.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"
SITE_URL = os.environ.get("SITE_URL", "https://lixelv.com").strip()
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))

MAX_USER_CHARS = 300
MAX_HISTORY = 10
MAX_TOKENS = 1000
SYSTEM_PROMPT = (Path(__file__).parent / "prompt.md").read_text(encoding="utf-8").strip()


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

    def take(self, address: str) -> int | None:
        """Spends one message. Returns how many are left, or None when the limit is reached."""
        day = self.today()
        who = self.who(address, day)
        with self.lock:
            self.db.execute("DELETE FROM usage WHERE day < ?", (day,))
            used = self._count(day, who)
            over_global = GLOBAL_DAILY_LIMIT and self._count(day, "*") >= GLOBAL_DAILY_LIMIT
            if used >= DAILY_LIMIT or over_global:
                self.db.commit()
                return None
            self._add(day, who, 1)
            self._add(day, "*", 1)
            self.db.commit()
            return DAILY_LIMIT - used - 1

    def refund(self, address: str) -> None:
        """Gives the message back when the model never answered."""
        day = self.today()
        with self.lock:
            self._add(day, self.who(address, day), -1)
            self._add(day, "*", -1)
            self.db.commit()


quota = Quota(DATA_DIR / "chat.sqlite3")
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


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)


@app.get("/api/chat/quota")
async def chat_quota(request: Request):
    return JSONResponse(
        {
            "configured": bool(API_KEY),
            "limit": DAILY_LIMIT,
            "remaining": quota.remaining(client_address(request)),
            "model": MODEL.split("/")[-1],
        },
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    if not API_KEY:
        return JSONResponse({"error": "not_configured"}, status_code=503)

    messages = body.messages[-MAX_HISTORY:]
    while messages and messages[0].role != "user":
        messages = messages[1:]
    if not messages or messages[-1].role != "user":
        return JSONResponse({"error": "bad_request", "detail": "the last message must be from the user"}, status_code=400)
    if len(messages[-1].content) > MAX_USER_CHARS:
        return JSONResponse({"error": "too_long", "limit": MAX_USER_CHARS}, status_code=400)

    address = client_address(request)
    left = quota.take(address)
    if left is None:
        reset = seconds_to_reset()
        return JSONResponse(
            {"error": "rate_limited", "limit": DAILY_LIMIT, "reset_in": reset},
            status_code=429,
            headers={"Retry-After": str(reset)},
        )

    payload: dict = {
        "model": MODEL,
        "stream": True,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *(m.model_dump() for m in messages)],
    }
    if PROVIDER:
        payload["provider"] = {"order": [PROVIDER], "allow_fallbacks": False}

    assert http is not None
    upstream_request = http.build_request(
        "POST",
        OPENROUTER_URL,
        json=payload,
        headers={"Authorization": f"Bearer {API_KEY}", "HTTP-Referer": SITE_URL, "X-Title": "lixelv.com"},
    )
    try:
        upstream = await http.send(upstream_request, stream=True)
    except httpx.HTTPError as exc:
        quota.refund(address)
        log.error("OpenRouter unreachable: %r", exc)
        return JSONResponse({"error": "upstream"}, status_code=502)

    if upstream.status_code != 200:
        detail = (await upstream.aread()).decode("utf-8", "replace")[:500]
        await upstream.aclose()
        quota.refund(address)
        log.error("OpenRouter answered %s: %s", upstream.status_code, detail)
        return JSONResponse({"error": "upstream"}, status_code=502)

    async def stream():
        try:
            async for line in upstream.aiter_lines():
                if not line.startswith("data:"):
                    continue  # keep-alive comments and blank lines
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    text = chunk["choices"][0]["delta"].get("content")
                except (ValueError, KeyError, IndexError, TypeError):
                    continue
                if text:
                    yield text
        except httpx.HTTPError as exc:
            log.error("OpenRouter stream broke: %r", exc)
        finally:
            await upstream.aclose()

    return StreamingResponse(
        stream(),
        media_type="text/plain; charset=utf-8",
        headers={"X-Chat-Remaining": str(left), "Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.exception_handler(StarletteHTTPException)
async def not_found(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404 and not request.url.path.startswith("/api/"):
        return FileResponse(SITE / "404.html", status_code=404)
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


app.mount("/", StaticFiles(directory=SITE, html=True), name="site")
