// model-builder.js — Step 2 UI: factor controls, the Λ target-pattern grid, and the live
// syntax preview (opened in the Mplus sheet). Mutates the shared ModelSpec via state.js helpers
// and re-renders; the paper on the right draws the hypothesized model from the same spec.
import { el, $, $$, toast } from './ui.js';
import { setFactorCount, setItems, setWaveItems, toggleTarget, factorIds, validateSpec } from './state.js';
import { buildInp, requestedModels, INV_SEQUENCE, INV_META } from './syntax-generator.js';
import { distinctValues } from './data-parse.js';
import { ctrlHead, ctrlWrap, card, callout, btn, stepBar, sheet } from './shell.js';

let SPEC = null;
let onChange = () => {};
let onBack = () => {};
let activeKey = null;   // the model whose syntax is previewed and whose structure the paper draws
let barHost = null;

export function mountModelBuilder(host, spec, opts = {}) {
  SPEC = spec; onChange = opts.onChange || (() => {}); onBack = opts.onBack || (() => {});
  activeKey = null;
  host.innerHTML = '';
  host.append(buildLayout());
  refresh();
  return { refresh }; // main.js re-validates through this when the step is shown again
}

function buildLayout() {
  const head = ctrlHead('Step 2 · Model', 'Sketch the factor pattern', 'Choose the items and factors, mark each item’s target loading in Λ, then pick the rotation, the estimator, and the models to generate.');
  const body = [];

  // 1 · items
  body.push(card(1, 'Items', 'Variables that load on the factors', [el('div', { id: 'mb-items', class: 'chips' })]));

  // 2 · factors
  body.push(card(2, 'Factors', 'How many latent factors, and their labels in the tables', [
    el('div', { class: 'row' }, [
      stepperControl('mb-nfac', SPEC.factors.length, (k) => { setFactorCount(SPEC, k); refresh(); }),
      el('div', { id: 'mb-faclabels', class: 'faclabels' }),
    ]),
  ]));

  // 3 · the Λ grid — the signature
  body.push(card(3, 'Λ target pattern', 'Mark each item’s target loading', [
    el('div', { class: 'lam-wrap' }, el('div', { id: 'mb-grid' })),
    gridLegend(),
  ], [el('span', { class: 'small muted', id: 'mb-grid-hint' }, '')]));

  // 4 · rotation & estimator
  body.push(card(4, 'Rotation & estimator', 'How the solution is rotated and estimated', [rotationControls()]));

  // 5 · model types
  body.push(card(5, 'Models to generate', 'One .inp per switched-on model', [modelTypeControls()],
    [btn('Preview syntax', { size: 'btn-sm', icon: 'file', onclick: openPreview })]));

  // 6 · measurement invariance
  body.push(card(6, 'Measurement invariance', 'Across groups or time (optional)', [el('div', { id: 'mb-groups' })]));

  // validation messages
  body.push(el('div', { id: 'mb-validation', class: 'flex flex-col gap-2' }));

  barHost = el('div', { class: 'contents' });
  return ctrlWrap(head, body, barHost);
}

// ---------- pieces ----------
function stepperControl(id, value, onset) {
  const out = el('div', { class: 'numstep' });
  const val = el('span', { id, class: 'val' }, String(value));
  const mk = (txt, d) => el('button', {
    type: 'button', onclick: () => { const cur = parseInt(val.textContent, 10); onset(cur + d); },
    'aria-label': d > 0 ? 'more factors' : 'fewer factors',
  }, txt);
  out.append(mk('−', -1), val, mk('+', +1));
  return out;
}

const field = (label, control) => el('div', { class: 'field' }, [label ? el('label', {}, label) : null, control]);

