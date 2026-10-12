// shell.js — the "living manuscript" shell: icons and markup helpers for the control column,
// the Mplus sheet (a second page that slides over the paper) and the paper itself (sections that
// write themselves as the user progresses). Presentation only — no modelling logic lives here.
import { $, $$, el } from './ui.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- icons (stroke 1.8, 24-grid)
const ICON = {
  arrow: '<path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5"/>',
  back: '<path d="M19 12H5m0 0 5.5-5.5M5 12l5.5 5.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download: '<path d="M12 4v12m0 0 4-4m-4 4-4-4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  play: '<path d="M7 5v14l11-7L7 5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  word: '<path d="M4 5h16v14H4z"/><path d="m7 9 1.5 6L10.5 10l2 5L14 9"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>',
};
export const icon = (n, s = 17) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;
export function iconEl(n, s = 17) { const t = document.createElement('template'); t.innerHTML = icon(n, s); return t.content.firstChild; }

// ---------------------------------------------------------------- control-column markup
export const ctrlHead = (eyebrow, title, lead = '') => el('header', { class: 'cc-head' }, [
  el('div', { class: 'eyebrow' }, eyebrow), el('h1', { class: 'h1' }, title), lead ? el('p', { class: 'lead' }, lead) : null,
]);
export const ctrlWrap = (head, body, bar = null) => el('div', { class: 'ctrl-inner' }, [head, el('div', { class: 'cc-body' }, body), bar]);

