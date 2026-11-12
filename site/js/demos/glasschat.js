// GlassChat demo: a real model behind the glass. Messages go to this site's /api/chat,
// which holds the key, keeps answers about lixelv, and allows a few messages per day.
// The model also has tools (the "site" MCP server): when it calls one, mcp.js carries it out
// on this page and the result goes back, until the model answers in words.
import { $ } from '../util.js';
import { callTool, hurry, pageState } from './mcp.js';

const msgs = $('#gc-msgs'), form = $('#gc-form'), input = $('#gc-in'), chips = $('#gc-chips');
const quotaEl = $('#gc-quota'), modelEl = $('#gc-model'), mcpEl = $('#gc-mcp'), sendBtn = $('button', form);
const SUGGESTIONS = ['What does he build?', 'Run some Python'];
const GUIDE = '▶ Guide', STOP = '■ Stop';
const MAX_ROUNDS = 8, GUIDE_ROUNDS = 26;   // model calls per message; the server allows fewer and has the last word
const history = [];              // what the model sees: [{role, content, tool_calls?, tool_call_id?}]
let busy = false, limit = 8, remaining = null, available = true;
let outShown = false, outForAll = false;   // the "no messages left" note is said once; outForAll: the shared ceiling, not the visitor's own
// The Guide button: the model presents the demos by itself, choosing the tools and the pauses.
let guideText = 'Give me the guided tour.', guiding = false, stopping = false, abort = null, pending = null;

function bubble(role, text = '') {
  const p = document.createElement('p');
  p.className = role;
  p.textContent = text;
  msgs.append(p);
  msgs.scrollTop = msgs.scrollHeight;
  return p;
}
function typing() {
  const p = bubble('ai typing');
  p.innerHTML = '<i></i><i></i><i></i>';
  return p;
}
/** A tool call, shown the way the app shows it: server, tool, and a mark when it is done. */
function toolRow(name) {
  const p = bubble('tool');
  p.innerHTML = '<i></i><b>site</b>';
  p.append(name);
  return p;
}
function setChips(list) {
  chips.replaceChildren(...list.map(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s;
    if (s === GUIDE || s === STOP) b.className = 'main';
    b.addEventListener('click', () => (s === GUIDE ? guide() : s === STOP ? stop() : send(s)));
    return b;
  }));
}
/** Until the quota resets at midnight UTC (the server counts by UTC day), in words. */
function untilReset() {
  const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const min = Math.ceil((next - now) / 60000);
  return min < 60 ? `in ${min} min` : `in about ${Math.round(min / 60)} h`;
}
function setQuota() {
  if (!available) { quotaEl.textContent = ''; return; }
  if (remaining === null) { quotaEl.textContent = ''; return; }
  const out = remaining <= 0;
  quotaEl.textContent = out ? `No messages left today, back ${untilReset()}` : `${remaining} of ${limit} messages left today`;
  quotaEl.classList.toggle('out', out);
  // The chat cannot take a message any more: say so in the field, and switch the field off.
  input.disabled = sendBtn.disabled = out;
  form.classList.toggle('off', out);
  input.placeholder = out ? 'Daily limit reached' : 'Ask about lixelv';
  if (!out) return;
  if (!busy) setChips([GUIDE]);
  if (!outShown && !busy) {
    outShown = true;
    bubble('ai note', outForAll
      ? `The chat has used its daily budget for all visitors, so it is off until midnight UTC (${untilReset()}). Guide still works: it runs the tools from a script, without the model.`
      : `You have used all ${limit} messages for today. The chat opens again at midnight UTC (${untilReset()}). Guide still works: it runs the tools from a script, without the model.`);
  }
}
function prettyModel(id) {       // "claude-haiku-5.5" -> "Claude Haiku 5.5"
  return id.split('-').map(w => /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
}
/** Reads the answer: one JSON object per line. */
async function readEvents(body, on) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i; (i = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(i + 1)) {
      const line = buffer.slice(0, i).trim();
      if (line) on(JSON.parse(line));
    }
  }
}

/** Ends a running guide: the answer in flight is dropped, a pause is cut short, the rest is skipped. */
function stop() {
  if (!guiding || stopping) return;
  stopping = true; hurry();
  if (abort) abort.abort();
}
addEventListener('chat:released', stop);       // Esc, or a click outside the chat and the demos