function rotationControls() {
  const box = el('div', { class: 'flex flex-col gap-3' });
  box.append(field('Rotation', el('div', { class: 'row' }, [
    segmented('mb-rot', [{ v: 'GEOMIN', t: 'Geomin' }, { v: 'TARGET', t: 'Target' }], SPEC.rotation.type,
      (v) => { SPEC.rotation.type = v; if (v === 'GEOMIN' && SPEC.rotation.epsilon == null) SPEC.rotation.epsilon = 0.5; refresh(); }),
    segmented('mb-obl', [{ v: 'OBLIQUE', t: 'Oblique' }, { v: 'ORTHOGONAL', t: 'Orthogonal' }], SPEC.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL',
      (v) => { SPEC.rotation.oblique = v === 'OBLIQUE'; refresh(); }),
  ])));
  box.append(el('div', { id: 'mb-eps-wrap', class: 'row' }, [
    el('label', { for: 'mb-eps', class: 'lbl', style: { margin: '0' } }, 'Geomin ε'),
    el('input', {
      id: 'mb-eps', type: 'number', step: '0.1', min: '0',
      value: SPEC.rotation.epsilon ?? '', placeholder: 'default',
      class: 'input input-sm mono', style: { width: '7rem' },
      oninput: (e) => { const v = e.target.value.trim(); SPEC.rotation.epsilon = v === '' ? null : parseFloat(v); updatePreview(); },
    }),
  ]));
  box.append(field('Estimator', segmented('mb-est', [{ v: 'MLR', t: 'MLR' }, { v: 'WLSMV', t: 'WLSMV' }], SPEC.estimator, (v) => { SPEC.estimator = v; refresh(); })));
  return box;
}

function modelTypeControls() {
  const types = [
    { k: 'cfa', t: 'CFA', d: 'independent-cluster confirmatory model' },
    { k: 'esem', t: 'ESEM', d: 'all cross-loadings freely estimated' },
    { k: 'bifactorCfa', t: 'Bifactor-CFA', d: 'orthogonal general + specific factors' },
    { k: 'bifactorEsem', t: 'Bifactor-ESEM', d: 'general + specific factors (BI-GEOMIN / target)' },
  ];
  const box = el('div', { class: 'opt-grid-2' });
  for (const ty of types) {
    const id = `mt-${ty.k}`;
    box.append(el('label', { class: 'toggle block', for: id }, [
      el('input', { id, type: 'checkbox', checked: SPEC.modelTypes[ty.k], onchange: (e) => { SPEC.modelTypes[ty.k] = e.target.checked; updatePreview(); refresh(); } }),
      el('span', {}, [el('span', { class: 'tg-t' }, ty.t), el('span', { class: 'tg-d' }, ty.d)]),
    ]));
  }
  return box;
}

function segmented(id, opts, current, onpick) {
  const box = el('div', { id, class: 'seg', role: 'group' });
  for (const o of opts) {
    box.append(el('button', { type: 'button', 'data-v': o.v, 'aria-pressed': o.v === current ? 'true' : 'false', onclick: () => onpick(o.v) }, o.t));
  }
  return box;
}

function gridLegend() {
  return el('div', { class: 'lam-legend' }, [
    el('span', {}, [el('span', { class: 'lam-sw main', 'aria-hidden': 'true' }, el('i')), 'target (main) loading']),
    el('span', {}, [el('span', { class: 'lam-sw cross', 'aria-hidden': 'true' }, el('i')), 'free cross-loading (ESEM)']),
    el('span', {}, [el('span', { class: 'lam-sw', 'aria-hidden': 'true' }, el('i')), 'fixed to 0']),
  ]);
}

