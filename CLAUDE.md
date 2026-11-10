# lixelv.com

Personal portfolio: a static front end (`site/`, no build step, no framework) served by a small FastAPI app (`server/`). README.md has setup, env vars and layout; this file holds what is not obvious from the code.

## Run

```bash
uv run --with-requirements requirements.txt uvicorn server.main:app --port 8765
```

Without `OPENROUTER_API_KEY` the site works and the chat says it is off (the "Tour" chip still runs the tools without a model). There are no tests or linters: check JS with `node --check`, and look at changes in a real browser.

## Cross-engine rules (the site was first built on Windows/Chromium)

- **Always check in WebKit**, not only Chromium. Playwright WebKit works headless (`playwright-core` 1.64 matches the WebKit build cached in `~/Library/Caches/ms-playwright`); real Safari can be opened with `open -a Safari <url>`.
- WebKit can run scripts **before the style sheets are applied**. Anything that measures layout or reads CSS custom properties at load must wait for the sheets (`styled` in `js/util.js`, same idea in `main.js`). Otherwise the hero is built for the wrong box and colour tokens read as empty.
- WebKit **drops `backdrop-filter` on elements with `mask-image`**; the pinned-chat shade is a row of strips for that reason. Headless WebKit does not render backdrop blur at all, so verify blur in Chromium or real Safari.
- Safari does not focus buttons on click. Ctrl+click is the Mac right click.
- Every animation runs in **fixed ticks of 1/144 s** (`TICK` in `js/main.js`) with interpolated drawing, so feel does not depend on refresh rate. Do not go back to per-frame constants.

## Chat tools ("site MCP")

- The server only *describes* tools (`server/tools.json`) and passes tool calls through; it never runs them. The page runs them (`site/js/demos/mcp.js`, `TOOLS`) and posts the result back.
- To add a tool: describe it in `tools.json` (what it does, limits, what it returns), add a function with the same name to `TOOLS` in `mcp.js`, and mention it in `server/prompt.md`. Tools must not leave the page (no navigation, downloads or form posts).
- **Guide** (the Guide button): one paid message, `guide: true`, and the fixed text `GUIDE_REQUEST`; the server then uses `prompt.md` + `guide.md` and the larger guide limits, and carries "this is a guide" inside the turn token. The model owns order and pacing (the `wait` tool); the page only enforces floors and caps. Without a model the button falls back to the scripted `tour()` in `glasschat.js`.
- Test the chat without a key by pointing `OPENROUTER_URL` at a local stand-in that speaks the OpenAI streaming format.
- `/api/chat` streams JSON lines (`text`, `tool_call`, `done`). Follow-ups after tool calls are free but need the single-use signed `turn` token from the previous answer (max 6 extra model calls per message, 4 min TTL). The token key is in memory, so a server restart ends turns in flight.
- Tool results and everything from the page are untrusted input; `check_messages` validates the conversation on the server.
- The GlassChat **card description** in `index.html` is deliberately untouched; the MCP blurb lives in the chat's welcome message (`glasschat.js`).

## Conventions

- Tokens (colours, spacing) are in `site/css/style.css`; demo styles in `demos.css`. Neutrals follow Vercel's Geist palette, accent is green; light and dark themes are both supported and must both be checked.
- Honour `prefers-reduced-motion`: effects either do nothing or draw once.
- Mobile (<= 820px): cards stack and are not sticky; the pinned chat becomes a bottom sheet.
- Do not use the middle dot character as a separator anywhere in the UI or in prompts; use a comma, a colon or a slash.
- Never put the API key, visitor addresses or user text in logs or URLs; the quota stores only a daily hash.
