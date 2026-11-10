# lixelv.com

Personal site of lixelv: a static front end and a small FastAPI server.

The server does two things the page cannot do alone:

- **Chat API** for the GlassChat demo. It proxies OpenRouter, so the API key never reaches the browser, and limits each visitor to 8 messages a day.
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
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | Model the chat uses. |
| `OPENROUTER_PROVIDER` | `google-vertex/europe` | The only provider OpenRouter may route to. Empty lets OpenRouter choose. |
| `CHAT_DAILY_LIMIT` | `8` | Messages per visitor per day (UTC). |
| `CHAT_GLOBAL_DAILY_LIMIT` | `300` | Messages for all visitors together per day. `0` turns it off. |
| `TRUST_PROXY` | `0` | Set to `1` behind your own reverse proxy, so the visitor address comes from `X-Forwarded-For`. |
| `SITE_URL` | `https://lixelv.com` | Sent to OpenRouter as the referring site. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the message counter (SQLite) is kept. |

What the model is told about lixelv, and how it should answer, is in [`server/prompt.md`](server/prompt.md). Edit that file to change it.

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
    ionet.js         message pipeline: encryptor, transmitter, receiver, decryptor
    ionet-crypto.js  X25519 and ChaCha20
    calculator.js
```

## Notes on the demos

- **Polycode** downloads Pyodide from jsDelivr the first time a visitor clicks the editor or presses Run. Nothing is downloaded before that. User code runs only in the visitor's browser.
- **GlassChat** counts a message only when the model answers; a failed upstream call is refunded. The server stores a daily hash of the visitor address, not the address.
- **Ionet** runs real X25519 and ChaCha20 in the browser. It shows the idea of an Ionet session, not its exact wire format.