// ---------- render/update ----------
function refresh() {
  // items chips
  const itemBox = $('#mb-items');
  if (itemBox) {
    itemBox.innerHTML = '';
    for (const v of SPEC.data.varNames) {
      const on = SPEC.items.includes(v);
      itemBox.append(el('button', {
        type: 'button', class: 'chip chip-sm mono', 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          const next = on ? SPEC.items.filter((x) => x !== v) : SPEC.data.varNames.filter((x) => SPEC.items.includes(x) || x === v);
          if (next.length >= 1) { setItems(SPEC, next); refresh(); }
        },
      }, v));
    }
  }
  // factor count + labels
  const nf = $('#mb-nfac'); if (nf) nf.textContent = String(SPEC.factors.length);
  const fl = $('#mb-faclabels');
  if (fl) {
    fl.innerHTML = '';
    SPEC.factors.forEach((f) => {
      fl.append(el('input', {
        value: f.label, 'aria-label': `label for ${f.id}`, class: 'input input-sm mono',
        oninput: (e) => { f.label = e.target.value || f.id; updatePreview(); },
      }));
    });
  }
  // epsilon visibility
  const epsWrap = $('#mb-eps-wrap'); if (epsWrap) epsWrap.style.display = SPEC.rotation.type === 'GEOMIN' ? 'flex' : 'none';
  syncSegmented('mb-rot', SPEC.rotation.type);
  syncSegmented('mb-obl', SPEC.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL');
  syncSegmented('mb-est', SPEC.estimator);

  renderGroups();
  renderGrid();
  renderValidation();
  updatePreview();
}

function renderGroups() {
  const host = $('#mb-groups'); if (!host) return;
  host.innerHTML = '';
  const invOn = SPEC.groups.enabled || SPEC.longitudinal.enabled;

  // master enable
  host.append(el('label', { class: 'toggle' }, [
    el('input', { type: 'checkbox', checked: invOn, onchange: (e) => {
      if (e.target.checked) setInvMode('groups'); else { SPEC.groups.enabled = false; SPEC.longitudinal.enabled = false; }
      refresh();
    } }),
    el('span', { class: 'tg-t' }, 'Test measurement invariance'),
  ]));
  if (!invOn) return;

  // mode: across groups ↔ across time points (mutually exclusive)
  const mode = SPEC.longitudinal.enabled ? 'time' : 'groups';
  host.append(el('div', { class: 'mt-3' }, segmented('mb-invmode', [
    { v: 'groups', t: 'Across groups' }, { v: 'time', t: 'Across time' },
  ], mode, (v) => { setInvMode(v); refresh(); })));

  if (mode === 'time') renderTimeMode(host);
  else renderGroupsMode(host);

  // shared: invariance steps
  const seqHolder = mode === 'time' ? SPEC.longitudinal.invariance : SPEC.groups.invariance;
  const seqBox = el('div', { class: 'chips' });
  for (const step of INV_SEQUENCE) {
    const on = seqHolder.sequence.includes(step);
    seqBox.append(el('button', { type: 'button', class: 'chip chip-sm', 'aria-pressed': on ? 'true' : 'false', onclick: () => { toggleStep(seqHolder, step, !on); updatePreview(); renderGroups(); } }, INV_META[step].label));
  }
  host.append(el('p', { class: 'sub-h' }, 'Invariance steps (in order)'), seqBox);

  const banner = mode === 'time'
    ? 'With time on, “Generate syntax” produces a longitudinal invariance sequence (one .inp per step, for each checked CFA/ESEM model). The Λ grid above is the Time-1 pattern, mirrored to Time 2; matching indicators’ residuals are correlated across waves.'
    : 'With grouping on, “Generate syntax” produces this invariance sequence (using the first-order ESEM measurement model above — plus a bifactor-ESEM sequence when that model type is checked), one .inp per step.';
  host.append(el('div', { class: 'mt-3' }, callout('info', banner)));
}

function renderGroupsMode(host) {
  const avail = SPEC.data.varNames.filter((v) => !SPEC.items.includes(v));
  if (!avail.length) { host.append(el('div', { class: 'mt-3' }, callout('err', 'Leave a variable unselected as items to use it for grouping.'))); return; }
  if (!SPEC.groups.variable) pickGroupVar(avail[0]);
  const sel = el('select', { class: 'select select-sm mono', onchange: (e) => { pickGroupVar(e.target.value); refresh(); } },
    avail.map((v) => el('option', { value: v, selected: v === SPEC.groups.variable }, v)));
  host.append(el('div', { class: 'field mt-3' }, [el('label', {}, 'Grouping variable'), sel]));

  if (SPEC.groups.codes.length) {
    const codeBox = el('div', { class: 'namegrid' });
    SPEC.groups.codes.forEach((c) => codeBox.append(el('div', { class: 'name-row' }, [
      el('span', { class: 'k' }, `= ${c.code}`),
      el('input', { value: c.label, class: 'input input-sm', 'aria-label': `label for group ${c.code}`, oninput: (e) => { c.label = e.target.value.trim() || ('g' + c.code); updatePreview(); } }),
    ])));
    host.append(el('p', { class: 'sub-h' }, 'Group labels'), codeBox);
  }
}

