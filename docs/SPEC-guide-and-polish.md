# Spec: Guide mode, Ionet XOR, polish and two hero bugs

Status: approved and implemented with the defaults. Differences from the draft are listed in section 14.
Items marked **[?]** are open questions; each has a default that will be used if no answer comes.

## 0. Summary

| # | Item | Size | Touches |
|---|------|------|---------|
| 1 | "V" in lixelv looks different from the other letters | S | needs a look, see [?] |
| 2 | Ionet: drop two notes, show XOR as school column arithmetic | M | `ionet.js`, `demos.css`, `index.html` |
| 3 | **Guide** button: model-run, step-by-step demo tour in the chat | L | `glasschat.js`, `mcp.js`, `main.py`, `tools.json`, `prompt.md` |
| 4 | Model and provider from `.env`, defaults if unset | S | `main.py`, `.env.example`, README |
| 5 | Polycode: no cap on the amount of code | S | `mcp.js`, `tools.json`, check `polycode.js` |
| 6 | Full MCP toolset, each tool documented | L | `tools.json`, `mcp.js`, `prompt.md` |
| 7 | Guide timing: a `wait` tool and pacing rules | M | with 3 and 6 |
| 8 | Guide runs on Opus 5.5 | S | `.env` |
| 9 | Stop using the `·` character | S | 15 places in `site/`, the prompt |
| 10 | Footer links to github.com/lixelv instead of ControlHub | XS | `index.html` |
| 11 | Bug: wave colour comes back on a new right click | M | `main.js` |
| 12 | Bug: push outline jumps when page scroll stops | M | `main.js` |

## 1. The "V" in lixelv

Request: make the V in the text match the other letters.

What exists: "lixelv" appears in the nav brand, the hero (drawn as live dots from a 800-weight Geist glyph run) and the `github.com/lixelv` contact link (each letter on its own spring, `.big .c`). It is not clear from the code which one has an odd V.

**[?] Which text?** Default: check all three at 1x and 2x in WebKit and Chromium and fix whichever differs. Likely causes, in order: (a) hero: the V is a diagonal stroke, so the sampled dot grid shows it thinner or jagged next to vertical strokes; fix by sampling at higher resolution or biasing the threshold for diagonals; (b) contact link: a letter out of place shows a random glyph (`bigWave`), so a V can be stuck on a scramble glyph; (c) font fallback if Geist 800 lacks something. Acceptance: the V has the same weight, colour and baseline as its neighbours at rest, in both themes.

## 2. Ionet: columnar XOR

Remove:
- the note "N bytes to the socket" (`ionet.js:115`, transmitter);
- the note "each byte ⊕ a keystream byte" (`ionet.js:95`, encryptor).
- **[?]** The decryptor twin "each byte ⊕ the same keystream byte" (`ionet.js:151`) goes too, for consistency. Default: yes.

Replace the encryptor's three-row byte columns with school-style column arithmetic, as for long addition:

```
   0 1 1 0 1 0 0 0      plaintext byte   ("h" = 68)
 ⊕ 1 0 1 1 0 1 1 0      keystream byte
 ─────────────────
   1 1 0 1 1 1 1 0      ciphertext byte
```

Rules:
- Binary, 8 bits, right-aligned. Operator `⊕` sits where `+` would, left of the second row. A rule line under the second row. Hex of each row shown small at the right edge.
- The result is filled bit by bit, right to left, like column addition; each bit's cell pulses when written. A one-line caption says "no carry: each column stands alone" (XOR has none).
- With up to 14 bytes, one byte is large and animated at a time; the others are compact chips (hex) in a row above, the active one highlighted. Order: byte 1 to N, then all result chips are shown filled.
- The decryptor shows the same layout mirrored (ciphertext, keystream, plaintext), proving the symmetry.
- Timing follows the existing `sleep` pacing; total animation for a 14-byte message stays near the current length (about 4 s), so the per-byte animation is about 250 ms.
- `prefers-reduced-motion`: show all bytes' final rows without animation.
- Mobile (≤ 820px): the active byte block fits 320px; chips wrap.

Acceptance: for message "hello" the displayed results equal the real ChaCha20 output used for transmission; the removed strings no longer appear anywhere in `site/`.

