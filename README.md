# lixelv.com

Personal site of lixelv: a static front end and a small FastAPI server.

The server does two things the page cannot do alone:

- **Chat API** for the GlassChat demo. It proxies OpenRouter, so the API key never reaches the browser, and limits each visitor to 8 messages a day. It also hands the model the tools of the site's MCP server (see below).
- **Cross-origin isolation headers** (COOP and COEP). The Polycode demo needs them so Python's `input()` can block on a `SharedArrayBuffer`.

## Run it

```bash
cp .env.example .env        # then put your OpenRouter key in it
docker compose up -d --build
```

Open http://localhost:8000. Use `PORT=9000 docker compose up -d --build` for another port.

Without Docker:

```bash
pip install -r requirements.txt
uvicorn server.main:app --port 8000
```

The site works without a key; the chat then says that it is switched off.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | none | Key for the chat. Without it `/api/chat` answers 503. |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | Model the chat uses. Unset or empty means the default. |
| `OPENROUTER_PROVIDER` | `google-vertex/europe` | The only provider OpenRouter may route to. Unset or empty means the default; `any` lets OpenRouter choose. |
| `CHAT_DAILY_LIMIT` | `8` | Messages per visitor per day (UTC). |
| `CHAT_GLOBAL_DAILY_LIMIT` | `300` | Messages for all visitors together per day. `0` turns it off. |
| `GUIDE_GLOBAL_DAILY_LIMIT` | `60` | Guides (the Guide button) for all visitors together per day. `0` turns it off. |
| `TRUST_PROXY` | `0` | Set to `1` behind your own reverse proxy, so the visitor address comes from `X-Forwarded-For`. |
| `SITE_URL` | `https://lixelv.com` | Sent to OpenRouter as the referring site. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the message counter (SQLite) is kept. |

What the model is told about lixelv, and how it should answer, is in [`server/prompt.md`](server/prompt.md). How it presents the site in a guide is in [`server/guide.md`](server/guide.md). Edit those files to change it.

## Behind Nginx

Set `TRUST_PROXY=1`, otherwise every visitor shares the proxy's address and one daily limit.

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;            # chat answers are streamed
}
```

`X-Forwarded-For` is set to `$remote_addr` on purpose: it replaces whatever the client sent, so the limit cannot be dodged with a forged header.

## Layout

```
server/
  main.py            FastAPI app: static files, /api/chat, /api/chat/quota, security headers
  prompt.md          system prompt for the chat
  guide.md           added to the prompt for a guide: how to present and pace
  tools.json         the tools the chat model may call (OpenAI function format)
site/
  index.html
  404.html
  css/style.css      page styles and design tokens
  css/demos.css      styles of the interactive demos
  js/main.js         theme, pixel-field hero, scroll effects
  js/util.js         helpers shared by the demos
  js/demos/
    controlhub.js    mini dashboard: pick a script, pick computers, run
    polycode.js      editor and console
    py-worker.js     Python (Pyodide) in a worker, ported from Polycode's runner
    glasschat.js     chat widget talking to /api/chat
    mcp.js           the chat's tools, carried out on the page: cursor, pinned mode, demo drivers
    ionet.js         message pipeline: encryptor, transmitter, receiver, decryptor
    ionet-crypto.js  X25519 and ChaCha20
    calculator.js
```

## Notes on the demos

- **Polycode** downloads Pyodide from jsDelivr the first time a visitor clicks the editor or presses Run. Nothing is downloaded before that. User code runs only in the visitor's browser.
- **GlassChat** counts a message only when the model answers; a failed upstream call is refunded. The server stores a daily hash of the visitor address, not the address.
- **GlassChat's tools** ("site MCP"). The model can scroll to any section, pin the chat to the side of the screen, run the four other demos, switch the theme and stir the hero. The tools: look (`get_page_state`, `read_section`), move (`go_to`, `scroll_by`), the chat window (`pin_chat`, `unpin_chat`), present (`highlight`, `caption`, `wait`), ControlHub (`controlhub_select`, `controlhub_run`), Polycode (`polycode_set_code`, `polycode_run`, `polycode_input`, `polycode_stop`), Ionet (`ionet_send`, `ionet_mode`, `ionet_reset`), Calculator (`calculator_press`, `calculator_clear`) and the page (`set_theme`, `hero_wave`, `hero_push`). None of them leaves the page. The server only describes the tools (`server/tools.json`) and never runs them: `/api/chat` answers with JSON lines (`text`, `tool_call`, `done`), the page carries a call out with a small cursor that presses the demos' real buttons (`js/demos/mcp.js`), and posts the result back. Those follow-up requests are free for the visitor; each needs the single-use `turn` token from the previous answer, which allows at most 6 more model calls per message and expires after 4 minutes. To add a tool, describe it in `tools.json` and add a function with the same name to `TOOLS` in `mcp.js`.
- **Guide.** The Guide button asks the model to present the demos by itself: it chooses the order, the tool calls and the pauses (the `wait` tool), following `server/guide.md`. A guide costs the visitor one message, may take up to 24 model calls with 6 tool calls each, and ends after 10 minutes at the latest. Stop, Esc, a click outside or a typed message ends it. After every demo tool the page holds for 0.6 s, so even a hasty model cannot rush. Without a model (no key, no server, no messages left) the button runs a short scripted tour with the same tools.
- **Motion** runs in fixed ticks of 1/144 s (`TICK` in `js/main.js`) and is drawn interpolated, so the hero, the dots behind the demos and the contact link feel the same at 60, 120 or 144 Hz.
- **Ionet** runs real X25519 and ChaCha20 in the browser. It shows the idea of an Ionet session, not its exact wire format.