function renderTimeMode(host) {
  const L = SPEC.longitudinal;
  // wave labels + indicator pickers (Time-1 columns drive the Λ grid; Time-2 are positionally matched)
  [0, 1].forEach((idx) => {
    const labelInput = el('input', { value: L.waveLabels[idx] || '', class: 'input input-sm', style: { width: '9rem' }, 'aria-label': `${idx ? 'Time 2' : 'Time 1'} label`, oninput: (e) => { L.waveLabels[idx] = e.target.value || (idx ? 'Time 2' : 'Time 1'); updatePreview(); } });
    host.append(el('div', { class: 'row mt-3' }, [el('span', { class: 'lbl', style: { margin: '0' } }, idx ? 'Time 2' : 'Time 1'), labelInput]));
    host.append(wavePicker(idx));
  });
  host.append(el('label', { class: 'toggle block', style: { marginTop: '10px' } }, [
    el('input', { type: 'checkbox', checked: L.correlatedUniqueness, onchange: (e) => { L.correlatedUniqueness = e.target.checked; updatePreview(); } }),
    el('span', {}, [el('span', { class: 'tg-t' }, 'Correlated uniquenesses'), el('span', { class: 'tg-d' }, 'Correlate each indicator’s residual across the two waves (recommended).')]),
  ]));
}

// Indicator chips for one wave; a column used in the other wave is disabled (waves must be disjoint).
function wavePicker(waveIdx) {
  const L = SPEC.longitudinal;
  const mine = new Set(L.waves[waveIdx]);
  const other = new Set(L.waves[1 - waveIdx]);
  const box = el('div', { class: 'chips mt-2' });
  for (const v of SPEC.data.varNames) {
    const disabled = other.has(v);
    const on = mine.has(v);
    box.append(el('button', {
      type: 'button', class: 'chip chip-sm mono', disabled, 'aria-pressed': on ? 'true' : 'false',
      onclick: disabled ? undefined : () => {
        const next = new Set(mine); if (on) next.delete(v); else next.add(v);
        setWaveItems(SPEC, waveIdx, SPEC.data.varNames.filter((x) => next.has(x)));
        refresh();
      },
    }, v));
  }
  return box;
}

// Switch invariance mode, keeping groups/longitudinal mutually exclusive and seeding sensible defaults.
function setInvMode(mode) {
  if (mode === 'time') {
    SPEC.groups.enabled = false;
    SPEC.longitudinal.enabled = true;
    const L = SPEC.longitudinal;
    if (!L.waves[0]?.length) L.waves[0] = SPEC.items.slice();
    if (!L.waves[1]?.length) {
      const used = new Set(L.waves[0]);
      L.waves[1] = SPEC.data.varNames.filter((v) => !used.has(v)).slice(0, L.waves[0].length);
    }
    setWaveItems(SPEC, 0, L.waves[0]); // bind the Λ grid / factors to the Time-1 indicators
    if (!L.invariance.sequence?.length) L.invariance.sequence = INV_SEQUENCE.slice();
  } else {
    SPEC.longitudinal.enabled = false;
    SPEC.groups.enabled = true;
    const avail = SPEC.data.varNames.filter((v) => !SPEC.items.includes(v));
    if (!SPEC.groups.variable && avail.length) pickGroupVar(avail[0]);
  }
}
function pickGroupVar(v) {
  SPEC.groups.variable = v;
  const vals = distinctValues(SPEC.data, v);
  SPEC.groups.codes = vals.length ? vals.map((x) => ({ code: String(x.value), label: `group${x.value}` })) : [{ code: '1', label: 'group1' }, { code: '2', label: 'group2' }];
  if (!SPEC.groups.invariance.sequence?.length) SPEC.groups.invariance.sequence = INV_SEQUENCE.slice();
}
function toggleStep(seqHolder, step, on) {
  let seq = seqHolder.sequence.filter((s) => s !== step);
  if (on) { seq.push(step); seq = INV_SEQUENCE.filter((s) => seq.includes(s)); }
  seqHolder.sequence = seq;
}

