// main.js — bootstrap: owns appState, wires the 4-step flow (Data → Model → Syntax → Results).
// Layout: settings in the left column, the manuscript (APA tables, prose, figures) on the right;
// .inp / .out text opens in the Mplus sheet. Modelling, parsing and export engines are untouched.
import { $, $$, el, toast, downloadText, downloadSvgAsPng } from './ui.js';
import { pathDiagramSVG, conceptDiagramSVG } from './diagram.js';
import { parseNameList, detectMissingCode, detectLikertColumns, distinctValues, parseDataFile, buildDat } from './data-parse.js';
import { createModelSpec, looksLikeId } from './state.js';
import { mountModelBuilder } from './model-builder.js';
import { specSignature, applySavedSpec, saveSpecLocal, loadSpecLocal } from './spec-store.js';
import { buildInp, requestedModels } from './syntax-generator.js';
import { parseOut } from './out-parser.js';
import { parseSvalues, suggestReferents, buildEwcInp, fixedCrossCount } from './ewc.js';
import { renderFitTable, renderLoadingsTable, renderProse, renderInvarianceTable, renderInvarianceProse, sortInvarianceModels, noFitReason } from './apa-render.js';
import { copyResultsToWord, exportDocx, zipInputs, buildDocxBlob, buildZipBlob } from './docx-export.js';
import { renderAutoRunCard, autoRunActive } from './autorun-ui.js';
import { runner } from './runner.js';
import { openGuide, autoOpenGuide, updateGuide, connectRunner } from './guide.js';
import { expectedOutName } from './run-scripts.js';
import { esc, icon, iconEl, ctrlHead, ctrlWrap, card, tile, callout, btn, stepBar, frow, paperLink, highlightMplus, sheet, paper, setDeskStatus, ph, phLines, figCap } from './shell.js';

const STEPS = ['data', 'model', 'syntax', 'results'];
const STEP_LABEL = { data: 'Data', model: 'Model', syntax: 'Syntax', results: 'Results' };
const FOCUS = { data: ['head'], model: ['method'], syntax: ['appendix'], results: ['fit'] };
const appState = { step: 'data', reached: { data: true }, data: null, spec: null, parsed: [], previewKey: null, syntaxModels: null, resultSections: [], dataText: null, run: null };
window.appState = appState;

// ============================ Stepper ============================
function goStep(step) {
  if (!STEPS.includes(step) || !reachable(step)) return;
  appState.step = step;
  for (const s of STEPS) { const p = $(`#step-${s}`); if (p) p.hidden = s !== step; }
  renderTrack();
  sheet.close();
  $('#ctrl')?.scrollTo({ top: 0, behavior: 'smooth' });
  // Coming back to the Model step: re-validate, because the Data step may have changed the categorical
  // flags (the spec shares that data object) — otherwise a stale error/verdict would sit in the step bar.
  if (step === 'model') appState.builder?.refresh?.();
  renderPaper();
  const ids = step === 'results' && appState.resultSections.length ? [appState.resultSections[0].id] : FOCUS[step];
  paper.focus(ids, true);
}
function unlock(step) { appState.reached[step] = true; goStep(step); }
/** Where a placeholder's button should go: the step it names if reachable, else the furthest reached step. */
const NEED = { data: 'Load data first', model: 'Sketch the model first', syntax: 'Generate syntax first', results: 'Add .out files' };
// Model and Syntax only make sense with a sketched model (demo / "skip to results" sessions have none)
const reachable = (s) => !!appState.reached[s] && (s === 'data' || s === 'results' || !!appState.spec);
function goTarget(step) {
  if (reachable(step)) return { step, label: step === appState.step ? NEED[step] : `Go to ${STEP_LABEL[step]}` };
  // otherwise point at the action that unlocks it: data → model → syntax → results
  if (!appState.data) return { step: 'data', label: NEED.data };
  if (!appState.spec || !appState.reached.model) return { step: 'data', act: 'continue', label: 'Continue to model' };
  if (step === 'syntax' || !appState.reached.syntax) return { step: 'model', label: 'Generate syntax first' };
  return { step: 'results', act: 'results', label: NEED.results };
}

function stepState(s) {
  const r = appState.reached;
  if (s === 'data') return appState.data ? 'done' : appState.step === 'data' ? 'prog' : 'open';
  if (s === 'model') return r.syntax ? 'done' : r.model ? 'prog' : 'open';
  if (s === 'syntax') return (autoRunActive() || runner.active()) ? 'run' : r.results ? 'done' : r.syntax ? 'prog' : 'open';
  return appState.parsed.length ? 'done' : r.results ? 'prog' : 'open';
}
function renderTrack() {
  $$('#stepper .trk').forEach((b) => {
    const s = b.dataset.step;
    b.disabled = !reachable(s);
    if (s === appState.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    const badge = b.querySelector('.step-n'), st = stepState(s);
    badge.className = `step-n st-${st}`;
    badge.innerHTML = st === 'done' ? icon('check', 14) : String(STEPS.indexOf(s) + 1);
  });
}

// ============================ Step 1 · Data ============================
function wireDropzone() {
  const dz = $('#data-dropzone'), input = $('#data-file-input');
  if (!dz || !input) return;
  const open = () => input.click();
  $('#data-browse-btn')?.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  dz.addEventListener('click', open);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handleDataFile(f); });
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) handleDataFile(f); });
}

async function handleDataFile(file) {
  try {
    const text = await file.text();
    const data = parseDataFile(text, file.name);
    appState.data = data;
    appState.dataText = text;
    renderDataReview(data);
    toast(`Loaded ${file.name} — ${data.nRows} rows × ${data.nCols} columns`, 'ok');
  } catch (err) {
    toast('Could not read that file: ' + err.message, 'err');
  }
}

function renderDataBar() {
  const host = $('#data-bar'); if (!host) return;
  const d = appState.data;
  host.replaceChildren(stepBar({
    info: d ? `${d.nRows.toLocaleString()} rows · ${d.nCols} columns read` : 'No data loaded',
    tone: d ? 'ok' : 'idle',
    next: { label: 'Continue to model', onclick: continueToModel, disabled: !d, id: 'data-next' },
  }));
}