/** Numbered card: badge + title + grey sub-line on the left, tools on the right, body below. */
export function card(n, title, sub = '', body = [], tools = []) {
  const head = el('div', { class: 'card-h' }, [
    el('div', { class: 'flex items-start gap-3' }, [
      n != null ? el('span', { class: 'num-badge', 'aria-hidden': 'true' }, String(n)) : null,
      el('div', { class: 'min-w-0' }, [el('h2', { class: 'h3' }, title), sub ? el('p', { class: 'small muted' }, sub) : null]),
    ]),
    tools && tools.length ? el('div', { class: 'card-tools' }, tools) : null,
  ]);
  return el('div', { class: 'card' }, [head, el('div', { class: 'card-b' }, body)]);
}
export const tile = (label, value, sub = '') => el('div', { class: 'tile' }, [
  el('div', { class: 'tile-l' }, label), el('div', { class: 'tile-v' }, String(value)), sub ? el('div', { class: 'tile-s' }, sub) : null,
]);
export function callout(kind, body, ic) {
  const name = ic || (kind === 'warn' || kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info');
  return el('div', { class: `callout ${kind}` }, [iconEl(name, 16), el('div', {}, body)]);
}
export const tag = (text, kind = '') => el('span', { class: `tag ${kind}`.trim() }, text);

export function btn(label, { kind = '', size = '', icon: ic = null, onclick, disabled = false, title, id, attrs = {} } = {}) {
  return el('button', { type: 'button', class: `btn ${size} ${kind}`.replace(/\s+/g, ' ').trim(), onclick, disabled, 'data-tip': title, 'aria-label': label ? undefined : title, id, ...attrs },
    [ic ? iconEl(ic, size === 'btn-sm' ? 15 : 16) : null, label ? el('span', { class: 'btn-t' }, label) : null]);
}
/** "Next" button: label + arrow in a 32px pill at the end (the pill slides on hover). */
export const nextBtn = (label, onclick, { disabled = false, kind = 'btn-primary', id } = {}) =>
  el('button', { type: 'button', class: `btn btn-lg ${kind}`, onclick, disabled, id }, [el('span', { class: 'btn-t' }, label), el('span', { class: 'ico-pill end' }, iconEl('arrow', 16))]);
export const backBtn = (label, onclick) =>
  el('button', { type: 'button', class: 'btn btn-ghost btn-lg sb-back', onclick, 'aria-label': label }, [el('span', { class: 'ico-pill start' }, iconEl('back', 16)), el('span', { class: 'btn-t' }, label)]);

/** Sticky step bar at the foot of the control column: back · status dot + one-line info · next. */
export function stepBar({ back = null, info = '', tone = 'ok', next = null, actions = [] } = {}) {
  const i = info ? [el('span', { class: `sb-dot ${tone}`, 'aria-hidden': 'true' }), el('span', { title: info }, info)] : [];
  return el('nav', { class: 'stepbar no-print', 'aria-label': 'Step navigation' }, [
    el('div', { class: `sb-info ${info ? tone : ''}`.trim() }, i),
    back ? backBtn(back.label, back.onclick) : null,
    el('div', { class: 'sb-actions' }, [...actions, next ? nextBtn(next.label, next.onclick, { disabled: !!next.disabled, id: next.id }) : null]),
  ]);
}

/** Row in a file list: status dot · mono name · grey label · arrow. */
export function frow(name, label, onclick, { dot = '', icon: ic = 'arrow' } = {}) {
  return el('button', { type: 'button', class: 'frow', onclick }, [
    el('span', { class: `mdot ${dot}`.trim() }), el('span', { class: 'mono' }, name), el('span', { class: 'frow-l', title: label }, label), iconEl(ic, 15),
  ]);
}
/** Link that points at a section of the paper ("In the paper: Table 2"). */
export const paperLink = (label, secId) => el('button', { type: 'button', class: 'link', onclick: () => { paper.focus([secId], true); } }, [iconEl('file', 15), label]);

// ---------------------------------------------------------------- Mplus syntax highlighting
// commands bold ink · comments grey italic · keywords navy · *start amber · (label) violet · @fixed / ~0 plum
export function highlightMplus(code) {
  return String(code).split('\n').map((line) => {
    let l = esc(line);
    const ci = l.indexOf('!');
    let com = '';
    if (ci >= 0) { com = `<span class="c-com">${l.slice(ci)}</span>`; l = l.slice(0, ci); }
    l = l.replace(/^(\s*)(TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL CONSTRAINT|MODEL [A-Za-z0-9_.]+|MODEL|OUTPUT|SAVEDATA|PLOT|MONTECARLO)(:)/i, '$1<span class="c-cmd">$2$3</span>')
      .replace(/\(\*(\d+)\)/g, '(<span class="c-lbl">*$1</span>)')
      .replace(/\(([A-Za-z_][\w]*|\d+(?:-\d+)?)\)/g, '(<span class="c-lbl">$1</span>)')
      .replace(/@(-?\d[\d.]*)/g, '<span class="c-fix">@$1</span>')
      .replace(/~0/g, '<span class="c-fix">~0</span>')
      .replace(/(?<![>\w])\*(-?\d[\d.]*)/g, '<span class="c-sv">*$1</span>')
      .replace(/\b(BY|WITH|ON|PWITH|IS|ARE|NAMES|USEVARIABLES|CATEGORICAL|MISSING|GROUPING|FILE|FORMAT|ESTIMATOR|ROTATION|TYPE|ITERATIONS|CONVERGENCE|DIFFTEST|PARAMETERIZATION|NEW|CLUSTER|AUXILIARY|USEOBSERVATIONS|IDVARIABLE|ALL|FREE|LISTWISE|SAMPSTAT|STANDARDIZED|RESIDUAL|CINTERVAL|MODINDICES|SVALUES|TECH1|TECH2|TECH3|TECH4)\b/g, '<span class="c-kw">$1</span>');
    return `<span class="ln">${l}${com}</span>`;
  }).join('');
}

// ---------------------------------------------------------------- Mplus sheet
// open({ title, files: () => [{ key, name, label, text, kind:'inp'|'out' }], active, tools: (file) => [button nodes], onSelect })
let SH = null;
function sheetRender() {
  const host = $('#mplusSheet'); if (!host || !SH) return;
  const files = SH.files() || [];
  const act = files.find((f) => f.key === SH.active) || files[0];
  if (!act) { sheet.close(); return; }
  SH.active = act.key;
  const prevPre = host.querySelector('.sh-body pre');
  const keepScroll = prevPre && host.dataset.key === act.key ? prevPre.scrollTop : 0;
  host.dataset.key = act.key;
  const tabs = el('div', { class: 'sh-files', role: 'group', 'aria-label': 'Files' }, files.map((f) => el('button', {
    type: 'button', class: 'sh-file', 'aria-pressed': f.key === act.key ? 'true' : 'false',
    onclick: () => { SH.active = f.key; SH.onSelect?.(f.key); sheetRender(); },
  }, [f.dot ? el('span', { class: `mdot ${f.dot}` }) : null, f.name])));
  const tools = el('div', { class: 'sh-tools' }, SH.tools ? SH.tools(act) : []);
  const close = el('button', { type: 'button', class: 'btn btn-sm btn-icon btn-ghost sh-close', onclick: () => sheet.close(), 'aria-label': 'Close', 'data-tip': 'Close (Esc)' }, iconEl('x', 17));
  const head = el('div', { class: 'sh-head' }, [
    el('div', { class: 'sh-title' }, [iconEl('file', 16), 'Mplus', el('span', { class: 'muted' }, ` · ${SH.title || act.label || act.name}`)]),
    tabs, tools, close,
  ]);
  const pre = act.kind === 'out'
    ? el('pre', { class: 'code code-out', 'aria-label': 'Mplus output' }, act.text)
    : el('pre', { class: 'code', 'aria-label': 'Mplus syntax', html: highlightMplus(act.text) });
  host.replaceChildren(head, el('div', { class: 'sh-body' }, pre));
  if (keepScroll) pre.scrollTop = keepScroll;
  const actTab = tabs.querySelector('.sh-file[aria-pressed="true"]');
  if (actTab) { const x = actTab.offsetLeft - tabs.offsetLeft; if (x < tabs.scrollLeft || x + actTab.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = Math.max(0, x - 24); }
  if (!host.classList.contains('on')) { host.classList.add('on'); host.inert = false; }
}
export const sheet = {
  open(opts) { SH = { ...opts }; sheetRender(); const h = $('#mplusSheet'); if (h) h.focus({ preventScroll: true }); },
  update() { if (SH) sheetRender(); },
  close() { SH = null; const h = $('#mplusSheet'); if (h) { h.classList.remove('on'); h.inert = true; delete h.dataset.key; } },
  isOpen() { return !!SH; },
  active() { return SH ? SH.active : null; },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SH) { e.preventDefault(); sheet.close(); } });