function syncSegmented(id, current) {
  const box = $('#' + id); if (!box) return;
  $$('button', box).forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === current ? 'true' : 'false'));
}

function renderGrid() {
  const host = $('#mb-grid'); if (!host) return;
  const ids = factorIds(SPEC);
  const isTarget = SPEC.rotation.type === 'TARGET';
  const hint = $('#mb-grid-hint');
  if (hint) hint.textContent = isTarget ? 'click: main ↔ ~0' : 'click: set primary loading';
  host.innerHTML = '';
  const grid = el('div', { class: 'lam-grid', style: { gridTemplateColumns: `auto repeat(${ids.length}, 54px)` } });
  grid.append(el('div'));
  for (const f of SPEC.factors) grid.append(el('div', { class: 'lam-fh' }, f.label));
  for (const it of SPEC.items) {
    grid.append(el('div', { class: 'lam-it' }, it));
    for (const fid of ids) {
      const main = !!SPEC.target[it]?.[fid];
      const cell = el('button', {
        type: 'button',
        class: 'lam-cell' + (main ? '' : (isTarget ? '' : ' cross')),
        'aria-pressed': main ? 'true' : 'false',
        'aria-label': `${it} on ${fid}: ${main ? 'main' : (isTarget ? 'fixed to 0' : 'free cross-loading')}`,
        onclick: () => { toggleTarget(SPEC, it, fid); refresh(); },
      }, el('span', { class: 'dot' }));
      grid.append(cell);
    }
  }
  host.append(grid);
}

function renderValidation() {
  const host = $('#mb-validation'); if (!host) return;
  const { errors, warnings } = validateSpec(SPEC);
  host.innerHTML = '';
  for (const e of errors) host.append(callout('err', e));
  for (const w of warnings) host.append(callout('warn', w));
  const models = requestedModels(SPEC);
  const info = errors.length ? errors[0] : warnings.length ? warnings[0]
    : `${SPEC.items.length} items · ${SPEC.factors.length} ${SPEC.factors.length === 1 ? 'factor' : 'factors'} · ${models.length} ${models.length === 1 ? 'model' : 'models'} to generate`;
  const tone = errors.length ? 'err' : warnings.length ? 'warn' : 'ok';
  if (barHost) barHost.replaceChildren(stepBar({
    back: { label: 'Back', onclick: () => onBack() },
    info, tone,
    next: { label: 'Generate syntax', onclick: () => onChange({ continue: true }), disabled: errors.length > 0, id: 'mb-continue' },
  }));
}

function updatePreview() {
  const models = requestedModels(SPEC);
  if (!models.length) { activeKey = null; if (sheet.isOpen()) sheet.close(); onChange({ preview: null }); return; }
  if (!activeKey || !models.find((m) => m.key === activeKey)) activeKey = models[0].key;
  sheet.update();
  onChange({ preview: activeKey });
}

// The live syntax preview opens on the Mplus sheet; one tab per requested model.
function openPreview() {
  const models = requestedModels(SPEC);
  if (!models.length) { toast('Switch on at least one model type to preview its syntax', 'err'); return; }
  sheet.open({
    title: 'syntax preview',
    files: () => requestedModels(SPEC).map((m) => ({ key: m.key, name: m.file, label: m.label, text: buildInp(SPEC, m.key), kind: 'inp' })),
    active: activeKey,
    onSelect: (k) => { activeKey = k; onChange({ preview: k }); },
    tools: (f) => [btn('Copy', { size: 'btn-sm', icon: 'copy', onclick: async () => { await navigator.clipboard.writeText(buildInp(SPEC, f.key)); toast('Syntax copied', 'ok'); } })],
  });
}
