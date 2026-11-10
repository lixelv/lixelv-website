// GlassChat demo: a real model behind the glass. Messages go to this site's /api/chat,
// which holds the key, keeps answers about lixelv, and allows a few messages per day.
// The model also has tools (the "site" MCP server): when it calls one, mcp.js carries it out
// on this page and the result goes back, until the model answers in words.
import { $ } from '../util.js';
import { callTool } from './mcp.js';

const msgs = $('#gc-msgs'), form = $('#gc-form'), input = $('#gc-in'), chips = $('#gc-chips');
const quotaEl = $('#gc-quota'), modelEl = $('#gc-model'), mcpEl = $('#gc-mcp');
const SUGGESTIONS = ['What does he build?', 'Run some Python'];
const TOUR = '▶ Tour';
const MAX_ROUNDS = 8;            // model calls per message; the server allows fewer and has the last word
const history = [];              // what the model sees: [{role, content, tool_calls?, tool_call_id?}]
let busy = false, limit = 8, remaining = null, available = true;

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
    b.addEventListener('click', () => (s === TOUR ? tour() : send(s)));
    return b;
  }));
}
function setQuota() {
  if (!available) { quotaEl.textContent = ''; return; }
  if (remaining === null) { quotaEl.textContent = ''; return; }
  quotaEl.textContent = remaining > 0 ? `${remaining} of ${limit} messages left today` : `Daily limit reached (${limit} messages)`;
  quotaEl.classList.toggle('out', remaining <= 0);
  input.disabled = remaining <= 0;
  if (remaining <= 0) { input.placeholder = 'Back tomorrow'; setChips([TOUR]); }
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

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true; chips.replaceChildren();
  bubble('me', text);
  // Old turns are dropped whole, so a tool call never loses its result.
  while (history.length > 12) { history.shift(); while (history.length && history[0].role !== 'user') history.shift(); }
  const mark = history.length;
  history.push({ role: 'user', content: text });
  let reply = null, answer = '', turn = null;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      reply = typing(); answer = '';
      const res = await fetch('api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, turn }),
      });
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
      if (!calls.length) {
        if (!answer.trim()) throw Object.assign(new Error('empty'), { status: 502 });
        history.push({ role: 'assistant', content: answer });
        break;
      }
      if (!answer.trim()) reply.remove();
      reply = null;
      history.push({ role: 'assistant', content: answer, tool_calls: calls });
      for (const call of calls) {
        const row = toolRow(call.name);
        let args = {};
        try { args = JSON.parse(call.arguments); } catch { /* the tool will say what it is missing */ }
        const result = await callTool(call.name, args);
        row.classList.add('done');
        history.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      if (!turn) throw Object.assign(new Error('turn'), { status: 403 });
    }
  } catch (err) {
    history.length = mark;       // the model never saw this turn through
    if (!reply || !reply.isConnected) reply = bubble('ai note');
    reply.className = 'ai note';
    if (err.status === 429) { remaining = 0; setQuota(); reply.textContent = `That was the last one: ${limit} messages a day. The limit resets at midnight UTC.`; }
    else if (err.status === 503) reply.textContent = 'No API key is set on this server yet, so there is no model to answer.';
    else if (err.status === 400) reply.textContent = 'That message is too long. Try a shorter one.';
    else if (err.status === 403) reply.textContent = 'That took too long to finish. Ask again and I will pick it up.';
    else if (answer) reply.textContent = answer + ' …the connection dropped.';
    else reply.textContent = 'The chat server is not reachable right now.';
  }
  busy = false;
}

/** The same tools, driven by a script instead of the model: works offline and spends no message. */
async function tour() {
  if (busy) return;
  busy = true; chips.replaceChildren();
  bubble('ai note', 'A scripted tour: the same MCP tools, no model call, no message spent.');
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
  const calc = await act('And the calculator.', 'calculator_press', { keys: '6*7=' });
  const shown = /Display: ([^\s.(]+)/.exec(calc);
  bubble('ai', `${shown ? `6 × 7 = ${shown[1]}. ` : ''}That is the tour. Press Esc and I go back to my card.`);
  busy = false;
  setChips(available && remaining !== 0 ? SUGGESTIONS : []);
}

form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
setChips([...SUGGESTIONS, TOUR]);

bubble('ai', 'Hi! Ask me about lixelv: what he builds, his stack, or how to reach him.\nI am also wired into this page over MCP: I can run the other demos for you, take you to any section, and pin myself to the side while you watch.');

// Model name and today's quota come from the server; without it the widget says so.
fetch('api/chat/quota').then(r => r.ok ? r.json() : Promise.reject()).then(q => {
  limit = q.limit; remaining = q.remaining;
  modelEl.textContent = prettyModel(q.model) + ' ▾';
  if (q.tools) mcpEl.append(` · ${q.tools.length}`);
  if (!q.configured) { available = false; setChips([TOUR]); bubble('ai note', 'No API key is set on this server yet, so answers are off for now. The tour still works: it runs the tools without the model.'); }
  setQuota();
}).catch(() => {
  available = false; setChips([TOUR]);
  bubble('ai note', 'This copy of the site runs without its server, so the chat is offline. The tour still works: it runs the tools without the model.');
});