function renderDataReview(data) {
  $('#data-intake').hidden = true;
  const host = $('#data-review'); host.hidden = false; host.innerHTML = '';
  $('#data-title').textContent = data.fileName || 'Data';
  $('#data-lead').textContent = 'Columns are read in order. Check the names (they become the Mplus NAMES list), flag ordinal items, and declare the missing-value code — the Mplus-ready .dat is written for you.';

  const body = el('div', { class: 'cc-body', style: { padding: '0' } });

  // 1 · file summary
  body.append(card(1, 'File', data.fileName || '', [
    el('div', { class: 'tiles' }, [
      tile('Observations', data.nRows.toLocaleString()), tile('Columns', data.nCols),
      tile('Format', data.delimiter === 'comma' ? 'CSV' : 'Free', data.delimiter === 'comma' ? 'comma-separated' : `${data.delimiter} delimited`),
      tile('Header row', data.hasHeader ? 'Yes' : 'No', data.hasHeader ? 'names taken from it' : 'name the columns below'),
    ]),
  ], [btn('Different file', { size: 'btn-sm', icon: 'upload', onclick: resetData })]));

  data.missingHint = detectMissingCode(data);
  // 2 · variable editor — names, ordinal flags; paste a whole name list instead of typing (Morin's request)
  const list = el('div', { class: 'vlist' });
  const rerender = () => renderDataReview(data);
  data.varNames.forEach((name, i) => {
    list.append(el('div', { class: 'vrow' }, [
      el('span', { class: 'idx' }, String(i + 1)),
      el('input', {
        value: name, class: 'input input-sm mono', 'aria-label': `name of column ${i + 1}`,
        oninput: (e) => { data.varNames[i] = e.target.value.trim() || `V${i + 1}`; },
      }),
      el('label', { class: 'cat', 'data-tip': 'Ordered-categorical item (thresholds, WLSMV)' }, [
        el('input', { type: 'checkbox', class: 'box', checked: data.categorical.includes(name), onchange: (e) => toggleCategorical(data, name, i, e.target.checked) }),
        'categorical',
      ]),
    ]));
  });
  const pasteBox = el('div', { hidden: true, style: { marginBottom: '12px' } });
  const ta = el('textarea', { class: 'input mono', rows: '4', style: { width: '100%', resize: 'vertical' }, placeholder: 'One name per line (the Name column copied from SPSS), or "x1-x12 age sex", or a whole Mplus NAMES ARE … ; line', 'aria-label': 'Variable names to paste' });
  const pasteNote = el('p', { class: 'small muted', style: { margin: '6px 0 0' } }, `${data.nCols} columns were read; paste exactly that many names.`);
  pasteBox.append(ta, el('div', { class: 'row', style: { marginTop: '8px' } }, [
    btn('Apply names', { size: 'btn-sm', kind: 'btn-primary', onclick: () => {
      const names = parseNameList(ta.value);
      if (names.length !== data.nCols) { pasteNote.textContent = `${names.length} names found, but the file has ${data.nCols} columns — paste one name per column.`; pasteNote.className = 'small'; pasteNote.style.color = '#7E2519'; return; }
      const old = data.varNames.slice();
      data.varNames = names;
      data.categorical = data.categorical.map((c) => names[old.indexOf(c)]).filter(Boolean);
      toast(`${names.length} column names applied`, 'ok');
      rerender();
    } }),
    btn('Cancel', { size: 'btn-sm', onclick: () => { pasteBox.hidden = true; } }),
  ]), pasteNote);
  const likert = detectLikertColumns(data, { ignore: [data.missingCode, data.missingHint?.code] }).filter((v) => !looksLikeId(data, v));
  const suggest = likert.length >= 2 && !data.categorical.length
    ? callout('info', [`${likert.length} columns look like ordinal (Likert) items — integer values with ${Math.max(...likert.map((v) => distinctValues(data, v, 12).length))} levels at most: ${likert.slice(0, 8).join(', ')}${likert.length > 8 ? ', …' : ''}. Flag them categorical and the models use thresholds with WLSMV; leave them unflagged to treat them as continuous (MLR). `,
      btn('Flag them categorical', { size: 'btn-sm', onclick: () => { data.categorical = likert.slice(); toast(`${likert.length} columns flagged categorical`, 'ok'); rerender(); } })])
    : null;
  body.append(card(2, 'Variables', data.hasHeader ? 'Named from the header row. These names become the Mplus NAMES list.' : 'No header row: the columns are V1…Vn. Paste your names below (or export the file again with a first row of names).', [pasteBox, suggest, list].filter(Boolean), [
    btn('Paste names', { size: 'btn-sm', icon: 'edit', onclick: () => { pasteBox.hidden = !pasteBox.hidden; if (!pasteBox.hidden) ta.focus(); } }),
    btn('All categorical', { size: 'btn-sm', onclick: () => { data.categorical = data.varNames.filter((v) => !looksLikeId(data, v)); rerender(); } }),
    btn('None', { size: 'btn-sm', onclick: () => { data.categorical = []; rerender(); } }),
  ]));

  // 3 · missing values — its own card, with the code detected from the data (Morin lost time here)
  data.missingHint = detectMissingCode(data);
  const missInput = el('input', { id: 'miss', value: data.missingCode ?? '', placeholder: 'e.g. 999 or -99', class: 'input input-sm mono', style: { width: '9rem' }, oninput: (e) => { data.missingCode = e.target.value.trim() || null; renderDataBar(); } });
  const hint = data.missingHint;
  const missNote = hint && (data.missingCode == null || data.missingCode === '')
    ? callout('warn', [`${hint.code} appears in ${hint.columns} columns (${hint.cells} cells) and looks like a missing-value code. Without declaring it, Mplus reads it as a real score and the models fail or fit nonsense. `,
      btn(`Use ${hint.code}`, { size: 'btn-sm', kind: 'btn-primary', onclick: () => { data.missingCode = hint.code; rerender(); } })])
    : el('p', { class: 'small muted', style: { margin: '0' } }, hint ? `Declared: ${data.missingCode} (seen in ${hint.columns} columns).` : 'Blank cells are written as * for Mplus automatically; a numeric code such as 999 or -99 must be declared here.');
  body.append(card(3, 'Missing values', 'The code Mplus should treat as missing', [
    el('div', { class: 'row' }, [el('label', { for: 'miss', class: 'lbl', style: { margin: '0' } }, 'Missing value code'), missInput]),
    missNote,
  ]));

  // 3 · preview
  const tbl = el('table', { class: 'dtab tnum' });
  const thead = el('tr', {});
  data.varNames.forEach((n) => thead.append(el('th', { class: 'num' }, n)));
  tbl.append(el('thead', {}, thead));
  const tb = el('tbody');
  data.preview.forEach((row) => { const tr = el('tr', {}); row.forEach((c) => tr.append(el('td', { class: 'num' }, c))); tb.append(tr); });
  tbl.append(tb);
  body.append(card(4, 'Preview', `First ${data.preview.length} rows, as read.`, [el('div', { class: 'table-wrap' }, tbl)]));

  host.append(body);
  renderDataBar();
  renderTrack();
  renderPaper();
}

function toggleCategorical(data, name, i, on) {
  const v = data.varNames[i];
  data.categorical = data.categorical.filter((x) => x !== v);
  if (on) data.categorical.push(v);
  renderDataBar();
}
function resetData() {
  $('#data-review').hidden = true; $('#data-intake').hidden = false;
  $('#data-title').textContent = 'Load the data';
  $('#data-lead').innerHTML = 'Mplus <code>.dat</code> or <code>.csv</code>, read in your browser and never uploaded. Sketch a factor model next; the manuscript on the right writes itself as you go.';
  appState.data = null; $('#data-file-input').value = '';
  renderDataBar(); renderTrack(); renderPaper();
}
function continueToModel() {
  const data = appState.data;
  data.categorical = [...new Set(data.categorical)];
  const sig = specSignature(data);
  let restored = null;
  if (appState.spec && appState.spec.signature === sig) {
    // same columns: keep the sketch, adopt the Data-step edits (flags, missing code); the estimator follows the flags
    appState.spec.data = data;
    if (data.categorical.length && appState.spec.estimator === 'MLR') appState.spec.estimator = 'WLSMV';
  } else {
    appState.spec = createModelSpec(data);
    appState.spec.signature = sig;
    const saved = loadSpecLocal(data); // the sketch remembered for this file (same name + columns)
    if (saved) { const r = applySavedSpec(appState.spec, saved); if (r.ok) restored = r; }
    if (!restored && data.categorical.length) appState.spec.estimator = 'WLSMV';
  }
  appState.builder = null;
  unlock('model');
  appState.builder = mountModelBuilder($('#model-host'), appState.spec, { onChange: onModelChange, onBack: () => goStep('data') });
  if (restored) toast(`Your model for ${data.fileName} is back: ${appState.spec.items.length} items, ${appState.spec.factors.length} factors${restored.dropped.length ? ` (${restored.dropped.length} unknown column${restored.dropped.length > 1 ? 's' : ''} dropped)` : ''}`, 'ok');
}

// ============================ Step 2 · Model ============================
function onModelChange(ev) {
  if (appState.spec) saveSpecLocal(appState.spec); // every change is remembered for this data file
  if (ev?.continue) { unlock('syntax'); renderSyntaxStep(); return; }
  if (ev && 'preview' in ev) { appState.previewKey = ev.preview; renderPaper(); }
}

// ============================ Step 3 · Syntax ============================
const LINV_TYPE = { esem: 'esem', cfa: 'cfa', bcfa: 'bifactorCfa', besem: 'bifactorEsem' };
const MG_TYPE = { inv: 'esem', cinv: 'cfa', bcinv: 'bifactorCfa', binv: 'bifactorEsem' };
const modelTypeOf = (key) => (key.startsWith('linv:') ? (LINV_TYPE[key.split(':')[1]] || 'esem') : (MG_TYPE[key.split(':')[0]] || key));

function syntaxSheetFiles() {
  const spec = appState.spec; if (!spec) return [];
  return (appState.syntaxModels || []).map((m) => ({ key: m.key, name: m.file, label: m.label, text: buildInp(spec, m.key), kind: 'inp' }));
}
function openSyntaxSheet(key) {
  const spec = appState.spec; if (!spec) return;
  sheet.open({
    title: 'generated input', files: syntaxSheetFiles, active: key,
    tools: (f) => [
      btn('Copy', { size: 'btn-sm', icon: 'copy', onclick: async () => { await navigator.clipboard.writeText(buildInp(spec, f.key)); toast('Syntax copied', 'ok'); } }),
      btn('.inp', { size: 'btn-sm', icon: 'download', onclick: () => downloadText(buildInp(spec, f.key), f.name, 'text/plain') }),
    ],
  });
}

// The Mplus-ready data for a local run: the parsed matrix when it is complete, otherwise the whole
// uploaded text re-read with the same rules as data-parse (header dropped, decimal comma → dot, blank → *).
function runDataText(data) {
  if (!data.matrixTruncated || !appState.dataText) return buildDat(data);
  const lines = String(appState.dataText).replace(/^﻿/, '').split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  if (data.hasHeader) lines.shift();
  const ch = { semicolon: ';', comma: ',', tab: '\t' }[data.delimiter] || null;
  const split = ch ? (l) => l.split(ch).map((s) => s.trim()) : (l) => l.trim().split(/\s+/);
  const fix = (t) => (t === '' ? '*' : t.replace(/^(-?\d+),(\d+)$/, '$1.$2'));
  return lines.map(split).filter((t) => t.length === data.nCols).map((t) => t.map(fix).join(' ')).join('\n') + '\n';
}

let syntaxView = null; // the live run card on the Syntax step (re-rendered on job events)
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Queue models in the local Mplus. A fresh run gets its own folder with the data file; `reuse` adds to the current one. */
async function startRun(models, { reuse = false } = {}) {
  const spec = appState.spec; if (!spec || !runner.ok() || !models.length) return;
  const data = spec.data, datName = data.mplusFile || 'data.dat';
  const files = models.map((m) => ({ name: m.file, text: buildInp(spec, m.key) }));
  const outNames = models.map((m) => expectedOutName(m.file));
  try {
    let r;
    if (reuse && appState.run) r = await runner.runMore(appState.run.id, { files, run: models.map((m) => m.file) });
    else {
      files.push({ name: datName, text: runDataText(data) });
      r = await runner.start({ label: (data.fileName || 'esem').replace(/\.[^.]+$/, ''), files, run: models.map((m) => m.file) });
      appState.run = { id: r.id, dir: r.dir };
    }
    // a re-run replaces the earlier output of the same model
    appState.parsed = appState.parsed.filter((x) => !outNames.includes(x.fileName));
    toast(`Queued ${models.length} model${models.length > 1 ? 's' : ''} in Mplus`, 'ok');
    renderResultsOutput();
    syntaxView?.update(); renderSyntaxBar(); renderTrack(); renderMplusPill();
  } catch (e) { toast('Mplus: ' + e.message, 'err'); }
}