## 3. Guide mode

A **Guide** button in GlassChat (replaces the scripted "▶ Tour" chip as the primary action; the scripted tour stays as the offline fallback, see 3.4).

### 3.1 Behaviour
1. Click: the chat pins left (existing `pin_chat`), the right side dims, the chat posts a short intro, and the model starts presenting.
2. The **model decides** the order, the tool calls and all timings. The page never hard-codes the script.
3. The model alternates: say what it is about to show (one short sentence), do it with a tool, **wait** so the visitor can follow, then say what just happened. One demo at a time; each demo's key effect gets time to be read.
4. The visitor can stop any time: Esc, a click outside the chat, or a **Stop** button that replaces Guide while it runs. Stopping aborts the stream, cancels pending waits and the ghost cursor, and the chat says it stopped.
5. If the visitor types during the guide, the guide pauses and the message is answered; afterwards the model may offer to continue.

### 3.2 Presentation-mode actions
The brief ends mid-sentence ("In presentation mode, ensure that the actions are …"). **[?]** Default reading: *every action is visible and understandable*: the ghost cursor always travels to the control before it acts, the target is highlighted with a ring while it works, the demo being driven is scrolled fully into view first, and no two actions overlap. Please confirm or complete the sentence.

### 3.3 Cost and limits
- A Guide costs the visitor **one** message of the daily quota (follow-up model calls stay free, as now).
- A guide needs a larger budget than a chat answer. New server limits for guide turns: more model rounds (default 24), more tool calls per answer (default 6), larger `max_tokens`, and a whole-guide ceiling of 10 minutes. Normal chat keeps today's limits (6 rounds, 4 calls).
- The `turn` token already refreshes its 240 s TTL each round, so long waits between rounds are fine as long as each single wait is shorter than the TTL.
- Opus is far more expensive than Haiku. **[?]** Default: guide uses the same daily quota as chat and the existing global cap (300/day) applies; propose a separate lower global cap for guides (default 60/day) via `GUIDE_GLOBAL_DAILY_LIMIT`.

### 3.4 Fallbacks
- No API key, server offline, quota spent, or upstream error: Guide falls back to the existing scripted tour with a note saying so.
- The model returns text with no tools: show it and end the guide.

### 3.5 Acceptance
- With a mock upstream, a guide with 10 tool calls and 6 waits runs end to end, stops cleanly on Esc, and on a failed tool call the model gets the error and carries on.
- Real-model run (needs the key and model from 4 and 8) shows a coherent walkthrough of all four demos.

## 4. Model and provider in `.env`

Already true: `OPENROUTER_MODEL` and `OPENROUTER_PROVIDER` are read from the environment/.env (`main.py:57-58`) with defaults `anthropic/claude-haiku-5.5` and `google-vertex/europe`. Gaps to close:
- A **blank** value (`OPENROUTER_MODEL=`) currently yields an empty string, not the default. Fix: unset or blank means the default.
- Today a blank provider means "let OpenRouter choose". With the new rule that meaning needs its own value: `OPENROUTER_PROVIDER=any`.
- `.env.example` and README document this, with the defaults written as comments.
- The server logs nothing about the model beyond what the quota endpoint already reports; the model name shown in the chat header follows the env value.

Acceptance: unset, blank and set values each produce the expected model/provider in the request body (unit-style check against a mock upstream).

## 5. Polycode: no cap on code

Found in code:
- The editor textarea itself has no `maxlength`. The only size caps in the Polycode path are the MCP `polycode_run` tool (`code` cut to 1200 chars, `mcp.js:229`, and the same figure in `tools.json`), the console output trim (40 000 characters, `polycode.js:50`) and `input()` stdin (64 KB).
- **[?]** Which limit do you mean? Default: all three are lifted. The MCP cap and its text in `tools.json` are removed (typing speed scales so a long program still types in a bounded time, e.g. fast-forward after 600 characters). The console keeps a safety trim at a much higher value (1 000 000 chars) so a runaway loop cannot freeze the tab. Stdin stays at 64 KB because it is a fixed `SharedArrayBuffer`; say if that should change.
- The editor box is a fixed 196 px high and scrolls; unchanged unless you want it to grow.

