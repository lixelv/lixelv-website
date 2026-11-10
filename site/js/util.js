// Small helpers shared by the project demos.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
export const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hex = b => b.toString(16).padStart(2, '0');

/** Resolves once the page's own style sheets are applied. WebKit can run scripts before that,
 *  and an unstyled page has everything stacked near the top: "visible" long before it really is. */
export const styled = Promise.all($$('link[rel="stylesheet"]').filter(l => l.href.startsWith(location.origin)).map(l => new Promise(done => {
  if (l.sheet) return done();
  l.addEventListener('load', done, { once: true }); l.addEventListener('error', done, { once: true });
})));

/** Runs fn the first time el scrolls into view. */
export function onceVisible(el, fn, threshold = .5) {
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fn(); } }, { threshold });
  styled.then(() => io.observe(el));
}

/** Minimal Python highlighter: comments, strings, numbers, keywords, called builtins. */
const PY = /(#.*)|((?:\b[rbfRBF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|\b(\d+(?:\.\d+)?)\b|\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|try|except|finally|with|pass|break|continue|lambda|True|False|None|is|raise|yield|global|nonlocal|assert|del|async|await)\b|\b(print|input|range|len|int|str|float|list|dict|set|tuple|sum|min|max|abs|sorted|enumerate|zip|map|open|type|bool|round|reversed|any|all|run_program|fullscreen|cmd|kill_process)\b(?=\s*\()/g;
export function highlightPython(src) {
  let out = '', last = 0;
  for (const m of src.matchAll(PY)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'k' : 'b';
    out += `<span class="t-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