const JOB_LABEL = { queued: 'Queued', running: 'Running', done: 'Completed', error: 'Error', cancelled: 'Cancelled' };
/** One row per model: status dot · name · label · run / stop / open-output actions, plus the live Mplus log. */
function renderRunRows(dyn, models) {
  const run = appState.run;
  dyn.innerHTML = '';
  if (run) dyn.append(el('p', { class: 'hint', style: { margin: '0 0 4px' } }, ['Run folder: ', el('span', { class: 'mono', style: { color: 'var(--ink)' } }, run.dir)]));
  const list = el('div');
  let running = null;
  for (const m of models) {
    const j = run ? runner.jobFor(run.id, m.file) : null;
    const outName = expectedOutName(m.file);
    const parsed = appState.parsed.find((x) => x.fileName === outName && x.runId === run?.id);
    let st = 'idle', label = 'Not run yet';
    if (j) { st = j.status; label = JOB_LABEL[j.status] || j.status; if (j.status === 'running') running = j; }
    // same verdict as the Results list and the tables: a finished run without fit statistics is a failed run
    const reason = j && j.status === 'done' && parsed ? noFitReason(parsed.parsed) : null;
    if (reason) { st = 'error'; label = `Not estimated: ${reason}`; }
    const acts = [];
    if (j && (j.status === 'running' || j.status === 'queued')) acts.push(btn('', { size: 'btn-sm', kind: 'btn-danger btn-icon', icon: 'stop', title: 'Stop', onclick: () => runner.cancel(j.id).catch((e) => toast(e.message, 'err')) }));
    else acts.push(btn('', { size: 'btn-sm', kind: 'btn-tonal btn-icon', icon: 'play', title: j ? 'Run again' : 'Run this model', onclick: () => startRun([m], { reuse: true }) }));
    if (parsed) acts.push(btn('', { size: 'btn-sm', kind: 'btn-icon', icon: 'file', title: 'Open the output (.out)', onclick: () => openOutSheet(appState.parsed.indexOf(parsed)) }));
    const time = j && j.startedAt ? dur((j.endedAt || Date.now()) - j.startedAt) : '';
    list.append(el('div', { class: 'mrow' }, [
      el('div', { class: 'mrow-m min-w-0' }, [el('span', { class: 'mono' }, m.file), el('small', {}, m.label)]),
      el('div', { class: 'mrow-s' }, [
        el('span', { class: `st ${st}` }, [el('i'), label]),
        time ? el('small', { class: 'mono' }, time) : null,
        j && j.error ? el('small', { style: { color: 'var(--err)' } }, j.error) : null,
      ]),
      el('div', { class: 'row-acts' }, acts),
    ]));
  }
  dyn.append(list);
  if (running) dyn.append(el('div', { class: 'mt-3' }, [el('div', { class: 'lbl' }, `Live Mplus output · ${running.name}`), el('div', { class: 'log' }, running.tail.join('\n') || 'Starting Mplus…')]));
}

function renderSyntaxBar() {
  const host = $('#syntax-bar'); if (!host || !appState.spec) return;
  const models = appState.syntaxModels || [];
  const run = appState.run;
  const jobs = run ? models.map((m) => runner.jobFor(run.id, m.file)).filter(Boolean) : [];
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'error' || j.status === 'cancelled').length;
  const hasData = !!(appState.spec.data._matrix && appState.spec.data._matrix.length);
  let info, tone;
  if (active) { info = `Mplus is running · ${done} of ${jobs.length} finished`; tone = 'wait'; }
  else if (jobs.length) {
    // runs that Mplus rejected (job error) and runs that ended without fit statistics (no convergence,
    // failed rotation, χ² not computed) are both worth a warning here, not just in the tables
    const nofit = appState.parsed.filter((m) => m.runId === run.id && noFitReason(m.parsed)).length; // this run's outputs only
    const parts = [`${done} finished`];
    if (failed) parts.push(`${failed} failed — open the .out to see why`);
    if (nofit) parts.push(`${nofit} without fit statistics — shown as "Not estimated" in Results`);
    info = failed || nofit ? parts.join(' · ') : `${done} output${done === 1 ? '' : 's'} written into the manuscript`;
    tone = failed || nofit ? 'warn' : 'ok';
  }
  else { info = `${models.length} input ${models.length === 1 ? 'file' : 'files'} ready · ${runner.ok() ? (hasData ? 'Mplus is ready on this computer' : 'load the data again to run from here') : hasData ? 'data file included' : 'data file not available for export'}`; tone = runner.ok() && !hasData ? 'warn' : 'ok'; }
  host.replaceChildren(stepBar({
    back: { label: 'Back', onclick: () => goStep('model') },
    info, tone,
    next: { label: appState.parsed.length ? 'View results' : 'I have my .out files', onclick: () => { unlock('results'); renderResultsStep(); } },
  }));
}

function renderSyntaxStep() {
  const host = $('#syntax-host'); host.innerHTML = '';
  const spec = appState.spec;
  const models = requestedModels(spec);
  appState.syntaxModels = models;
  const data = spec.data;
  const datName = data.mplusFile || 'data.dat';
  const hasData = !!(data._matrix && data._matrix.length);
  const local = runner.ok();
  const version = local ? runner.state.health.mplus.version : '';
  const draw = () => { sheet.update(); renderPaper(); };

  const head = ctrlHead('Step 3 · Syntax', 'Run it in Mplus', local
    ? `Mplus ${version} is installed on this computer. Run every model from here; the manuscript fills in as each output arrives. Nothing to download or upload.`
    : 'Save each .inp next to your data file and run it in Mplus. Then come back and drop the resulting .out files into Results.');
  const body = [];

  // 1 · input files — each row opens the Mplus sheet
  const rows = el('div', { class: 'frows' }, models.map((m) => frow(m.file, m.label, () => openSyntaxSheet(m.key))));
  const tools = [];
  if (local) tools.push(btn('Run all in Mplus', { size: 'btn-sm', kind: 'btn-primary', icon: 'play', disabled: !hasData, onclick: () => startRun(models) }));
  if (hasData) tools.push(btn('Data (.dat)', { size: 'btn-sm', icon: 'download', onclick: () => { downloadText(buildDat(data), datName, 'text/plain'); toast(`Saved ${datName}`, 'ok'); } }));
  tools.push(btn('Download all (.zip)', { size: 'btn-sm', kind: local ? '' : 'btn-primary', icon: 'download', onclick: () => {
    const files = models.map((m) => ({ name: m.file, text: buildInp(spec, m.key) }));
    if (hasData) files.push({ name: datName, text: buildDat(data) });
    zipInputs(files);
  } }));
  const fileBody = [rows];
  // Mplus can't read a semicolon CSV or a file with a header row — tell the user to use the .dat.
  if (hasData && !local) {
    const why = data.needsMplusDat
      ? `Your data file ${data.hasHeader ? 'has a header row' : ''}${data.hasHeader && data.delimiter === 'semicolon' ? ' and ' : ''}${data.delimiter === 'semicolon' ? 'uses “;” separators' : ''} — Mplus can't read it directly.`
      : 'A clean, Mplus-formatted copy of your data.';
    fileBody.push(callout(data.needsMplusDat ? 'warn' : 'info', [
      el('b', {}, data.needsMplusDat ? 'Use the exported data file. ' : 'Data file. '),
      `${why} The .inp reads `, el('code', {}, `FILE = "${datName}"`),
      `. Use “Data (.dat)” (or “Download all”) and keep `, el('code', {}, datName),
      ' in the same folder as the .inp.',
      data.matrixTruncated ? el('span', { style: { display: 'block', marginTop: '4px', fontWeight: '600' } }, `Note: only the first ${data._matrix.length.toLocaleString()} rows were exported.`) : null,
    ]));
  }
  if (local && !hasData) fileBody.push(callout('warn', 'No data rows are available to write into the run folder — load the data file again to run from here.'));
  if (runner.state.server === false) fileBody.push(el('div', { class: 'callout info' }, [iconEl('info', 16), el('div', {}, [
    el('div', {}, [el('b', {}, 'Run the models from here instead. '), 'Start the runner on this computer (ESEM-Analyzer.exe, or node serve.mjs) and connect this page to it; the outputs then land in the manuscript by themselves.']),
    el('div', { class: 'row', style: { marginTop: '8px' } }, [
      btn('Connect', { size: 'btn-sm', kind: 'btn-primary', icon: 'play', onclick: () => connectRunner().then((ok) => { if (!ok) openGuide(); }) }),
      btn('How it works', { size: 'btn-sm', onclick: () => openGuide() }),
    ]),
  ])]));
  body.push(card(1, 'Input files', `${models.length} ${models.length === 1 ? 'model' : 'models'} · click a file to read its syntax`, fileBody, tools));

  // 2 · run on this computer — or, without a local Mplus, the folder-watch fallback
  if (local) {
    const dyn = el('div');
    body.push(card(2, 'Run in Mplus', `Mplus ${version} · models run one after another in a folder under mplus-runs; each .out joins the manuscript as it lands`, [dyn]));
    syntaxView = { update: () => renderRunRows(dyn, models) };
    syntaxView.update();
  } else {
    syntaxView = null;
    const autoHost = el('div', { class: 'contents' });
    body.push(autoHost);
    renderAutoRunCard(autoHost, {
      n: 2,
      models,
      buildFiles: () => {
        const files = models.map((m) => ({ name: m.file, text: buildInp(spec, m.key) }));
        if (hasData) files.push({ name: datName, text: buildDat(data) });
        return files;
      },
      onOutText: (name, text) => {
        try { importOutText(text, name); renderResultsOutput(); }
        catch (err) { toast(`${name}: ${err.message}`, 'err'); }
      },
      openResults: () => { unlock('results'); renderResultsStep(); },
    });
  }

  // 3 · Convergence aids (Morin, Hoyle ch. 27): loosened CONVERGENCE + residual positivity constraints.
  const aids = spec.aids || (spec.aids = { convergence: false, convergenceValue: 0.005, positiveResiduals: [] });
  const invOn = spec.groups.enabled || spec.longitudinal?.enabled;
  const aidBody = [];
  const syncConv = () => { convInput.disabled = !aids.convergence; };
  const convInput = el('input', {
    type: 'number', step: '0.001', min: '0', value: String(aids.convergenceValue ?? 0.005),
    'aria-label': 'convergence criterion value', class: 'input input-sm mono', style: { width: '7.5rem' },
    oninput: (e) => { const v = parseFloat(e.target.value); aids.convergenceValue = Number.isFinite(v) && v > 0 ? v : 0.005; draw(); },
    // on commit (blur), reflect the value actually in effect — a cleared/zero field falls back to .005
    onchange: (e) => { e.target.value = String(aids.convergenceValue ?? 0.005); },
  });
  aidBody.push(el('div', { class: 'row' }, [
    el('label', { class: 'toggle' }, [
      el('input', { type: 'checkbox', checked: aids.convergence, onchange: (e) => { aids.convergence = e.target.checked; syncConv(); draw(); } }),
      el('span', { class: 'mono', style: { fontWeight: '700' } }, 'CONVERGENCE ='),
    ]),
    convInput,
  ]));
  syncConv();
  aidBody.push(el('p', { class: 'hint' }, 'Loosens Mplus’s convergence criterion — Morin’s remedy for hard-to-converge invariance models. Report it when used.'));
  aidBody.push(el('p', { class: 'sub-h' }, 'Constrain residual variance > 0'));
  {
    if (invOn) aidBody.push(el('p', { class: 'hint', style: { marginTop: '0' } }, 'Applied to the total-sample measurement models only — not to the invariance sequences (a MODEL label there equates the parameter across groups/waves). CONVERGENCE above still applies to every generated model.'));
    const box = el('div', { class: 'chips' });
    for (const it of spec.items) {
      // Categorical items are offered disabled: their residual variance is not a free parameter
      // under the default DELTA parameterization, so the generator skips them (see residualAidLines).
      const isCat = spec.data.categorical?.includes(it);
      const on = () => aids.positiveResiduals.includes(it);
      const chip = el('button', { type: 'button', class: 'chip chip-sm mono', disabled: isCat, title: isCat ? 'categorical item — residual variance is not a free parameter (DELTA parameterization)' : undefined }, it);
      const sync = () => chip.setAttribute('aria-pressed', String(on()));
      if (!isCat) chip.onclick = () => { aids.positiveResiduals = on() ? aids.positiveResiduals.filter((x) => x !== it) : [...aids.positiveResiduals, it]; sync(); draw(); };
      sync();
      box.append(chip);
    }
    aidBody.push(box);
    aidBody.push(el('p', { class: 'hint' }, [
      'Heywood-case remedy: adds ', el('code', {}, 'item (res#);'), ' with ', el('code', {}, 'MODEL CONSTRAINT: res# > 0;'),
      '. Applied to the measurement models only. Note: with MODEL CONSTRAINT present, Mplus ignores a MODINDICES request.',
    ]));
  }
  body.push(card(3, 'Convergence aids', 'Optional — they change the generated syntax.', aidBody));

  const bar = el('div', { class: 'contents', id: 'syntax-bar' });
  host.append(ctrlWrap(head, body, bar));
  renderSyntaxBar();
  renderTrack();
  draw();
}