Acceptance: pasting 5 000 lines into the editor keeps highlighting responsive and runs; the model can submit a 3 000-character program.

## 6. Full MCP toolset

Principle: the model can do on the page whatever a visitor can, nothing that leaves the page (no external navigation, downloads or form posts). Every tool has a description that says what it does, its arguments and limits, what it returns, and when to use it. Existing: `go_to`, `pin_chat`, `controlhub_run`, `polycode_run`, `ionet_send`, `calculator_press`, `set_theme`, `hero_wave`.

Proposed set (grouped; existing ones may gain arguments):

| Group | Tool | Purpose |
|-------|------|---------|
| Navigation | `go_to` | any section anchor (exists) |
| | `scroll_by` | scroll up/down by a fraction of the viewport |
| | `get_page_state` | current section, theme, pinned or not, which demo is busy, visible text of the section |
| | `read_section` | return the text of a section so the model can describe it accurately |
| Chat layout | `pin_chat` / `unpin_chat` | dock left or release (the unpin tool is new) |
| Presenting | `highlight` | ring a named element or demo without clicking (a pointing finger) |
| | `caption` | a short on-screen label near the cursor ("now encrypting") |
| | `wait` | pause N seconds, see 7 |
| ControlHub | `controlhub_run` | pick script and computers, run (exists) |
| | `controlhub_select` | choose script and computers without running |
| Polycode | `polycode_set_code` | type code into the editor without running |
| | `polycode_run` | type and run (exists); returns output |
| | `polycode_stop` | stop a running program |
| | `polycode_input` | answer an `input()` prompt |
| Ionet | `ionet_send` | send a message (exists) |
| | `ionet_mode` | switch secure / plain |
| | `ionet_reset` | clear the session so the handshake can be shown again |
| Calculator | `calculator_press` | key sequence (exists) |
| | `calculator_clear` | clear the display |
| Theme | `set_theme` | light / dark / toggle (exists) |
| Hero | `hero_wave` | burst of rings (exists) |
| | `hero_push` | move the pointer through the hero along a path, to show the push-apart effect |

Each tool: JSON schema with `description`, argument descriptions, an `enum` where possible, a documented return string (short, capped), and an error return, never an exception. Cap arguments server side as today (`check_messages`). `server/prompt.md` gets a "how to use the tools" section; README and CLAUDE.md list the toolset.

**[?]** "All possible tools": the list above is my reading. Say if you want something else (e.g. opening the GitHub source links in a new tab, which I leave out by default because it leaves the page).

## 7. Guide timing and the `wait` tool

- `wait(seconds, reason)`: pauses the agent. `seconds` 0.5 to 8 (clamped). The page shows a subtle countdown ring on the tool row and the cursor rests. It resolves early when the visitor stops the guide. Returns "waited N s".
- The system prompt for guide turns says: after every visible action, wait long enough to read the result (about 1.5 s for a click, 3 to 5 s for an animation or a result with text); never chain two demos without a wait; narrate before and after; keep each text under two sentences.
- The page also enforces a floor: after any demo tool the page itself holds 600 ms before returning the result, so even a careless model cannot rush.
- The model chooses all pacing and tool order. The page enforces only the floors and caps above.

## 8. Opus 5.5

Set in `.env` only (`OPENROUTER_MODEL=anthropic/claude-opus-5.5`). Credits are already in your `.env`. **[?]** I do not see a `.env` in this checkout (it is git-ignored and not in the working directory), so I cannot edit it from here; I will update `.env.example`'s commented suggestion and tell you the line to change on the machine that has the real file. Also note the default provider `google-vertex/europe` may not serve Opus 5.5; if the first request fails, set `OPENROUTER_PROVIDER=any`.

## 9. Stop using `·`

Occurrences to replace (15):

| File | Now | Replace with |
|------|-----|--------------|
| `index.html:69` | `PocketBase · Go` | `PocketBase, Go` |
| `demos.css:180` | `content: " ·"` after tool name | a thin rule: border-right, or the word spacing alone |
| `controlhub.js:95,109,154` | `note · took…`, `how · client connected`, `5 clients connected · 1 offline` | comma or colon |
| `ionet.js:53,63,85,106,109,120,134,140` | `1 · Handshake`, `Encryptor · …` | `1. Handshake`, `Encryptor: …` |
| `polycode.js:78,133` | `Python 3.x · WebAssembly`, `Stopped · interpreter restarted` | comma or colon |
| `glasschat.js:168` | `site MCP · N` | `site MCP (N)` |

