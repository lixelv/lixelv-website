// GlassChat demo: a real model behind the glass. Messages go to this site's /api/chat,
// which holds the key, keeps answers about lixelv, and allows a few messages per day.
import { $ } from '../util.js';

const msgs = $('#gc-msgs'), form = $('#gc-form'), input = $('#gc-in'), chips = $('#gc-chips');
const quotaEl = $('#gc-quota'), modelEl = $('#gc-model');
const SUGGESTIONS = ['What does he build?', 'What is ControlHub?', 'How do I reach him?'];
const history = [];              // what the model sees: [{role, content}]
let busy = false, limit = 8, remaining = null, available = true;

function bubble(role, text = '') {
  const p = document.createElement('p');
  p.className = role;
  p.textContent = text;
  msgs.append(p);
  msgs.scrollTop = msgs.scrollHeight;
  return p;
}
function setQuota() {
  if (!available) { quotaEl.textContent = ''; return; }
  if (remaining === null) { quotaEl.textContent = ''; return; }
  quotaEl.textContent = remaining > 0 ? `${remaining} of ${limit} messages left today` : `Daily limit reached (${limit} messages)`;
  quotaEl.classList.toggle('out', remaining <= 0);
  input.disabled = remaining <= 0;
  if (remaining <= 0) { input.placeholder = 'Back tomorrow'; chips.replaceChildren(); }
}
function prettyModel(id) {       // "claude-haiku-5.5" -> "Claude Haiku 5.5"
  return id.split('-').map(w => /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true; chips.replaceChildren();
  bubble('me', text);
  history.push({ role: 'user', content: text });
  const reply = bubble('ai typing');
  reply.innerHTML = '<i></i><i></i><i></i>';
  let answer = '';
  try {
    const res = await fetch('api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-10) }),
    });
    if (!res.ok || !res.body) throw Object.assign(new Error('chat'), { status: res.status });
    const left = res.headers.get('X-Chat-Remaining');
    if (left !== null) { remaining = +left; setQuota(); }
    const reader = res.body.getReader(), decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      reply.className = 'ai';
      reply.textContent = answer;
      msgs.scrollTop = msgs.scrollHeight;
    }
    if (!answer.trim()) throw Object.assign(new Error('empty'), { status: 502 });
    history.push({ role: 'assistant', content: answer });
  } catch (err) {
    history.pop();               // the model never saw this turn through
    reply.className = 'ai note';
    if (err.status === 429) { remaining = 0; setQuota(); reply.textContent = `That was the last one: ${limit} messages a day. The limit resets at midnight UTC.`; }
    else if (err.status === 503) reply.textContent = 'No API key is set on this server yet, so there is no model to answer.';
    else if (err.status === 400) reply.textContent = 'That message is too long. Try a shorter one.';
    else if (answer) reply.textContent = answer + ' …the connection dropped.';
    else reply.textContent = 'The chat server is not reachable right now.';
  }
  busy = false;
}

form.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; send(v); });
SUGGESTIONS.forEach(s => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = s;
  b.addEventListener('click', () => send(s));
  chips.append(b);
});

bubble('ai', 'Hi! Ask me about lixelv: what he builds, his stack, or how to reach him.');

// Model name and today's quota come from the server; without it the widget says so.
fetch('api/chat/quota').then(r => r.ok ? r.json() : Promise.reject()).then(q => {
  limit = q.limit; remaining = q.remaining;
  modelEl.textContent = prettyModel(q.model) + ' ▾';
  if (!q.configured) { available = false; bubble('ai note', 'No API key is set on this server yet, so answers are off for now.'); }
  setQuota();
}).catch(() => {
  available = false;
  bubble('ai note', 'This copy of the site runs without its server, so the chat is offline.');
});
