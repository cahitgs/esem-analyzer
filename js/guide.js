// guide.js — the entrance guide: what the app does in four steps, and the two ways to run the models in
// Mplus (the local runner, connected from this page, or download / drop .out). Opens on the first visit,
// again from the "Guide" button; the runner status inside it is live.
import { $, el, toast } from './ui.js';
import { btn, iconEl } from './shell.js';
import { runner } from './runner.js';

const RELEASES = 'https://github.com/cahitgs/esem-analyzer/releases/latest';
const EXE = `${RELEASES}/download/ESEM-Analyzer.exe`;
const SEEN = 'ss-guide-seen';

let dlg = null, busy = false;
let note = null; // { tone: 'wait'|'bad', text } — the last connect attempt, shown until the state changes

/** Look for the runner on this computer and use it; the pill and the guide report the outcome. */
export async function connectRunner() {
  if (busy) return false;
  busy = true;
  note = { tone: 'wait', text: 'Looking for the runner on this computer (localhost, ports 3001–3005)…' };
  render();
  try {
    const ok = await runner.connect();
    if (ok) { note = null; toast(`Connected: Mplus ${runner.state.health.mplus.version} on this computer`, 'ok'); }
    else note = { tone: 'bad', text: 'No runner found. Start ESEM-Analyzer.exe (or node serve.mjs) on this computer, then press Connect again. When the browser asks whether this page may access your local network, choose Allow; if you blocked it earlier, allow it again from the icon at the left of the address bar.' };
    return ok;
  } finally { busy = false; render(); }
}

export function openGuide() {
  if (!dlg) mount();
  note = null;
  render();
  if (!dlg.open) dlg.showModal();
}
export function updateGuide() { if (dlg && dlg.open) render(); }
/** First visit only (not for demo / dev deep links). */
export function autoOpenGuide() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN) === '1'; } catch { /* storage may be unavailable */ }
  if (!seen) openGuide();
}

function mount() {
  dlg = $('#guide');
  dlg.addEventListener('close', () => { try { localStorage.setItem(SEEN, '1'); } catch { /* ignore */ } });
}

function render() {
  if (!dlg) return;
  const h = runner.state.health, server = runner.state.server, ok = runner.ok(), remote = runner.state.remote;
  const step = (n, t, d) => el('li', {}, [el('span', { class: 'step-n', 'aria-hidden': 'true' }, String(n)), el('div', {}, [el('b', {}, t), d])]);

  // the live status of the runner, phrased for the situation
  let dot = 'idle', text, actions = [];
  if (ok && !remote) { dot = 'ok'; text = `This copy runs on your computer with Mplus ${h.mplus.version}. "Run all in Mplus" is ready on the Syntax step.`; }
  else if (ok && remote) { dot = 'ok'; text = `Connected to the runner on this computer: Mplus ${h.mplus.version}. "Run all in Mplus" is ready on the Syntax step.`; }
  else if (server && h && h.mplus && !h.mplus.checked) { dot = 'run'; text = 'The runner is here and is checking your Mplus installation…'; }
  else if (server && h && h.mplus) { dot = 'bad'; text = `The runner is here but Mplus was not found: ${h.mplus.error || 'see the runner window'}.`; }
  else if (note) { dot = note.tone === 'wait' ? 'run' : 'bad'; text = note.text; }
  else { text = 'Not connected. Download the runner, double-click it, then press Connect. The browser will ask once whether this page may access your local network: choose Allow.'; }
  if (!server || !ok) {
    actions = [
      el('a', { class: 'btn btn-sm btn-primary', href: EXE, rel: 'noopener' }, [iconEl('download', 15), el('span', { class: 'btn-t' }, 'Download the runner')]),
      btn('Connect', { size: 'btn-sm', icon: 'play', disabled: busy, onclick: (e) => { e.preventDefault(); connectRunner(); } }),
    ];
  }

  dlg.replaceChildren(el('form', { method: 'dialog', class: 'g-wrap' }, [
    el('header', { class: 'g-head' }, [
      el('div', {}, [
        el('div', { class: 'eyebrow' }, 'Guide'),
        el('h2', { class: 'h2' }, 'How ESEM Analyzer works'),
        el('p', { class: 'lead' }, 'Sketch a factor model, get exact Mplus syntax, read the output back as APA tables. The manuscript on the right writes itself as you go.'),
      ]),
      el('button', { type: 'submit', value: 'close', class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': 'Close' }, iconEl('x', 17)),
    ]),
    el('ol', { class: 'g-steps' }, [
      step(1, 'Data', 'Load a .dat or .csv. It is read in your browser; nothing is uploaded.'),
      step(2, 'Model', 'Pick the items and factors, mark each item’s target loading in Λ, choose rotation and estimator.'),
      step(3, 'Syntax', 'Get exact .inp files: CFA, ESEM, bifactor, invariance across groups or time.'),
      step(4, 'Results', 'Read the .out files: fit table, loadings tables, path diagrams, APA text, Word export.'),
    ]),
    el('h3', { class: 'h3' }, 'Running the models in Mplus'),
    el('div', { class: 'g-opts' }, [
      el('div', { class: 'g-card is-main' }, [
        el('div', { class: 'g-card-t' }, ['From the app, on this computer', el('span', { class: 'tag accent' }, 'recommended')]),
        el('p', {}, 'ESEM-Analyzer.exe (Windows, about 100 MB, no install) finds the Mplus on your computer. Double-click it and it opens its own copy of the app; or keep this page and press Connect, and this page uses the runner on localhost. The Syntax step then shows “Run all in Mplus”, and every output lands in the manuscript by itself.'),
        el('div', { class: 'g-status' }, [el('span', { class: `mdot ${dot}` }), el('span', {}, text)]),
        actions.length ? el('div', { class: 'row' }, actions) : null,
      ]),
      el('div', { class: 'g-card' }, [
        el('div', { class: 'g-card-t' }, 'Without the runner'),
        el('p', {}, 'Download the .inp files from the Syntax step (or use Auto mode in Chrome/Edge), run them in your own Mplus, then drop the .out files into Results. Everything else works the same.'),
      ]),
    ]),
    el('p', { class: 'hint', style: { margin: '0' } }, 'Mplus is needed either way; this page never runs it online. Your data and outputs stay on your computer, and the runner listens on localhost only.'),
    el('footer', { class: 'g-foot' }, [
      el('span', { class: 'small muted' }, 'Reopen this guide any time from the Guide button at the top.'),
      el('button', { type: 'submit', value: 'close', class: 'btn btn-primary' }, 'Start'),
    ]),
  ]));
}