// ============================ Step 4 · Results ============================
function renderResultsStep() {
  const host = $('#results-host'); host.innerHTML = '';
  const head = ctrlHead('Step 4 · Results', 'Read the Mplus output', runner.ok()
    ? 'Outputs from local runs arrive here on their own; you can also add .out files run elsewhere. Each is parsed in your browser into a fit row and a standardized loadings table, with auto-written APA text.'
    : 'Add one or more .out files. Each is parsed in your browser into a fit row and a standardized loadings table, with auto-written APA text.');

  const input = el('input', { type: 'file', accept: '.out,.txt', multiple: true, hidden: true, onchange: (e) => addOutFiles(e.target.files) });
  const dz = el('div', { class: 'drop drop-row', tabindex: '0', role: 'button', 'aria-label': 'Upload Mplus output files' }, [
    el('span', { class: 'drop-ic' }, iconEl('upload', 20)),
    el('div', { class: 'min-w-0 flex-1', style: { flexBasis: '180px' } }, [
      el('div', { class: 'drop-t' }, 'Drop .out files here'),
      el('p', { class: 'small muted' }, 'Mplus output — multiple files welcome. Invariance sequences are recognised from their titles.'),
    ]),
    btn('Choose files', { size: 'btn-sm', icon: 'upload', onclick: (e) => { e.stopPropagation(); input.click(); } }),
    input,
  ]);
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { e.preventDefault(); addOutFiles(e.dataTransfer?.files); });

  const files = el('div', { class: 'frows', id: 'results-files' });
  const body = [card(1, 'Mplus output', 'Each file becomes a row of the fit table and a loadings table in the manuscript.', [dz, files]), el('div', { id: 'results-dyn', class: 'contents' })];
  const bar = el('div', { id: 'results-bar', class: 'contents' });
  host.append(ctrlWrap(head, body, bar));
  renderResultsOutput();
}

// Single import path shared by the Results dropzone and the auto-mode folder watcher.
function importOutText(text, fileName, extra = {}) {
  const p = parseOut(text);
  appState.parsed.push({ label: deriveLabel(p, fileName), parsed: p, fileName, raw: text, ...extra });
  const reason = noFitReason(p);
  if (reason) toast(`${fileName}: ${reason} — no fit statistics`, 'err');
}

async function addOutFiles(fileList) {
  for (const f of Array.from(fileList || [])) {
    try { importOutText(await f.text(), f.name); }
    catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
  }
  renderResultsOutput();
}

// Row label for a parsed output: the model/step name plus, when it matters, why the output is unusable
// (no fit statistics — the red dot) or the first note the parser collected about the output (otherwise invisible).
function outRowLabel(m) {
  const reason = noFitReason(m.parsed);
  if (reason) return `${m.label} · not estimated: ${reason}`;
  return m.parsed.warnings?.length ? `${m.label} · ${m.parsed.warnings[0]}` : m.label;
}

function deriveLabel(p, fileName) {
  if (p.invStep) return p.invStep; // invariance step parsed from the TITLE (longitudinal or multi-group)
  const t0 = p.title || '';
  const wave = t0.match(/\[([^\]]+)\]\s*$/); // "[Time 1]" — a measurement model estimated on one wave of a longitudinal design
  const t = wave ? t0.slice(0, wave.index).trim() : t0;
  const base = baseLabel(t, fileName);
  return wave ? `${base} · ${wave[1]}` : base;
}
function baseLabel(t, fileName) {
  if (/within-?CFA/i.test(t)) return /bifactor/i.test(t) ? 'Bifactor-ESEM-within-CFA' : 'ESEM-within-CFA';
  const inv = t.match(/invariance\s*[-:]\s*(.+)/i);
  if (inv) return inv[1].trim();
  if (/configural/i.test(t)) return 'Configural';
  if (/bifactor/i.test(t)) return /esem/i.test(t) ? 'Bifactor-ESEM' : 'Bifactor-CFA';
  if (/target/i.test(t)) return 'ESEM (Target)';
  if (/geomin|esem/i.test(t)) return 'ESEM (Geomin)';
  if (/cfa/i.test(t)) return 'CFA';
  if (t) return t.length <= 28 ? t : t.slice(0, 26) + '…';
  return fileName.replace(/\.out$/i, '');
}

const factorLabelsFor = (p) => {
  const spec = appState.spec;
  if (spec && spec.factors.length === p.factorOrder.length) {
    const map = {}; p.factorOrder.forEach((fid, idx) => { map[fid] = spec.factors[idx].label; });
    return map;
  }
  return {};
};
const exportLabels = () => (appState.parsed[0] ? factorLabelsFor(appState.parsed[0].parsed) : {});

function openOutSheet(idx) {
  sheet.open({
    title: 'output',
    files: () => appState.parsed.map((m, i) => ({ key: `${i}:${m.fileName}`, name: m.fileName, label: m.label, text: m.raw, kind: 'out', dot: noFitReason(m.parsed) ? 'bad' : 'ok' })),
    active: `${idx}:${appState.parsed[idx]?.fileName}`,
    tools: (f) => [btn('.out', { size: 'btn-sm', icon: 'download', onclick: () => downloadText(f.text, f.name, 'text/plain') })],
  });
}