// ---------------------------------------------------------------- tooltip: one ink balloon for every [data-tip]
let TIP = null, tipFor = null;
function tipEl() { if (!TIP) { TIP = el('div', { class: 'tooltip', role: 'tooltip' }); document.body.append(TIP); } return TIP; }
function showTip(t) {
  const txt = t.getAttribute('data-tip'); if (!txt) return;
  const tip = tipEl(); tipFor = t;
  tip.textContent = txt; tip.classList.add('on');
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = r.top - h - 8;
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  tip.style.left = `${Math.round(x)}px`; tip.style.top = `${Math.round(y)}px`;
}
function hideTip() { tipFor = null; if (TIP) TIP.classList.remove('on'); }
document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) { if (t !== tipFor) showTip(t); } else if (tipFor) hideTip(); });
document.addEventListener('mouseleave', (e) => { if (e.target === tipFor) hideTip(); }, true);
document.addEventListener('focusin', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
document.addEventListener('focusout', () => hideTip());
document.addEventListener('click', () => hideTip(), true);
document.addEventListener('scroll', () => hideTip(), true);

// ---------------------------------------------------------------- the paper
// set([{ id, html | node, filled, label }]) — rebuilds or patches sections; a changed section gets the
// marker stripe (.ms-fresh); sections not yet written carry .is-pending (hidden in print).
const PREV = new Map();
let prevIds = '';
let quiet = true;
// full = what is rendered; core = the same without placeholders, whose button labels follow the
// current step — a label change alone re-renders the section but is not marked as "just changed"
const snap = (s) => { const full = s.node ? s.node.outerHTML : String(s.html || ''); return { full, core: full.replace(/<div class="ph">[\s\S]*?<\/div>/g, '<ph/>') }; };
function fill(sec, s) {
  if (s.node) sec.replaceChildren(s.node); else sec.innerHTML = s.html || '';
  sec.classList.toggle('is-pending', !s.filled);
}
function flash(sec) {
  sec.classList.remove('ms-fresh');
  void sec.offsetWidth;
  sec.classList.add('ms-fresh');
  clearTimeout(sec._freshT);
  sec._freshT = setTimeout(() => sec.classList.remove('ms-fresh'), 2700);
}
export const paper = {
  set(sections) {
    const body = $('#paperBody'); if (!body) return;
    const ids = sections.map((s) => s.id).join('|');
    const focused = new Set($$('.ms-sec.is-focus', body).map((x) => x.dataset.sec));
    if (ids !== prevIds) {
      const frag = document.createDocumentFragment();
      for (const s of sections) {
        const sec = el('section', { class: 'ms-sec', 'data-sec': s.id });
        fill(sec, s);
        if (focused.has(s.id)) sec.classList.add('is-focus');
        const h = snap(s), p = PREV.get(s.id);
        if (!quiet && (!p || p.core !== h.core)) flash(sec);
        PREV.set(s.id, h);
        frag.append(sec);
      }
      body.replaceChildren(frag);
      prevIds = ids;
    } else {
      for (const s of sections) {
        const h = snap(s), p = PREV.get(s.id);
        if (p && p.full === h.full) continue;
        const sec = body.querySelector(`[data-sec="${s.id}"]`); if (!sec) continue;
        fill(sec, s);
        if (!quiet && (!p || p.core !== h.core)) flash(sec);
        PREV.set(s.id, h);
      }
    }
    quiet = false;
  },
  /** Mark the sections the control column is talking about; scroll the first into view. */
  focus(ids, scroll = false) {
    const body = $('#paperBody'); if (!body) return;
    $$('.ms-sec.is-focus', body).forEach((x) => x.classList.remove('is-focus'));
    ids.forEach((id) => { const s = body.querySelector(`[data-sec="${id}"]`); if (s) s.classList.add('is-focus'); });
    if (scroll && ids.length) paper.scrollTo(ids[0]);
  },
  scrollTo(id, force = false) {
    const sc = $('#deskScroll'), sec = document.querySelector(`#paperBody [data-sec="${id}"]`);
    if (!sc || !sec) return;
    const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 84;
    const inView = top > sc.scrollTop - 10 && top < sc.scrollTop + sc.clientHeight * 0.45;
    if (force || !inView) sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  },
};

/** Desk bar status: "Manuscript draft · n/m sections" + the ink meter. */
export function setDeskStatus(filled, total) {
  const t = $('#db-txt'), m = $('#db-meter');
  if (t) t.textContent = `Manuscript draft · ${filled}/${total} sections`;
  if (m) m.style.transform = `scaleX(${total ? filled / total : 0})`;
}

// ---------------------------------------------------------------- paper fragments (HTML strings)
/** Blue-pencil placeholder for a section that is not written yet. go = { step, label }. */
export const ph = (text, go = null) => `<div class="ph">${icon('edit', 15)}<span>${text}</span>${go ? `<button type="button" class="ph-go" data-go="${esc(go.step)}"${go.act ? ` data-act="${esc(go.act)}"` : ''}>${esc(go.label)}${icon('arrow', 13)}</button>` : ''}</div>`;
export const phLines = (n = 3) => `<div class="ph-lines" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="width:${i === n - 1 ? 56 : 100 - i * 3}%"></i>`).join('')}</div>`;
/** Two-line figure caption: bold "Figure N" (CSS counter) + italic title. */
export const figCap = (title) => `<p class="tcap fig"><b></b></p><p class="tcap"><i>${esc(title)}</i></p>`;