function guide() {
  if (busy) return;
  // No model to present (no key, no server, no messages left): the scripted tour does it.
  if (!available || remaining === 0) return tour();
  return send(guideText, true);
}

async function send(text, asGuide = false) {
  text = text.trim();
  if (!text) return;
  if (busy) {                    // a message typed during a guide ends the guide and is answered next
    if (guiding) { pending = text; stop(); }
    return;
  }
  busy = true; guiding = asGuide; stopping = false;
  if (asGuide) {
    setChips([STOP]);
    bubble('ai note', 'Guide: I present the demos myself, live. Stop, Esc or a message of yours ends it.');
    history.length = 0;          // a guide is one long turn and starts clean
  } else {
    chips.replaceChildren();
    bubble('me', text);
    // Old turns are dropped whole, so a tool call never loses its result.
    while (history.length > 40) { history.shift(); while (history.length && history[0].role !== 'user') history.shift(); }
  }
  const mark = history.length;
  history.push({ role: 'user', content: text });
  let reply = null, answer = '', turn = null, spoke = false;
  try {
    for (let round = 0, rounds = asGuide ? GUIDE_ROUNDS : MAX_ROUNDS; round < rounds && !stopping; round++) {
      reply = typing(); answer = '';
      abort = new AbortController();
      const page = (await pageState()).slice(0, 2400);   // what the page shows right now, read fresh on every round
      const ask = () => fetch('api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ messages: history, turn, guide: asGuide, page }),
      });
      // The first request after a quiet spell can fail on the way (a dropped connection, a 502).
      // The server has refunded the message, so one more try costs nothing.
      let res = await ask().catch(err => (err.name === 'AbortError' ? Promise.reject(err) : null));
      if (!res || res.status === 502 || res.status === 504) { await new Promise(r => setTimeout(r, 600)); if (!stopping) res = await ask(); }
      if (!res.ok || !res.body) throw Object.assign(new Error('chat'), { status: res.status });
      const left = res.headers.get('X-Chat-Remaining');
      if (left !== null) { remaining = +left; setQuota(); }
      const calls = [];
      let finished = false;
      turn = null;
      await readEvents(res.body, ev => {
        if (ev.type === 'text') {
          answer += ev.text;
          reply.className = 'ai'; reply.textContent = answer;
          msgs.scrollTop = msgs.scrollHeight;
        } else if (ev.type === 'tool_call') calls.push({ id: ev.id, name: ev.name, arguments: ev.arguments || '{}' });
        else if (ev.type === 'done') { finished = true; turn = ev.turn || null; }
      });
      if (!finished) throw Object.assign(new Error('dropped'), { status: 0 });
      spoke = true;
      if (!calls.length) {
        if (!answer.trim()) throw Object.assign(new Error('empty'), { status: 502 });
        history.push({ role: 'assistant', content: answer });
        break;
      }
      if (!answer.trim()) reply.remove();
      reply = null;
      history.push({ role: 'assistant', content: answer, tool_calls: calls });
      for (const call of calls) {
        if (stopping) { history.push({ role: 'tool', tool_call_id: call.id, content: 'Not done: the visitor stopped the guide.' }); continue; }
        const row = toolRow(call.name);
        let args = {};
        try { args = JSON.parse(call.arguments); } catch { /* the tool will say what it is missing */ }
        if (call.name === 'wait') { row.classList.add('wait'); row.style.setProperty('--wait', `${Math.min(8, Math.max(.5, +args.seconds || 2))}s`); }
        const result = await callTool(call.name, args);
        row.classList.add('done');
        history.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      if (!turn && !stopping) throw Object.assign(new Error('turn'), { status: 403 });
    }
  } catch (err) {
    if (reply && reply.isConnected && !(stopping && answer)) reply.remove();
    if (!stopping) {
      history.length = mark;     // the model never saw this turn through
      reply = bubble('ai note');
      if (err.status === 429) {
        // The server says 429 for the visitor's own limit and for the shared one. With messages
        // still left on the counter, it was the shared one.
        outForAll = remaining !== null && remaining > 0;
        remaining = 0; reply.remove(); reply = null;   // setQuota, below, explains it once
      } else if (err.status === 503) reply.textContent = 'No API key is set on this server yet, so there is no model to answer.';
      else if (err.status === 400) reply.textContent = 'That message is too long. Try a shorter one.';
      else if (err.status === 403) reply.textContent = 'That took too long to finish. Ask again and I will pick it up.';
      else if (answer) reply.textContent = answer + ' …the connection dropped.';
      else reply.textContent = 'The chat server is not reachable right now.';
    }
  }
  abort = null;
  const fallBack = asGuide && !spoke && !stopping;       // the model never got going: the script presents instead
  if (stopping) {
    // What was said and done stays in the history, so the model knows where the guide ended.
    if (history.length === mark + 1) history.length = mark;
    else if (history[history.length - 1].role !== 'assistant') history.push({ role: 'assistant', content: '(The visitor stopped the guide here.)' });
    bubble('ai note', 'Guide stopped.');
  }
  busy = guiding = stopping = false;
  setQuota();
  if (fallBack) return tour();
  if (asGuide || !chips.children.length) setChips(available && remaining !== 0 ? [...SUGGESTIONS, GUIDE] : [GUIDE]);
  if (pending) { const next = pending; pending = null; send(next); }
}