function renderOutList() {
  const list = $('#results-files'); if (!list) return;
  list.innerHTML = '';
  appState.parsed.forEach((m, i) => {
    list.append(el('div', { class: 'frow-wrap' }, [
      frow(m.fileName, outRowLabel(m), () => openOutSheet(i), { dot: noFitReason(m.parsed) ? 'bad' : 'ok', icon: 'file' }),
      el('button', { type: 'button', class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': `remove ${m.fileName}`, 'data-tip': 'Remove from the manuscript', onclick: () => { appState.parsed.splice(i, 1); renderResultsOutput(); } }, iconEl('x', 16)),
    ]));
  });
}

function renderResultsBar() {
  const host = $('#results-bar'); if (!host) return;
  const n = appState.parsed.length;
  const busy = runner.active();
  host.replaceChildren(stepBar({
    back: { label: 'Back', onclick: () => goStep(appState.spec ? 'syntax' : 'data') },
    info: busy ? `Mplus is running · ${n} output${n === 1 ? '' : 's'} in the manuscript so far`
      : n ? `${n} output ${n === 1 ? 'file' : 'files'} parsed · the manuscript is up to date`
      : runner.ok() ? 'No output yet — run the models from the Syntax step, or drop .out files here' : 'No output yet — drop a .out file to write the results',
    tone: busy ? 'wait' : n ? 'ok' : 'idle',
  }));
}

function renderResultsOutput() {
  renderOutList();
  const dyn = $('#results-dyn');
  if (dyn) dyn.innerHTML = '';
  const sections = [];
  const addHtml = (id, html) => sections.push({ id, filled: true, html });
  const addNode = (id, node) => sections.push({ id, filled: true, node });
  let cardNo = 2;

  // Route parsed outputs three ways: longitudinal invariance sequences (single-group, recognized by
  // TITLE), multi-group invariance (nGroups > 1), and plain single-group models.
  // Sequences are ordered by invariance step (configural first), never by df: an output without fit
  // statistics has no df, and sorting by df used to push such rows above the configural baseline.
  const longi = appState.parsed.filter((m) => m.parsed.invKind === 'longitudinal');
  const multi = sortInvarianceModels(appState.parsed.filter((m) => m.parsed.invKind !== 'longitudinal' && (m.parsed.nGroups || 1) > 1));
  const single = appState.parsed.filter((m) => m.parsed.invKind !== 'longitudinal' && (m.parsed.nGroups || 1) <= 1);

  // One comparison table per measurement model (CFA, ESEM, bifactor-CFA, bifactor-ESEM), least→most
  // constrained; the model is named in the caption only when more than one chain is present.
  const INV_KINDS = [['cfa', 'CFA'], ['esem', 'ESEM'], ['bcfa', 'Bifactor-CFA'], ['besem', 'Bifactor-ESEM']];
  const byModel = (list) => INV_KINDS.map(([id, label]) => [list.filter((m) => (m.parsed.invModel || 'esem') === id), label]).filter(([set]) => set.length);
  const renderLongiBlock = (models, modelLabel) => {
    if (!models.length) return;
    const set = sortInvarianceModels(models);
    const cap = `Tests of longitudinal measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`;
    const id = `linv-${modelLabel || 'all'}`;
    addHtml(id, `<div class="apa">${renderInvarianceTable(set, { caption: cap, longitudinal: true })}</div>`);
    const prose = renderInvarianceProse(set, { longitudinal: true });
    if (prose) addHtml(`${id}-p`, `<h3 class="ms-h3">Suggested APA text — longitudinal invariance${modelLabel ? ` (${modelLabel})` : ''}</h3>${prose}`);
  };
  // Manuscript order: the four-model fit table and the loadings tables first (Table 1 is the fit table), then the
  // invariance sequences — across groups before across time. The CSS table counter follows this DOM order.
  if (single.length) {
    addHtml('fit', `<div class="apa">${renderFitTable(single, { deltaMode: single.length > 1 ? 'auto' : 'none' })}</div>`);
    // per-model blocks: first-order models (CFA/ESEM) above bifactor models (stable within groups)
    const ordered = [...single].sort((a, b) => (a.parsed.generalFactor ? 1 : 0) - (b.parsed.generalFactor ? 1 : 0));
    ordered.forEach((m, i) => {
      const labels = factorLabelsFor(m.parsed);
      const secId = `load-${i}`;
      const node = el('div', { html: `<h3 class="ms-h3">${esc(m.label)}</h3><div class="apa">${renderLoadingsTable(m.parsed, { factorLabels: labels })}</div>` });
      const { holder, controls } = buildDiagram(m, labels, secId, cardNo++);
      node.insertAdjacentHTML('beforeend', figCap(`Path diagram — ${m.label}`));
      node.append(holder);
      addNode(secId, node);
      dyn?.append(controls);
    });
    // ESEM-within-CFA follows the retained rotated solution (one panel, a selector when several solutions are present)
    const ewc = renderEwcPanel(ordered, cardNo);
    if (ewc) { dyn?.append(ewc); cardNo++; }
    addHtml('prose', `<h3 class="ms-h3">Suggested APA text</h3>${renderProse(single)}`);
  }

  if (multi.length) {
    // Up to four MG chains can coexist (CFA, ESEM, bifactor-CFA, bifactor-ESEM) — they are not nested in
    // each other, so each gets its own table, split by the model named in the generated TITLE.
    const sets = byModel(multi);
    const renderMgBlock = (models, modelLabel) => {
      if (!models.length) return;
      const cap = `Tests of measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`;
      const id = `mginv-${modelLabel || 'all'}`;
      addHtml(id, `<div class="apa">${renderInvarianceTable(models, { caption: cap })}</div>`);
      const invProse = renderInvarianceProse(models);
      if (invProse) addHtml(`${id}-p`, `<h3 class="ms-h3">Suggested APA text — invariance${modelLabel ? ` (${modelLabel})` : ''}</h3>${invProse}`);
    };
    for (const [set, label] of sets) renderMgBlock(set, sets.length > 1 ? label : '');
  }

  if (longi.length) {
    const sets = byModel(longi);
    for (const [set, label] of sets) renderLongiBlock(set, sets.length > 1 ? label : '');
  }

  appState.resultSections = sections;
  renderResultsBar();
  renderTrack();
  renderPaper();
  updateExportTools();
}

// ESEM-within-CFA: when a dropped ESEM/bifactor-ESEM .out carries a SVALUES block, offer to
// convert its rotated solution into a runnable CFA-syntax model (Morin's referent method).
// Every generated model prints SVALUES; only ROTATED solutions (ESEM / bifactor-ESEM — Mplus lists a
// "Rotation" in its summary) can be frozen into an ESEM-within-CFA model. The loadings table's bifactor
// verdict is handed over so the card and the table never disagree.
function ewcModelOf(m) {
  if (!m.raw || !m.parsed?.rotation) return null;
  const model = parseSvalues(m.raw, { generalFactor: m.parsed.generalFactor ?? null });
  return model.found && model.factors.length >= 2 ? model : null;
}
// One panel: the conversion is based on the solution the researcher retains (Morin), not on every rotated
// output that happens to be present — a selector lists the candidates when there are several.
function renderEwcPanel(models, n) {
  const eligible = models.filter((m) => ewcModelOf(m));
  if (!eligible.length) return null;
  const want = appState.spec?.rotation?.type || '';
  let current = eligible.find((m) => !m.parsed.generalFactor && want && new RegExp(want, 'i').test(m.parsed.rotation || '')) || eligible[eligible.length - 1];
  const holder = el('div');
  const render = () => { holder.replaceChildren(...ewcCardBody(current, ewcModelOf(current))); };
  const top = eligible.length > 1
    ? el('div', { class: 'field' }, [
      el('label', {}, 'Retained model'),
      el('select', { class: 'select select-sm', 'aria-label': 'Retained model for the ESEM-within-CFA conversion', onchange: (e) => { current = eligible[Number(e.target.value)] || current; render(); } },
        eligible.map((m, i) => el('option', { value: String(i), selected: m === current }, m.label))),
      el('p', { class: 'small muted', style: { margin: '6px 0 0' } }, 'The conversion follows the solution you retain; pick another rotated solution to convert that one instead.'),
    ])
    : null;
  render();
  return card(n, 'ESEM-within-CFA', eligible.length > 1 ? 'Freeze the retained rotated solution into an equivalent CFA.' : `Freeze the rotated solution of ${current.label} into an equivalent CFA.`, [top, holder].filter(Boolean));
}
function ewcCardBody(m, model) {

  const refs = { ...suggestReferents(model) };
  const fLabel = (f) => (/^(g|fg)$/i.test(f) ? `${f} (general)` : f);
  const body = [];

  body.push(el('p', { class: 'small', style: { color: 'var(--ink-2)', margin: '0' } },
    model.isBifactor
      ? 'This bifactor-ESEM carries a SVALUES block. Freeze it into a CFA you can extend (predictive paths, MIMIC/DIF). One referent per factor is picked; its cross-loadings are fixed to the ESEM values and all factor correlations to 0.'
      : 'This ESEM carries a SVALUES block. Freeze the rotated solution into an equivalent CFA (same fit) that you can embed in larger SEM/MIMIC/DIF models. One referent indicator per factor is picked; its cross-loadings are fixed to the ESEM values.'));

  // Identification form — basic (exogenous use) vs higher-order (endogenous factors).
  // Bifactor-EWC has a single documented form, so the selector is hidden there.
  let variant = 'basic';
  const pickRow = el('div', { class: 'namegrid' });
  const pre = el('pre', { class: 'code', style: { maxHeight: '420px' } });
  const note = el('div');
  const fileBase = (m.fileName || 'model').replace(/\.out$/i, '');
  const state = { inp: '', name: '' };
  const canRun = runner.ok() && !!m.runId;

  const refresh = () => {
    const inp = buildEwcInp(model, { referents: refs, variant });
    pre.innerHTML = highlightMplus(inp);
    const fixed = fixedCrossCount(model, refs), need = model.factors.length * (model.factors.length - 1);
    const identified = fixed === need;
    const scaleTxt = variant === 'higherOrder'
      ? 'Referent main loadings fixed too; factor variances FREE (*1) — the factors can sit under a higher-order factor or be predicted by covariates'
      : `Factor variances fixed to 1${model.isBifactor ? '; factor correlations fixed to 0' : ''}`;
    note.replaceChildren(callout(identified ? 'ok' : 'warn', identified
      ? `${fixed} cross-loadings fixed to identify the rotation (m(m−1) = ${need}). ${scaleTxt}. ${canRun ? 'Run it from here; its tables join the manuscript when Mplus finishes.' : 'Run this in Mplus, then drop its .out back here for APA tables.'}`
      : `Only ${fixed} of the ${need} cross-loadings are fixed — give each factor a distinct referent, or the model is under-identified.`));
    state.inp = inp;
    state.name = `${variant === 'higherOrder' ? 'EWC_HO' : 'EWC'}_${fileBase}.inp`;
  };

  if (!model.isBifactor) {
    const sel = el('select', {
      class: 'select select-sm', 'aria-label': 'ESEM-within-CFA identification form',
      onchange: (e) => { variant = e.target.value; refresh(); },
    }, [
      el('option', { value: 'basic', selected: true }, 'Standard — factors stay exogenous (MIMIC / DIF / predictors)'),
      el('option', { value: 'higherOrder' }, 'Higher-order — factors become endogenous (variances *1)'),
    ]);
    body.push(el('div', { class: 'field' }, [el('label', {}, 'Identification form'), sel]));
  }

  // Each factor needs its OWN referent: an item used as referent for one factor is disabled in
  // the other dropdowns, so the user can never pick duplicates (which would drop the model below
  // m(m−1) fixed cross-loadings and leave it under-identified). Rebuilt on every change.
  const buildPickers = () => {
    pickRow.innerHTML = '';
    for (const f of model.factors) {
      const usedByOthers = new Set(model.factors.filter((o) => o !== f).map((o) => refs[o]));
      const sel = el('select', {
        class: 'select select-sm mono', 'aria-label': `Referent for ${f}`,
        onchange: (e) => { refs[f] = e.target.value; buildPickers(); refresh(); },
      }, model.items.map((it) => el('option', { value: it, selected: refs[f] === it, disabled: usedByOthers.has(it) }, it)));
      pickRow.append(el('label', { class: 'name-row' }, [el('span', { class: 'k' }, fLabel(f)), sel]));
    }
  };
  buildPickers();
  body.push(el('div', { class: 'field' }, [el('label', {}, 'Referent indicator per factor'), pickRow]));
  body.push(pre, note);
  body.push(el('div', { class: 'row' }, [
    canRun ? btn('Run in Mplus', { size: 'btn-sm', kind: 'btn-primary', icon: 'play', onclick: async () => {
      try {
        await runner.runMore(m.runId, { files: [{ name: state.name, text: state.inp }], run: [state.name] });
        appState.parsed = appState.parsed.filter((x) => x.fileName !== expectedOutName(state.name));
        toast(`${state.name} queued in Mplus — its tables join the manuscript when it finishes`, 'ok');
        renderResultsOutput(); renderTrack(); renderMplusPill();
      } catch (e) { toast('Mplus: ' + e.message, 'err'); }
    } }) : null,
    btn('Copy syntax', { size: 'btn-sm', icon: 'copy', onclick: async () => {
      try { await navigator.clipboard.writeText(state.inp); toast('ESEM-within-CFA syntax copied', 'ok'); }
      catch { toast('Copy failed — select the text manually', 'err'); }
    } }),
    btn('Download .inp', { size: 'btn-sm', kind: canRun ? '' : 'btn-primary', icon: 'download', onclick: () => downloadText(state.inp, state.name) }),
  ]));

  refresh();
  return body;
}

/** Path diagram: the figure lives in the paper (holder); its options live in a control card. */
function buildDiagram(m, factorLabels, secId, n) {
  const state = { showCross: true, showResiduals: true, theoretical: false, hidden: new Set(), crossThreshold: 0.10, positions: {} };
  const holder = el('div', { class: 'fig' });
  const optsNow = () => ({ factorLabels, showCross: state.showCross, showResiduals: state.showResiduals, theoretical: state.theoretical, hiddenFactors: [...state.hidden], crossThreshold: state.crossThreshold, positions: state.positions });
  const draw = () => { holder.innerHTML = pathDiagramSVG(m.parsed, optsNow()); };
  const svgNow = () => pathDiagramSVG(m.parsed, optsNow());

  // ── free-drag the factor ellipses (cosmetic only — never changes the model or syntax) ──
  // Listeners live on the persistent holder (the SVG is rebuilt each frame), so pointer capture
  // survives re-renders. Dragged positions go into state.positions and feed back through optsNow.
  let dragF = null, grabDX = 0, grabDY = 0, rafPending = false;
  const scheduleDraw = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); };
  const toSvg = (e) => { const svg = holder.querySelector('svg'); if (!svg) return null; const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const mt = svg.getScreenCTM(); return mt ? pt.matrixTransform(mt.inverse()) : null; };
  holder.addEventListener('pointerdown', (e) => {
    const grp = e.target.closest && e.target.closest('[data-factor]'); if (!grp) return;
    const f = grp.getAttribute('data-factor'), p = toSvg(e); if (!p) return;
    const cx = state.positions[f]?.x ?? parseFloat(grp.getAttribute('data-cx'));
    const cy = state.positions[f]?.y ?? parseFloat(grp.getAttribute('data-cy'));
    dragF = f; grabDX = p.x - cx; grabDY = p.y - cy; state.positions[f] = { x: cx, y: cy };
    holder.style.cursor = 'grabbing';
    try { holder.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  holder.addEventListener('pointermove', (e) => {
    if (!dragF) return; const p = toSvg(e); if (!p) return;
    state.positions[dragF] = { x: p.x - grabDX, y: p.y - grabDY }; scheduleDraw();
  });
  const endDrag = (e) => { if (!dragF) return; dragF = null; holder.style.cursor = ''; try { holder.releasePointerCapture(e.pointerId); } catch {} };
  holder.addEventListener('pointerup', endDrag);
  holder.addEventListener('pointercancel', endDrag);

  const toggle = (label, key) => el('label', { class: 'toggle' }, [
    el('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; draw(); } }), label,
  ]);
  const toggles = el('div', { class: 'row', style: { gap: '6px 22px' } }, [toggle('Theoretical (blank)', 'theoretical'), toggle('Cross-loadings', 'showCross'), toggle('Uniquenesses', 'showResiduals')]);

  // Per-factor show/hide chips + a cross-loading threshold slider, so the user can tailor the
  // figure for their report (e.g. isolate the G-factor, or hide small cross-loadings).
  const chips = el('div', { class: 'chips' });
  for (const f of m.parsed.factorOrder) {
    const isG = m.parsed.generalFactor === f;
    const chip = el('button', { type: 'button', class: 'chip chip-sm', 'data-tip': isG ? 'General factor' : 'Specific factor' }, [el('i', { class: `lv ${isG ? 'l2' : 'l1'}`, 'aria-hidden': 'true' }), factorLabels[f] || f]);
    const sync = () => chip.setAttribute('aria-pressed', String(!state.hidden.has(f)));
    chip.onclick = () => { state.hidden.has(f) ? state.hidden.delete(f) : state.hidden.add(f); sync(); draw(); };
    sync();
    chips.append(chip);
  }
  const fmtTh = (x) => (x <= 0 ? '0' : '.' + String(Math.round(x * 100)).padStart(2, '0'));
  const thVal = el('span', { class: 'mono small', style: { minWidth: '2.2em', textAlign: 'right', color: 'var(--ink-2)' } }, fmtTh(state.crossThreshold));
  const slider = el('input', { type: 'range', class: 'range', min: '0', max: '0.5', step: '0.05', value: String(state.crossThreshold), 'aria-label': 'minimum cross-loading shown', oninput: (e) => { state.crossThreshold = parseFloat(e.target.value); thVal.textContent = fmtTh(state.crossThreshold); draw(); } });
  const thRow = el('div', { class: 'row' }, [el('span', { class: 'small muted' }, 'Show cross-loadings ≥'), slider, thVal]);
  const layoutRow = el('div', { class: 'row' }, [
    el('span', { class: 'hint', style: { margin: '0' } }, 'Drag the ellipses in the figure to reposition the factors.'),
    btn('Reset layout', { size: 'btn-sm', kind: 'btn-ghost', icon: 'reset', title: 'Return the factors to the automatic layout', onclick: () => { state.positions = {}; draw(); } }),
  ]);
  const body = [
    el('div', { class: 'field' }, [el('label', {}, 'Show factors'), chips]),
    toggles, thRow, layoutRow,
    el('div', { class: 'row' }, [paperLink('In the paper: the path diagram', secId)]),
  ];
  const tools = [
    btn('SVG', { size: 'btn-sm', icon: 'download', onclick: () => downloadText(svgNow(), `diagram_${m.label.replace(/\W+/g, '_')}.svg`, 'image/svg+xml') }),
    btn('PNG', { size: 'btn-sm', icon: 'image', onclick: () => downloadSvgAsPng(svgNow(), `diagram_${m.label.replace(/\W+/g, '_')}.png`) }),
  ];
  draw();
  return { holder, controls: card(n, `Figure options — ${m.label}`, 'The path diagram updates in the manuscript.', body, tools) };
}

// ============================ The paper ============================
function renderPaper() {
  const secs = [];
  const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const d = appState.data, spec = appState.spec;
  const title = d?.fileName ? d.fileName.replace(/\.[^.]+$/, '') : 'Untitled study';
  secs.push({ id: 'head', filled: !!d, html: `<div class="ms-run"><span>ESEM Analyzer · Mplus workbench for ESEM</span><span>Draft · ${esc(date)}</span></div><h1 class="ms-title">${esc(title)}</h1>` });

  // Method — the hypothesized model, drawn from Λ as it is sketched
  let method = '<h2 class="rep-h">Method</h2>';
  let methodFilled = false;
  if (spec && appState.reached.model) {
    const models = requestedModels(spec);
    if (models.length) {
      const key = models.find((x) => x.key === appState.previewKey)?.key || models[0].key;
      const label = models.find((x) => x.key === key)?.label || key;
      const modelType = modelTypeOf(key);
      const rot = modelType === 'cfa' || modelType === 'bifactorCfa' ? '' : `; ${spec.rotation.type === 'TARGET' ? 'target' : 'Geomin'} rotation (${spec.rotation.oblique ? 'oblique' : 'orthogonal'}${spec.rotation.type === 'GEOMIN' && spec.rotation.epsilon != null ? `, ε = ${spec.rotation.epsilon}` : ''})`;
      const cap = `Hypothesized ${label} measurement model: ${spec.factors.length} ${spec.factors.length === 1 ? 'factor' : 'factors'}, ${spec.items.length} items${rot}; ${spec.estimator} estimator.`;
      method += figCap(cap) + `<div class="fig">${conceptDiagramSVG(spec, modelType, { showResiduals: false })}</div>`;
      methodFilled = true;
    } else {
      method += ph('Select at least one model type to draw the hypothesized measurement model.', goTarget('model'));
    }
  } else {
    method += ph('The hypothesized measurement model is drawn here as you sketch Λ.', goTarget('model')) + phLines(2);
  }
  secs.push({ id: 'method', filled: methodFilled, html: method });

  // Results — the APA tables, figures and text parsed from the .out files
  const rs = appState.resultSections;
  const resHead = '<h2 class="rep-h">Results</h2>';
  if (rs.length) {
    rs.forEach((s, i) => {
      if (i !== 0) { secs.push(s); return; }
      if (s.node) {
        if (!s.node._resHead) { s.node.insertAdjacentHTML('afterbegin', resHead); s.node._resHead = true; }
        secs.push(s);
      } else secs.push({ ...s, html: resHead + s.html });
    });
  } else {
    const go = goTarget('results');
    secs.push({ id: 'fit', filled: false, html: resHead + ph('Goodness-of-fit statistics are tabulated here from your Mplus .out files.', go) + phLines(3) });
    secs.push({ id: 'loadings', filled: false, html: ph('Standardized factor loadings (STDYX) and the path diagram appear here for each model.', go) + phLines(5) });
    secs.push({ id: 'prose', filled: false, html: ph('Suggested APA text is drafted here from the fit indices and loadings.', go) + phLines(3) });
  }

  // Appendix — the generated Mplus input
  const files = appState.syntaxModels;
  let app = '<h2 class="rep-h">Appendix</h2>';
  if (files && files.length && spec) {
    app += `<p class="ms-meta">Mplus input generated by ESEM Analyzer (click a file to read it):</p><ul class="ms-files">${files.map((f) => `<li><button type="button" class="link" data-open-inp="${esc(f.key)}"><span class="mono">${esc(f.file)}</span></button> — ${esc(f.label)}</li>`).join('')}</ul>`;
  } else {
    app += ph('The generated Mplus input files are listed here.', goTarget('syntax')) + phLines(2);
  }
  secs.push({ id: 'appendix', filled: !!(files && files.length), html: app });

  paper.set(secs);
  setDeskStatus(secs.filter((s) => s.id !== 'head' && s.filled).length, secs.length - 1);
}

// Export tools in the desk bar: the existing Word / .docx exporters, enabled once output exists.
let exportBtns = null;
function updateExportTools() {
  const host = $('#db-tools'); if (!host) return;
  if (!exportBtns) {
    exportBtns = [
      btn('Copy for Word', { size: 'btn-sm', icon: 'copy', onclick: () => copyResultsToWord(appState.parsed, { factorLabels: exportLabels() }) }),
      btn('.docx', { size: 'btn-sm', kind: 'btn-primary', icon: 'download', title: 'Download the results as a Word document', onclick: () => exportDocx(appState.parsed, { factorLabels: exportLabels() }) }),
    ];
    host.replaceChildren(...exportBtns);
  }
  exportBtns.forEach((b) => { b.disabled = !appState.parsed.length; });
}

function wirePaper() {
  $('#paperBody')?.addEventListener('click', (e) => {
    const go = e.target.closest('.ph-go[data-go]');
    if (go) {
      if (go.dataset.act === 'continue' && appState.data && !appState.reached.model) continueToModel();
      else if (go.dataset.act === 'results') { unlock('results'); renderResultsStep(); }
      else goStep(go.dataset.go);
      return;
    }
    const inp = e.target.closest('[data-open-inp]');
    if (inp) openSyntaxSheet(inp.dataset.openInp);
  });
}

// ============================ Local Mplus (serve.mjs) ============================
// Topbar pill: the Mplus found on this computer, its version, and whether it is running right now.
function renderMplusPill() {
  const slot = $('#mplusSlot'); if (!slot) return;
  if (runner.state.server === false) {   // static hosting: offer to connect to a runner on this computer
    slot.innerHTML = `<button type="button" class="pill" data-tip="Connect this page to ESEM-Analyzer.exe or node serve.mjs running on this computer"><span class="mdot"></span>Connect Mplus</button>`;
    slot.querySelector('button').onclick = () => connectRunner().then((ok) => { if (!ok) openGuide(); });
    return;
  }
  const h = runner.state.health;
  if (!h) { slot.innerHTML = `<span class="pill"><span class="mdot"></span>Mplus<span class="pill-label"> · checking</span></span>`; return; }
  const m = h.mplus;
  if (m.ok) {
    const busy = runner.active();
    slot.innerHTML = `<span class="pill" tabindex="0" data-tip="${runner.state.remote ? 'Runner on this computer via ' + esc(runner.state.base) + ' · ' : ''}${esc(m.path)} · runs are written to ${esc(h.runsDir || 'mplus-runs')}"><span class="mdot ${busy ? 'run' : 'ok'}"></span>Mplus ${esc(m.version)}${busy ? '<span class="pill-label"> · running</span>' : ''}</span>`;
  } else if (!m.checked) {
    slot.innerHTML = `<span class="pill" tabindex="0" data-tip="Checking the Mplus installation…"><span class="mdot"></span>Mplus<span class="pill-label"> · checking</span></span>`;
  } else {
    slot.innerHTML = `<span class="pill" tabindex="0" data-tip="${esc(m.error || 'Mplus was not found on this computer')}"><span class="mdot bad"></span>Mplus<span class="pill-label"> · not found</span></span>`;
  }
}

// Job events: a finished job's .out is read from the run folder and imported exactly like a dropped file.
const importedJobs = new Set();
async function onRunnerEvent(type, job, prev) {
  if (type === 'health') {
    renderMplusPill();
    updateGuide();
    if (job === 'lost') toast('The runner on this computer is no longer reachable — back to download / upload', 'err');
    // the Syntax step may have been drawn before the server answered (deep links): redraw it with the runner
    if (appState.reached.syntax && appState.spec && $('#syntax-host')?.childElementCount) renderSyntaxStep();
    renderResultsBar();
    return;
  }
  if (type !== 'job') return;
  const run = appState.run;
  if (job.status === 'done' && run && job.run === run.id && !importedJobs.has(job.id)) {
    importedJobs.add(job.id);
    try {
      const text = await runner.fileText(run.id, job.out);
      importOutText(text, job.out, { runId: run.id, jobId: job.id });
      if (!appState.reached.results) { appState.reached.results = true; renderResultsStep(); } else renderResultsOutput();
    } catch (e) { toast(`${job.out}: ${e.message}`, 'err'); }
    const jobs = runner.jobsOf(run.id);
    if (jobs.length && jobs.every((j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')) toast('Mplus finished — the manuscript is up to date', 'ok');
  } else if (job.status === 'error' && prev?.status !== 'error') {
    toast(`${job.name}: ${job.error || 'Mplus reported an error'}`, 'err');
  }
  syntaxView?.update(); renderSyntaxBar(); renderResultsBar(); renderTrack(); renderMplusPill();
}

// ============================ dev bootstrap (screenshots) ============================
const SAMPLE_DATA = {
  fileName: 'ESEM.dat', mplusFile: 'ESEM.dat', needsMplusDat: false, delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 4500,
  varNames: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'GV'],
  categorical: [], missingCode: null,
  preview: [
    ['0.66', '0.45', '0.46', '0.71', '0.43', '0.57', '0.51', '0.38', '0.49', '0.66', '0.40', '0.55', '1'],
    ['-1.2', '0.88', '1.13', '2.04', '0.92', '0.34', '0.77', '1.10', '0.21', '1.42', '0.88', '0.63', '1'],
    ['1.84', '0.64', '-0.39', '0.16', '1.43', '2.04', '0.55', '0.48', '0.34', '0.71', '0.43', '0.57', '2'],
    ['0.20', '1.10', '0.46', '0.71', '0.21', '0.34', '0.88', '0.21', '1.42', '0.16', '1.43', '0.34', '2'],
    ['0.51', '0.38', '0.49', '0.66', '0.40', '0.55', '0.66', '0.45', '0.46', '0.71', '0.43', '0.57', '1'],
  ],
};
SAMPLE_DATA._matrix = SAMPLE_DATA.preview;
async function devBootstrap(which) {
  appState.data = JSON.parse(JSON.stringify(SAMPLE_DATA));
  if (which === 'data') { renderDataReview(appState.data); goStep('data'); return; }
  appState.spec = createModelSpec(appState.data);
  if (which === 'modelinv') { appState.spec.groups.enabled = true; appState.spec.groups.variable = 'GV'; appState.spec.groups.codes = [{ code: '1', label: 'group1' }, { code: '2', label: 'Group2' }]; }
  renderDataReview(appState.data);
  appState.builder = null; unlock('model'); appState.builder = mountModelBuilder($('#model-host'), appState.spec, { onChange: onModelChange, onBack: () => goStep('data') });
  if (which === 'model' || which === 'modelinv') return;
  unlock('syntax'); renderSyntaxStep();
  if (which === 'syntax') { goStep('syntax'); return; }
  const fixtures = which === 'resultsbf' ? ['bifactor_esem.out', 'bifactor_cfa.out']
    : which === 'resultsewc' ? ['esem_svalues.out']
    : (which === 'resultsinv' || which === 'exportinv') ? ['inv_configural.out', 'inv_metric.out', 'inv_scalar.out', 'inv_strict.out', 'inv_varcov.out', 'inv_latentmean.out']
    : ['cfa_2f.out', 'esem_geomin.out'];
  for (const n of fixtures) {
    try { const t = await fetch('test/fixtures/' + n).then((r) => r.text()); const p = parseOut(t); appState.parsed.push({ label: deriveLabel(p, n), parsed: p, fileName: n, raw: t }); } catch {}
  }
  unlock('results'); renderResultsStep();
  if (which === 'exporttest' || which === 'exportinv') {
    try {
      await new Promise((r) => setTimeout(r, 600)); // let CDN UMD libs settle
      const post = async (name, blob) => { if (blob) await fetch('/save?name=' + name, { method: 'POST', body: blob }); };
      await post('devtest.docx', await buildDocxBlob(appState.parsed, {}));
      await post('devtest.zip', await buildZipBlob([{ name: 'CFA.inp', text: buildInp(appState.spec, 'cfa') }, { name: 'ESEM.inp', text: buildInp(appState.spec, 'esem') }]));
      document.title = 'EXPORT_DONE';
    } catch (e) { /* dev-only helper */ }
  }
}

// Public demo mode: load the bundled 3-factor example .out files straight into Results so a
// first-time visitor sees real APA tables, diagrams, and the ESEM-within-CFA card in one click.
// (Distinct from the developer-only `?dev=` fixtures.)
const DEMO_SETS = {
  results: ['1_CFA.out', '2_ESEM_geomin.out', '5_Bifactor_ESEM.out'],
  measurement: ['1_CFA.out', '2_ESEM_geomin.out', '3_ESEM_target.out', '4_Bifactor_CFA.out', '5_Bifactor_ESEM.out'],
  esem: ['2_ESEM_geomin.out'],
  target: ['3_ESEM_target.out'],
  bifactorcfa: ['4_Bifactor_CFA.out'],
  bifactor: ['5_Bifactor_ESEM.out'],
  ewc: ['2_ESEM_geomin.out'],
  invariance: ['inv_1_configural.out', 'inv_2_metric.out', 'inv_3_scalar.out', 'inv_4_strict.out', 'inv_5_varcov.out', 'inv_6_latentmean.out'],
  // 2-wave (12 items × 2) well-being example: ESEM + bifactor-ESEM longitudinal sequences.
  longitudinal: [
    'LongInv_esem_1_configural.out', 'LongInv_esem_2_metric.out', 'LongInv_esem_3_scalar.out',
    'LongInv_esem_4_strict.out', 'LongInv_esem_5_varcov.out', 'LongInv_esem_6_latentmean.out',
    'LongInv_besem_1_configural.out', 'LongInv_besem_2_metric.out', 'LongInv_besem_3_scalar.out',
    'LongInv_besem_4_strict.out', 'LongInv_besem_5_varcov.out', 'LongInv_besem_6_latentmean.out',
  ],
};
// ============================ Example data (the article's two data sets) ============================
// Morin's (2023) Ch27 data sets with the model of the tutorial: the file, the variable names and the sketch
// load in one step (Data page card or ?example=data1|data2), then Generate syntax reproduces the article's inputs.
const EXAMPLES = {
  data1: { file: 'Ch27-Data1.dat', preset: 'data1-model.json', title: 'Data Set 1 (two groups)',
    names: ['X1', 'X2', 'X3', 'X4', 'Y1', 'Y2', 'Y3', 'Y4', 'Z1', 'Z2', 'Z3', 'Z4', 'GROUP'] },
  data2: { file: 'Ch27-Data2.dat', preset: 'data2-model.json', title: 'Data Set 2 (two occasions)',
    names: ['x1_t1', 'x2_t1', 'x3_t1', 'x4_t1', 'y1_t1', 'y2_t1', 'y3_t1', 'y4_t1', 'z1_t1', 'z2_t1', 'z3_t1', 'z4_t1', 'x1_t2', 'x2_t2', 'x3_t2', 'x4_t2', 'y1_t2', 'y2_t2', 'y3_t2', 'y4_t2', 'z1_t2', 'z2_t2', 'z3_t2', 'z4_t2'] },
};
async function loadExample(id) {
  const ex = EXAMPLES[id];
  if (!ex) { toast('Unknown example: ' + id, 'err'); return; }
  try {
    const base = 'example-dataset/ch27/';
    const get = (n) => fetch(base + n).then((r) => { if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`); return r; });
    const [text, saved] = await Promise.all([get(ex.file).then((r) => r.text()), get(ex.preset).then((r) => r.json())]);
    const data = parseDataFile(text, ex.file);
    data.varNames = ex.names.slice();
    data.categorical = [];
    appState.data = data;
    appState.dataText = text;
    renderDataReview(data);
    appState.spec = createModelSpec(data);
    appState.spec.signature = specSignature(data);
    const r = applySavedSpec(appState.spec, saved);
    if (!r.ok) throw new Error('the model preset does not match the file');
    saveSpecLocal(appState.spec);
    appState.builder = null;
    unlock('model');
    appState.builder = mountModelBuilder($('#model-host'), appState.spec, { onChange: onModelChange, onBack: () => goStep('data') });
    toast(`${ex.title} loaded with the article’s model — press Generate syntax`, 'ok');
  } catch (err) {
    toast('Could not load the example: ' + err.message, 'err');
  }
}

async function demoBootstrap(which) {
  // Model / Syntax: rebuild the 3-factor example spec from the bundled data file so the
  // builder and the generated syntax are shown on the same 15-item / 3-factor example.
  if (which === 'model' || which === 'syntax') {
    try {
      const text = await fetch('example-dataset/data.dat').then((r) => r.text());
      const data = parseDataFile(text, 'data.dat');
      appState.dataText = text;
      data.varNames = Array.from({ length: 15 }, (_, i) => 'i' + (i + 1)).concat('gender');
      data.mplusFile = 'data.dat';
      appState.data = data;
      const spec = createModelSpec(data);
      spec.items = data.varNames.slice(0, 15);
      spec.factors = [1, 2, 3].map((i) => ({ id: 'F' + i, label: 'F' + i }));
      spec.target = {};
      spec.items.forEach((it, i) => { spec.target[it] = {}; spec.factors.forEach((f, fi) => { spec.target[it][f.id] = fi === Math.floor(i / 5); }); });
      spec.rotation = { type: 'GEOMIN', oblique: true, epsilon: 0.5 };
      appState.spec = spec;
      renderDataReview(data);
      appState.builder = null; unlock('model'); appState.builder = mountModelBuilder($('#model-host'), spec, { onChange: onModelChange, onBack: () => goStep('data') });
      if (which === 'syntax') { unlock('syntax'); renderSyntaxStep(); goStep('syntax'); }
    } catch { toast('Demo: could not load data.dat', 'err'); }
    return;
  }
  // Results: load the bundled 3-factor .out files straight into Results.
  appState.reached.model = appState.reached.syntax = true;
  unlock('results'); renderResultsStep();
  const files = DEMO_SETS[which] || DEMO_SETS.results;
  for (const n of files) {
    try {
      const t = await fetch('example-dataset/' + n).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      const p = parseOut(t);
      appState.parsed.push({ label: deriveLabel(p, n), parsed: p, fileName: n, raw: t });
    } catch { toast(`Demo: could not load ${n}`, 'err'); }
  }
  renderResultsOutput();
}

// ============================ init ============================
function init() {
  $$('#stepper .trk').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
  wireDropzone();
  wirePaper();
  renderDataBar();
  updateExportTools();
  renderTrack();
  renderPaper();
  document.addEventListener('autorun:sync', renderTrack);
  runner.on(onRunnerEvent);
  renderMplusPill();
  runner.init();
  $('#guide-btn')?.addEventListener('click', () => openGuide());
  // Shortcut for users who already have .out files and don't need to build a model.
  $('#skip-to-results')?.addEventListener('click', () => { appState.reached.model = appState.reached.syntax = true; unlock('results'); renderResultsStep(); });
  const params = new URLSearchParams(location.search);
  $('#ex-load-data1')?.addEventListener('click', () => loadExample('data1'));
  $('#ex-load-data2')?.addEventListener('click', () => loadExample('data2'));
  const demo = params.get('demo'), dev = params.get('dev'), example = params.get('example');
  if (demo) demoBootstrap(demo);
  else if (dev) devBootstrap(dev);
  else if (example) loadExample(example);
  else autoOpenGuide();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