Also: `server/prompt.md` tells the model not to use `·` in answers. Acceptance: `grep -rn "·" site server` returns nothing.

## 10. Footer

`index.html:235`: replace `github.com/control-hub ↗` with `github.com/lixelv ↗` (same `target`/`rel`). Note the large contact link just above it already points to the same URL; the footer link will duplicate it. **[?]** Default: do as asked.

## 11. Bug: wave colour returns on a new right click

Cause hypothesis (`main.js` `draw`): colour is binary. A dot is accent coloured whenever its displacement exceeds `thr = gap * .45`, so a wave only "loses colour" because the dots stop being displaced, and a fresh right click instantly paints the full accent again, with no gradual ramp. A wave that has travelled far and weakened (its `p` strength drops with radius) still paints dots at full accent the moment they cross the threshold.

Needs reproduction first (WebKit and Chromium, held and tapped right button, before and after the previous wave died). Intended behaviour: colour is a continuous function of displacement, `mix(fg, accent, smoothstep(thr0, thr1, |displacement|))`, and a ring's colouring fades with its remaining strength, so a late or new click never starts from a hard full-accent state. Implementation note: batching by `fillStyle` (3 colours today) becomes N buckets (e.g. 8) to stay cheap.

Acceptance: record dot colour over time after release; no step jumps in the colour channel greater than a small epsilon per tick; a click after full decay starts from zero tint at the origin and ramps with strength.

**[?]** If the bug you see is different (for example the colour returning *while the old wave is still fading*), tell me; the plan above covers both.

## 12. Bug: push outline teleports when the page stops scrolling

Cause hypothesis: the pointer is stored in hero coordinates at the moment of the last `pointermove` (`setPointer`), using `getBoundingClientRect()` at that moment. While the page scrolls the cursor does not move, so no pointermove arrives; the hero slides under it but `mx, my` stay stale, so the push area stays at the old hero position. When scrolling stops, the browser fires a synthetic pointermove, the position is recomputed against the new scroll, and the outline jumps. A sharp bottom-to-top move makes the gap largest.

Fix: store the pointer in **client** coordinates and convert to hero coordinates every tick from the current `hero.getBoundingClientRect()` (or from `scrollY` deltas), so the push area follows the page while it scrolls. The sweep (`fmx, fmy`) is converted the same way so the swept path does not include the scroll distance. Also listen to `scroll` to keep the loop running while the pointer rests.

Acceptance: with a fixed cursor and scroll from the bottom to the top, the displaced-dots region stays centred on the cursor frame by frame, with no discontinuity when scrolling ends (checked by sampling the push centre per tick in WebKit and Chromium).

## 13. Process

1. Approve this spec and answer the **[?]** items (or accept the defaults).
2. Implement in this order: 9, 10, 4 (small, no risk), then 11, 12 (hero), 2 (Ionet), 5, then 6, 7, 3 (tools, wait, Guide), then 1.
3. Verify each in Chromium and WebKit, both themes, desktop and ≤ 820px; Guide with a mock upstream, and with the real model once `.env` has Opus.
4. Update README and CLAUDE.md (toolset, Guide, env rules). Commit on `main` in small commits.

## 14. As built

- Item 1: the odd "V" was in the contact link. `.big span:last-child` (meant for the arrow) also matched the last letter; the selector is now `.big > span:last-child`.
- Item 3: a typed message during a guide ends the guide and is answered next (it does not pause and resume).
- Item 11: the cause was different from the hypothesis. Rings were never removed, and past the fade distance their strength went negative, so a faded ring coloured the far corners again. Rings are now dropped when their strength reaches zero. The colour stays two-state.
- Item 12: the swept path still includes the scroll distance, because that is how the pointer really moved over the field.
- Not verified: a guide with a real model (only a scripted stand-in upstream), and anything in Chromium (no Chromium build for Playwright on this machine; checked in WebKit).