/** The same tools, driven by a script instead of the model: works offline and spends no message. */
async function tour() {
  if (busy) return;
  busy = true; chips.replaceChildren();
  bubble('ai note', 'A scripted tour, because the model is not available right now: the same MCP tools, no message spent.');
  const act = async (say, name, args) => {
    bubble('ai', say);
    const row = toolRow(name), result = await callTool(name, args);
    row.classList.add('done');
    return result;
  };
  await act('First I pin myself to the side, so you can watch me work.', 'pin_chat', { pinned: true });
  await act('ControlHub: one script, four computers.', 'controlhub_run', { script: 'run_program', computers: [1, 2, 3, 4] });
  // input() needs cross-origin isolation (see polycode.js); without it the tour sticks to print().
  await act('Polycode: real Python, running in your tab.', 'polycode_run', self.crossOriginIsolated
    ? { code: 'name = input("Who is this? ")\nfor i in range(1, 4):\n    print(name * i)', stdin: ['lixelv '] }
    : { code: 'for i in range(1, 4):\n    print("lixelv " * i)' });
  await act('Ionet: a message through a real key exchange and a real cipher.', 'ionet_send', { message: 'hi, lixelv', encrypt: true });
  // The Calculator card is hidden (index.html), so the tour no longer ends on it:
  // const calc = await act('And the calculator.', 'calculator_press', { keys: '6*7=' });
  // const shown = /Display: ([^\s.(]+)/.exec(calc);
  // bubble('ai', `${shown ? `6 × 7 = ${shown[1]}. ` : ''}That is the tour. Press Esc and I go back to my card.`);
  bubble('ai', 'That is the tour. Press Esc and I go back to my card.');
  busy = false;
  setChips(available && remaining !== 0 ? [...SUGGESTIONS, GUIDE] : [GUIDE]);
}

form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
setChips([...SUGGESTIONS, GUIDE]);

bubble('ai', 'Hi! Ask me about lixelv: what he builds, his stack, or how to reach him.\nI am also wired into this page over MCP: I can run the other demos for you, take you to any section, and pin myself to the side while you watch. Press Guide and I will show you around.');

// Model name and today's quota come from the server; without it the widget says so.
fetch('api/chat/quota').then(r => r.ok ? r.json() : Promise.reject()).then(q => {
  limit = q.limit; remaining = q.remaining;
  modelEl.textContent = prettyModel(q.model) + ' ▾';
  if (q.tools) mcpEl.append(` (${q.tools.length})`);
  if (q.guide) guideText = q.guide;
  if (!q.configured) { available = false; setChips([GUIDE]); bubble('ai note', 'No API key is set on this server yet, so answers are off for now. Guide still works: it runs the tools from a script, without the model.'); }
  setQuota();
}).catch(() => {
  available = false; setChips([GUIDE]);
  bubble('ai note', 'This copy of the site runs without its server, so the chat is offline. Guide still works: it runs the tools from a script, without the model.');
});
