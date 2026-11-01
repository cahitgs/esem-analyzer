// syntax-generator.js — build Mplus .inp text from a ModelSpec. Pure (no DOM).
// Templates verified against the user's ESEM example library:
//   ESEM-Geomin:  ROTATION=GEOMIN(OBLIQUE[, .5]);  MODEL: F1-Fk BY <items> (*1);
//   ESEM-Target:  ROTATION=TARGET(OBLIQUE);         MODEL: Fj BY <items, cross~0> (*1);
//   CFA:          (no ROTATION)                      MODEL: Fj BY <its main items>;
// Mplus truncates input lines > 90 chars, so token lists are wrapped < 88.

import { factorIds, mainItemsForFactor, waveCounterpart, DEFAULT_OUTPUT_LINE, thresholdCounts, thresholdReferents, groupLabels } from './state.js';

const WRAP = 86;

/** Join words into a `;`-terminated statement, wrapping long lines with a 2-space continuation.
 *  A trailing parenthesized token — an ESEM set flag "(*1)"/"(*t1 1)" or an equality label —
 *  must NEVER start a continuation line by itself: Mplus silently ignores a flag/label that
 *  does not share a physical line with at least one variable (verified in Mplus 8.3 — the
 *  metric step then fits the configural model with no warning). When the flag would wrap
 *  alone, the last variable is moved down with it. */
function stmt(words) {
  const out = [];
  let cur = '';
  for (const w of words) {
    const piece = cur ? cur + ' ' + w : w;
    if (piece.length > WRAP && cur) { out.push(cur); cur = '  ' + w; }
    else cur = piece;
  }
  out.push(cur + ';');
  // keep a trailing "(...)" token attached to at least one preceding word
  const last = out[out.length - 1];
  if (out.length > 1 && /^\s*\([^()]*\);$/.test(last)) {
    const prev = out[out.length - 2].trimEnd();
    const cut = prev.lastIndexOf(' ');
    const keep = prev.slice(0, cut).trimEnd();
    const moved = '  ' + prev.slice(cut + 1) + ' ' + last.trim();
    out.splice(out.length - 2, 2, ...(keep ? [keep, moved] : [moved]));
  }
  return out.join('\n');
}

/** Wrap a list of already-terminated mini-statements (e.g. "F1*;") to ≤ WRAP chars per line.
 *  Identical to a plain "; "-join for a handful of factors; only wraps when there are many. */
function wrapList(parts) {
  const out = [];
  let cur = '';
  for (const p of parts) { const piece = cur ? cur + ' ' + p : p; if (piece.length > WRAP && cur) { out.push(cur); cur = p; } else cur = piece; }
  if (cur) out.push(cur);
  return out.join('\n');
}

/** Emit equality-labelled intercept/uniqueness statements split into ONE-LINE chunks.
 *  Mplus associates a trailing "(labels)" only with the LAST physical line of a wrapped statement,
 *  so `[M1 … M24] (i1-i24)` spanning two lines silently labels just M24 ("more labels than
 *  parameters") and leaves M1–M23 unconstrained → the invariance model is mis-identified. Keeping
 *  each labelled statement on a single line (chunked) fixes this for any number of items.
 *  bracket=true → "[a b] (p1-p2);" (intercepts); false → "a b (p1-p2);" (residual variances). */
function chunkLabeled(items, prefix, bracket) {
  const open = bracket ? '[' : '', close = bracket ? ']' : '';
  const make = (i, end) => `${open}${items.slice(i, end + 1).join(' ')}${close} (${prefix}${i + 1}${end > i ? `-${prefix}${end + 1}` : ''});`;
  const lines = [];
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j + 1 < items.length && make(i, j + 1).length <= WRAP) j++;
    lines.push(make(i, j));
    i = j + 1;
  }
  return lines.join('\n');
}

function fmtEpsilon(e) {
  if (e == null) return '';
  let s = String(e);
  if (Math.abs(e) < 1) s = s.replace(/^(-?)0\./, '$1.');
  return ', ' + s;
}

function rotationLine(spec) {
  const kind = spec.rotation.oblique ? 'OBLIQUE' : 'ORTHOGONAL';
  if (spec.rotation.type === 'TARGET') return `ROTATION=TARGET(${kind});`;
  return `ROTATION=GEOMIN(${kind}${fmtEpsilon(spec.rotation.epsilon)});`;
}

function headerBlocks(spec, { rotation, rotationOverride, iterations, useVars, parameterization, difftestIn, grouping = false } = {}) {
  // Point at the Mplus-ready .dat (space-delimited, no header) the app exports — the original
  // upload may be a semicolon CSV or carry a header, which Mplus cannot read directly.
  const file = spec.data.mplusFile || spec.data.fileName || 'data.dat';
  const lines = [];
  lines.push('DATA:');
  // Mplus truncates lines > 90 chars; keep a long path on its own line.
  const fileLine = `FILE = "${file}";`;
  lines.push(fileLine.length > WRAP ? `FILE =\n"${file}";` : fileLine);
  lines.push('VARIABLE:');
  lines.push(stmt(['NAMES ARE', ...spec.data.varNames]));
  const used = useVars || spec.items;
  lines.push(stmt(['USEVARIABLES ARE', ...used])); // longitudinal passes both waves' items
  // CATEGORICAL may only list variables that are on USEVARIABLES — Mplus rejects extras.
  const catUsed = (spec.data.categorical || []).filter((v) => used.includes(v));
  if (catUsed.length) lines.push(catUsed.length === used.length ? 'CATEGORICAL ARE ALL;' : stmt(['CATEGORICAL ARE', ...catUsed]));
  if (spec.data.missingCode != null && spec.data.missingCode !== '') lines.push(`MISSING ARE ALL (${spec.data.missingCode});`);
  // Only the multi-group invariance builders ask for a GROUPING line: the measurement models (CFA, ESEM,
  // bifactor) are estimated on the total sample even when grouping is on, and the longitudinal models are
  // single-group by construction.
  if (grouping && spec.groups?.enabled && spec.groups.variable) {
    const gl = groupLabels(spec);
    const codes = spec.groups.codes.map((c) => `${c.code} = ${gl.get(String(c.code))}`).join(' ');
    lines.push(`GROUPING IS ${spec.groups.variable} (${codes});`);
  }
  // DEFINE: merged response categories (a category empty in one group or at one wave collapsed into its
  // neighbour) — only for columns this model uses; DEFINE sits between VARIABLE and ANALYSIS
  const defs = [];
  for (const v of used) { const m = spec.recode?.[v]; if (m) for (const [from, to] of Object.entries(m)) defs.push(`IF (${v} EQ ${from}) THEN ${v} = ${to};`); }
  if (defs.length) lines.push('DEFINE:', ...defs);
  lines.push('ANALYSIS:');
  lines.push(`ESTIMATOR IS ${spec.estimator};`);
  if (parameterization) lines.push(`PARAMETERIZATION = ${parameterization};`);
  if (rotationOverride) lines.push(rotationOverride);
  else if (rotation) lines.push(rotationLine(spec));
  if (iterations) lines.push(`ITERATIONS = ${iterations};`);
  if (difftestIn) lines.push(`DIFFTEST = ${difftestIn};`);
  // Loosened criterion (Morin's T32 remedy) — deliberately emitted for EVERY model, the
  // inv:/linv: sequences included: that is exactly where Morin used it.
  if (spec.aids?.convergence) {
    lines.push(`CONVERGENCE = ${fmtConvergence(spec.aids.convergenceValue)};`);
    // Morin's note under that remedy: with missing data the unrestricted H1 model needs matching relief —
    // H1ITERATIONS equal to ITERATIONS (when one is set) and H1CONVERGENCE equal to CONVERGENCE. Only the
    // ML-family estimators fit an H1 model this way, so WLSMV & co. never get these lines.
    const hasMissing = spec.data.missingCode != null && spec.data.missingCode !== '';
    if (hasMissing && /^ML/i.test(spec.estimator || '')) {
      if (iterations) lines.push(`H1ITERATIONS = ${iterations};`);
      lines.push(`H1CONVERGENCE = ${fmtConvergence(spec.aids.convergenceValue)};`);
    }
  }
  return lines;
}

function fmtConvergence(v) {
  const n = Number.isFinite(v) && v > 0 ? v : 0.005;
  let s = String(n);
  if (Math.abs(n) < 1) s = s.replace(/^(-?)0\./, '$1.'); // Mplus convention: ".005"
  return s;
}

// Heywood-case remedy (Morin, Hoyle ch. 27 footnote 5): label each selected item's residual
// variance in MODEL ("X2 (res1);") and force it positive via MODEL CONSTRAINT ("res1 > 0;").
// Exact pattern verified in real Mplus 8.3 (test/fixtures/besem_target_data1.out). Single-group
// measurement builders ONLY: in multi-group models a MODEL label equates the parameter across
// groups, and the strict steps already carry u#/i# equality labels — a second label on the same
// residual would collide — so buildInvariance/buildLongInvariance* never emit these.
function residualAidLines(spec) {
  const sel = new Set(spec.aids?.positiveResiduals || []);
  // Categorical outcomes are excluded: under the default DELTA parameterization their residual
  // variance is not a free parameter, and Mplus rejects the label ("Variances for categorical
  // outcomes can only be specified using PARAMETERIZATION=THETA").
  const cat = new Set(spec.data?.categorical || []);
  const items = spec.items.filter((it) => sel.has(it) && !cat.has(it));
  return {
    labels: items.map((it, i) => `${it} (res${i + 1});`),
    constraint: items.length ? ['MODEL CONSTRAINT:', ...items.map((_, i) => `res${i + 1} > 0;`)] : [],
  };
}

function outputBlock(spec, { svalues = false } = {}) {
  // One OUTPUT request for every model: Morin's recommended line (DEFAULT_OUTPUT_LINE in state.js),
  // SVALUES included. The `svalues` flag only matters when a user-edited line dropped SVALUES — it is
  // re-inserted for the ESEM-type models, whose SVALUES block feeds ESEM-within-CFA (see js/ewc.js).
  let words = (spec.output?.line || DEFAULT_OUTPUT_LINE).split(/\s+/);
  if (svalues && !words.some((w) => /^SVALUES$/i.test(w))) {
    const insertAt = words.findIndex((w) => /^(MODINDICES|TECH\d|CINTERVAL)$/i.test(w));
    words = insertAt < 0 ? [...words, 'SVALUES'] : [...words.slice(0, insertAt), 'SVALUES', ...words.slice(insertAt)];
  }
  return ['OUTPUT:', stmt(words)];
}

function titleLine(text) { return ['TITLE:', text]; }
/** " [Time 1]" on the single-group measurement models when they are estimated on the Time-1 indicators of a longitudinal design. */
function waveTitleTag(spec) {
  return spec.longitudinal?.enabled && spec.longitudinal.waves?.[0]?.length ? ` [${spec.longitudinal.waveLabels?.[0] || 'Time 1'}]` : '';
}

// Morin's standardized-factor identification: free the first loading (*) and fix the factor
// variance to 1, instead of Mplus's default marker (first loading fixed to 1). This keeps the
// CFA metric consistent with ESEM (where factor variances are fixed to 1).
function cfaByLine(fid, items) {
  return stmt([`${fid} BY`, `${items[0]}*`, ...items.slice(1)]);
}

// ESEM measurement block(s), rotation-aware. Geomin → one range line; Target → one line per
// factor with cross-loadings given the target value 0 via "~0".
function esemByBlocks(spec, tag) {
  const ids = factorIds(spec);
  if (spec.rotation.type === 'TARGET') {
    return spec.factors.map((f) => stmt([`${f.id} BY`, ...spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`)), tag]));
  }
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  return [stmt([`${range} BY`, ...spec.items, tag])];
}

// ---------- CFA ----------
function buildCFA(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const lines = [...titleLine(`CFA - ${spec.factors.length} factors${waveTitleTag(spec)}`), ...headerBlocks(spec, { rotation: false }), 'MODEL:'];
  for (const f of spec.factors) lines.push(cfaByLine(f.id, mainItemsForFactor(spec, f.id)));
  lines.push(`${range}@1;`); // fix factor variances to 1 (first loading freed above)
  const aid = residualAidLines(spec);
  lines.push(...aid.labels, ...aid.constraint);
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- ESEM (Geomin) ----------
function buildESEMGeomin(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const aid = residualAidLines(spec);
  const lines = [
    ...titleLine(`ESEM (Geomin ${spec.rotation.oblique ? 'oblique' : 'orthogonal'}) - ${ids.length} factors${waveTitleTag(spec)}`),
    ...headerBlocks(spec, { rotation: true }), 'MODEL:',
    stmt([`${range} BY`, ...spec.items, '(*1)']),
    ...aid.labels, ...aid.constraint,
    ...outputBlock(spec, { svalues: true }),
  ];
  return lines.join('\n') + '\n';
}

// ---------- ESEM (Target) ----------
function buildESEMTarget(spec) {
  const lines = [
    ...titleLine(`ESEM (Target ${spec.rotation.oblique ? 'oblique' : 'orthogonal'}) - ${spec.factors.length} factors${waveTitleTag(spec)}`),
    ...headerBlocks(spec, { rotation: true }), 'MODEL:',
  ];
  for (const f of spec.factors) {
    const toks = spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`));
    lines.push(stmt([`${f.id} BY`, ...toks, '(*1)']));
  }
  const aid = residualAidLines(spec);
  lines.push(...aid.labels, ...aid.constraint);
  lines.push(...outputBlock(spec, { svalues: true }));
  return lines.join('\n') + '\n';
}

// ---------- Bifactor-CFA (orthogonal general + specific factors) ----------
function orthogonalityLines(ids) {
  const out = [];
  for (let i = 0; i < ids.length - 1; i++) out.push(stmt([`${ids[i]} WITH`, ...ids.slice(i + 1).map((x) => `${x}@0`)]));
  return out;
}
function buildBifactorCfa(spec) {
  const ids = factorIds(spec);
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const lines = [...titleLine(`Bifactor-CFA - ${spec.factors.length} specific factors${waveTitleTag(spec)}`), ...headerBlocks(spec, { rotation: false }), 'MODEL:'];
  lines.push(cfaByLine('G', spec.items));                                  // general factor on all items
  for (const f of spec.factors) lines.push(cfaByLine(f.id, mainItemsForFactor(spec, f.id)));
  lines.push(`G@1;`, `${range}@1;`);                                       // fix all factor variances to 1
  lines.push(...orthogonalityLines(['G', ...ids]));                        // bifactor: all factors orthogonal
  const aid = residualAidLines(spec);
  lines.push(...aid.labels, ...aid.constraint);
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- Bifactor-ESEM ----------
// Geomin → Morin's primary BI-GEOMIN(ORTHOGONAL) rotation (the first factor is auto-estimated
// as the G-factor). Target → orthogonal target rotation with an all-main G block + target S blocks.
function buildBifactorEsem(spec) {
  const ids = factorIds(spec);
  const aid = residualAidLines(spec);
  if (spec.rotation.type === 'TARGET') {
    const lines = [
      ...titleLine(`Bifactor-ESEM (target orthogonal) - ${spec.factors.length} specific factors${waveTitleTag(spec)}`),
      ...headerBlocks(spec, { rotationOverride: 'ROTATION=TARGET(ORTHOGONAL);' }), 'MODEL:',
      stmt(['G BY', ...spec.items, '(*1)']),
    ];
    for (const f of spec.factors) lines.push(stmt([`${f.id} BY`, ...spec.items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`)), '(*1)']));
    lines.push(...aid.labels, ...aid.constraint);
    lines.push(...outputBlock(spec, { svalues: true }));
    return lines.join('\n') + '\n';
  }
  // BI-GEOMIN: list the general factor (G) plus the specific-factor range in one ESEM set.
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  const eps = fmtEpsilon(spec.rotation.epsilon).replace(/^,\s*/, ' ');     // "BI-GEOMIN(ORTHOGONAL .5)"
  const lines = [
    ...titleLine(`Bifactor-ESEM (BI-GEOMIN orthogonal) - ${spec.factors.length} specific factors${waveTitleTag(spec)}`),
    ...headerBlocks(spec, { rotationOverride: `ROTATION=BI-GEOMIN(ORTHOGONAL${eps});` }), 'MODEL:',
    stmt([`G ${range} BY`, ...spec.items, '(*1)']),
    ...aid.labels, ...aid.constraint,
    ...outputBlock(spec, { svalues: true }),
  ];
  return lines.join('\n') + '\n';
}

// ---------- Measurement invariance: steps, labels and the partial-invariance branch ----------
export const INV_SEQUENCE = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
// Morin's names — weak, strong — on the chips, in the titles and in the tables; `thresholds` is the strong step's
// label for the ordinal chains; `tag` is the ASCII word used inside a title's branch tag.
export const INV_META = {
  configural: { label: 'Configural', short: 'configural', tag: 'configural' },
  metric: { label: 'Weak (loadings)', short: 'weak', tag: 'weak' },
  scalar: { label: 'Strong (intercepts)', short: 'strong', tag: 'strong', thresholds: 'Strong (thresholds)' },
  strict: { label: 'Strict (residuals)', short: 'strict', tag: 'strict' },
  varcov: { label: 'Factor var/cov', short: 'variance–covariance', tag: 'var-cov' },
  latentmean: { label: 'Latent means', short: 'latent mean', tag: 'latent means' },
};
export function stepLabel(step, { thresholds = false } = {}) { return (thresholds && INV_META[step].thresholds) || INV_META[step].label; }

// Partial invariance (Byrne et al., 1989; Morin, 2023). When a step goes beyond the fit-change guideline, the
// researcher frees the parameters responsible — the largest modification indices, one at a time — and continues
// the sequence from that partial model, which is compared with the last retained model; a step that has no partial
// form (the rotated loadings, variances, covariances and means of an ESEM set cannot be freed one by one) can be
// skipped, its constraints left out of the later steps, which are then compared with the last retained model
// (Morin's rule for the application). The branch of a chain lives in spec.groups.invariance or
// spec.longitudinal.invariance as
//   partial: { [modelType]: { [step]: [ids] } }     skipped: { [modelType]: [steps] }
// where an id names an item (its intercept, thresholds or residual variance), 'F1:X3' a loading (CFA families),
// 'F1~F2' a factor covariance, 'F2' a factor variance (var–cov step) or a factor mean (latent-means step).
// Branch models carry the variant 'p' (key "inv:scalar@p", file "Inv_3p_scalar.inp", DIFFTEST file
// "Inv_diff_scalarp.dat"); the full chain ignores the branch.
export const PARTIAL_KIND = { metric: 'loadings', scalar: 'intercepts', strict: 'residuals', varcov: 'varcov', latentmean: 'means' };
export const SKIPPABLE_STEPS = ['strict', 'varcov'];
/** What a step may free for a model family: CFA and bifactor-CFA at every step after configural; ESEM and
 *  bifactor-ESEM at the strong and strict steps only (null = no partial form at that step). */
export function partialKind(mt, step) {
  const cfaFamily = mt === 'cfa' || mt === 'bcfa';
  if (step === 'scalar' || step === 'strict') return PARTIAL_KIND[step];
  return cfaFamily && PARTIAL_KIND[step] ? PARTIAL_KIND[step] : null;
}
export const invHolder = (spec, mode) => (mode === 'time' ? spec.longitudinal?.invariance : spec.groups?.invariance);
/** The branch of one chain: { partial: { step: [ids] }, skipped: [steps], active }. */
export function invBranch(spec, mode, mt) {
  const h = invHolder(spec, mode) || {};
  const partial = {};
  for (const [s, ids] of Object.entries(h.partial?.[mt] || {})) if (Array.isArray(ids) && ids.length && partialKind(mt, s)) partial[s] = ids.slice();
  const skipped = (h.skipped?.[mt] || []).filter((s) => SKIPPABLE_STEPS.includes(s));
  return { partial, skipped, active: Object.keys(partial).length > 0 || skipped.length > 0 };
}
const stepIdx = (s) => INV_SEQUENCE.indexOf(s);
/** The first step the branch changes (a partial step, or the step after a skipped one); Infinity without a branch. */
export function branchStart(br) {
  const starts = [...Object.keys(br.partial).map(stepIdx), ...br.skipped.map((s) => stepIdx(s) + 1)];
  return starts.length ? Math.min(...starts) : Infinity;
}
/** The constraints in force at `step` — cumulative by step order whatever the selected sequence — with the branch's
 *  releases and skipped steps applied for variant 'p'. */
function stepPlan(spec, mode, mt, step, variant) {
  const br = variant === 'p' ? invBranch(spec, mode, mt) : { partial: {}, skipped: [] };
  const pos = stepIdx(step);
  const has = (s) => stepIdx(s) <= pos && !br.skipped.includes(s);
  const free = (s) => new Set(stepIdx(s) <= pos ? (br.partial[s] || []) : []);
  return {
    configural: step === 'configural',
    loadings: has('metric'), intercepts: has('scalar'), residuals: has('strict'), varcov: has('varcov'), means: has('latentmean'),
    free: { loadings: free('metric'), intercepts: free('scalar'), residuals: free('strict'), varcov: free('varcov'), means: free('latentmean') },
    partialSteps: INV_SEQUENCE.filter((s) => stepIdx(s) <= pos && br.partial[s]?.length),
    skipped: br.skipped.filter((s) => stepIdx(s) < pos),
    branch: variant === 'p',
  };
}
/** " [partial strong: Z2; without var-cov]" — the TITLE tag the parser reads back (ASCII; counts when long). */
function branchTag(plan, maxLen = 44) {
  if (!plan.branch) return '';
  const names = (s) => [...plan.free[PARTIAL_KIND[s]]].join(', ');
  const parts = [...plan.partialSteps.map((s) => `partial ${INV_META[s].tag}: ${names(s)}`), ...plan.skipped.map((s) => `without ${INV_META[s].tag}`)];
  if (!parts.length) return '';
  let tag = parts.join('; ');
  if (tag.length > maxLen) tag = [...plan.partialSteps.map((s) => `partial ${INV_META[s].tag}: ${plan.free[PARTIAL_KIND[s]].size} freed`), ...plan.skipped.map((s) => `without ${INV_META[s].tag}`)].join('; ');
  return ` [${tag}]`;
}

/** Equality-labelled statements with position-based labels, split into one-line chunks (Mplus ties a trailing
 *  "(labels)" to the last physical line only — see chunkLabeled), the positions in `freeIdx` written as free
 *  parameters between the labelled runs, Morin's partial-invariance form (T11, T34: "[Z1] (i9); [Z2*]; [Z3 Z4]
 *  (i11-i12);"). Without free positions this is chunkLabeled. */
function labeledExcept(items, prefix, bracket, freeIdx = new Set()) {
  const open = bracket ? '[' : '', close = bracket ? ']' : '';
  const make = (i, end) => `${open}${items.slice(i, end + 1).join(' ')}${close} (${prefix}${i + 1}${end > i ? `-${prefix}${end + 1}` : ''});`;
  const lines = [];
  let i = 0;
  while (i < items.length) {
    if (freeIdx.has(i)) { lines.push(bracket ? `[${items[i]}*];` : `${items[i]};`); i++; continue; }
    let j = i;
    while (j + 1 < items.length && !freeIdx.has(j + 1) && make(i, j + 1).length <= WRAP) j++;
    lines.push(make(i, j));
    i = j + 1;
  }
  return lines.join('\n');
}
const positionsOf = (items, ids) => new Set([...ids].map((id) => items.indexOf(id)).filter((i) => i >= 0));

function diffTestName(step, prefix = 'Inv', suffix = '') { return `${prefix}_diff_${step}${suffix}.dat`; }
/** DIFFTEST handshake between the ADJACENT selected steps of a WLSMV chain: a model reads the derivatives of the
 *  previous retained step (skipped steps are passed over; a branch model reads the full chain's file until the
 *  branch starts, then the branch's own "…p.dat" files) and saves its own for the next one. */
function diffTestLinks(spec, mode, mt, step, variant, seq, prefix) {
  const none = { difftestIn: null, difftestOut: null };
  if (!/MV$/i.test(spec.estimator || '')) return none;
  const br = variant === 'p' ? invBranch(spec, mode, mt) : { partial: {}, skipped: [] };
  const start = variant === 'p' ? branchStart(br) : Infinity;
  const pos = seq.indexOf(step);
  if (pos < 0) return none;
  let prev = null, next = null;
  for (let i = pos - 1; i >= 0; i--) if (!br.skipped.includes(seq[i])) { prev = seq[i]; break; }
  for (let i = pos + 1; i < seq.length; i++) if (!br.skipped.includes(seq[i])) { next = seq[i]; break; }
  const suffix = (s) => (variant === 'p' && stepIdx(s) >= start ? 'p' : '');
  return { difftestIn: prev ? diffTestName(prev, prefix, suffix(prev)) : null, difftestOut: next ? diffTestName(step, prefix, suffix(step)) : null };
}

// ---------- Multi-group measurement invariance (CFA, ESEM, bifactor-CFA, bifactor-ESEM) ----------
// Measurement invariance following Morin (2023): explicit per-group sections, the measurement block in the
// user's rotation (ESEM: the user's rotation; bifactor-ESEM: one orthogonal-target set with a G factor on every
// item plus per-factor target blocks; CFA families: one BY line per factor with the first loading freed and the
// factor variances fixed to 1, the bifactor-CFA factors orthogonal), factor variances fixed to 1 (freed in the
// non-reference groups from weak onward), factor means fixed to 0 (freed from strong onward, refixed for the
// latent-mean test), and alphanumeric equality labels (i# intercepts, u# uniquenesses, cov# covariances).
// Loadings are invariant by default from weak onward (BY omitted in the group sections). The bifactor-ESEM
// chain was cross-validated against De Beer & Morin's (B)ESEM generator (statstools.app/b_esem): identical
// npar/df/χ² at every step on real Mplus runs; its var–cov step must refix the non-reference group's variances
// AND equate ALL factor covariances (G pairs included) — Mplus rejects a variances-only refix for an EFA set.
// Bifactor-CFA has no factor covariances, so its var–cov step equates the variances only. Each chain has its own
// file prefix and DIFFTEST files, so four chains can share one folder.
const MG_CHAIN = {
  esem: { prefix: 'inv', filePrefix: 'Inv', name: 'ESEM', title: (cat) => (cat ? 'MG invariance (categorical)' : 'MG invariance'), header: { rotation: true, iterations: 10000 } },
  besem: { prefix: 'binv', filePrefix: 'BifactorInv', name: 'Bifactor-ESEM', title: () => 'MG invariance (bifactor-ESEM)', header: { rotationOverride: 'ROTATION=TARGET(ORTHOGONAL);', iterations: 100000 } },
  cfa: { prefix: 'cinv', filePrefix: 'CfaInv', name: 'CFA', title: () => 'MG invariance (CFA)', header: { rotation: false } },
  bcfa: { prefix: 'bcinv', filePrefix: 'BifactorCfaInv', name: 'Bifactor-CFA', title: () => 'MG invariance (bifactor-CFA)', header: { rotation: false, iterations: 10000 } },
};
const MG_BY_KEY = { inv: 'esem', binv: 'besem', cinv: 'cfa', bcinv: 'bcfa' };

function isCategoricalInvariance(spec) {
  const cat = spec.data?.categorical || [];
  return spec.items.length > 0 && spec.items.every((it) => cat.includes(it));
}

/** The measurement block and the factor-level statements of one multi-group family. */
function mgPieces(spec, mt) {
  const ids = factorIds(spec), items = spec.items;
  const bifactor = mt === 'besem' || mt === 'bcfa';
  const all = bifactor ? ['G', ...ids] : ids;
  const range = ids.length > 1 ? `${ids[0]}-${ids[ids.length - 1]}` : ids[0];
  let by;
  if (mt === 'esem') by = esemByBlocks(spec, '(*1)');
  else if (mt === 'besem') by = [stmt(['G BY', ...items, '(*1)']), ...spec.factors.map((f) => stmt([`${f.id} BY`, ...items.map((it) => (spec.target[it]?.[f.id] ? it : `${it}~0`)), '(*1)']))];
  else {
    by = [];
    if (bifactor) by.push(cfaByLine('G', items));
    for (const f of spec.factors) by.push(cfaByLine(f.id, mainItemsForFactor(spec, f.id)));
    if (bifactor) by.push(...orthogonalityLines(all));
  }
  const covPairs = [];
  if (mt !== 'bcfa') for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) covPairs.push([all[i], all[j]]);
  const varFix = bifactor ? `G@1; ${range}@1;` : `${range}@1;`;
  const meanFix = bifactor ? `[G@0]; [${range}@0];` : `[${range}@0];`;
  return {
    items, bifactor, by, varFix, meanFix,
    varFree: wrapList(all.map((id) => `${id}*;`)),
    meanFree: wrapList(all.map((id) => `[${id}*];`)),
    // var–cov step: every covariance equated by label; a freed pair (partial var–cov, CFA) stays unlabelled
    covLabels: (free) => covPairs.map(([a, b], i) => (free.has(`${a}~${b}`) ? `${a} WITH ${b};` : `${a} WITH ${b} (cov${i + 1});`)),
    // group-section variances / means with some factors freed (partial var–cov / latent means, CFA families)
    varFixExcept: (free) => (free.size ? wrapList(all.map((id) => (free.has(id) ? `${id}*;` : `${id}@1;`))) : varFix),
    meanFixExcept: (free) => (free.size ? wrapList(all.map((id) => (free.has(id) ? `[${id}*];` : `[${id}@0];`))) : meanFix),
    // CFA families: a loading freed in the non-reference groups ("F1 BY X3*;" in their sections; "*" so that a
    // first indicator is not refixed to 1 by Mplus's BY default)
    freeLoadingLines: (free) => [...free].map((id) => { const [f, it] = id.split(':'); return `${f} BY ${it}*;`; }),
  };
}

function buildMgContinuous(spec, mt, step, variant) {
  const P = mgPieces(spec, mt), plan = stepPlan(spec, 'groups', mt, step, variant);
  const { items } = P;
  const intFree = stmt([`[${items[0]}`, ...items.slice(1, -1), `${items[items.length - 1]}]`]);
  const intInv = labeledExcept(items, 'i', true, positionsOf(items, plan.free.intercepts));
  const uniqFree = stmt(items);
  const uniqInv = labeledExcept(items, 'u', false, positionsOf(items, plan.free.residuals));
  const cov = plan.varcov ? P.covLabels(plan.free.varcov) : [];
  const main = [...P.by, P.varFix, ...cov, P.meanFix, plan.intercepts ? intInv : intFree, plan.residuals ? uniqInv : uniqFree];
  const grp = [
    ...(plan.configural ? P.by : P.freeLoadingLines(plan.free.loadings)),
    plan.configural || plan.varcov ? P.varFixExcept(plan.free.varcov) : P.varFree,
    ...cov,
    plan.intercepts && !plan.means ? P.meanFree : P.meanFixExcept(plan.means ? plan.free.means : new Set()),
    plan.intercepts ? intInv : intFree,
    plan.residuals ? uniqInv : uniqFree,
  ];
  const C = MG_CHAIN[mt];
  const lines = [...titleLine(`${C.title(false)} - ${stepLabel(step)}${branchTag(plan)}`), ...headerBlocks(spec, { ...C.header, grouping: true }), 'MODEL:', ...main];
  for (const code of spec.groups.codes.slice(1)) lines.push(`MODEL ${groupLabels(spec).get(String(code.code))}:`, ...grp);
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- Multi-group measurement invariance with ordinal items (WLSMV / THETA / DIFFTEST) ----------
// The chains constrain THRESHOLDS, not intercepts, and follow Millsap & Yun-Tein's identification as Morin
// (Hoyle ch. 27 supplement, T15–T27 and T42–T59) and De Beer & Morin's generator implement it:
//  - configural already equates the FIRST threshold of every item plus the SECOND threshold of one referent
//    item per factor (and one more for the G factor of the bifactor chains) across groups; the remaining
//    thresholds are freed by listing them (unlabelled) in the group-specific sections — in Mplus MG models
//    thresholds are equal across groups BY DEFAULT, so those mentions are what makes the model configural;
//  - latent means are therefore identified (and freed) in the non-reference groups from configural on;
//  - THETA parameterization: uniquenesses fixed to 1 in group 1, free in the others until the strict step
//    refixes them to 1 everywhere;
//  - a partial strong model keeps the configural (first-threshold) treatment for the freed items;
//  - WLSMV χ² values cannot be differenced directly — each step saves derivatives via SAVEDATA: DIFFTEST=…
//    and the next selected step reads them via ANALYSIS: DIFFTEST=…, which makes Mplus print the
//    "Chi-Square Test for Difference Testing" block in its .out.
/** Threshold statements with GLOBAL running labels (item k's j-th threshold → t<cumulative#>), packed several
 *  per line. mode 'partial' labels only $1 of every item + $2 of the referent items (`refs` from
 *  thresholdReferents in state.js) — the configural/weak identification; 'all' labels every threshold, except
 *  those of the items in `free` (partial strong invariance), which keep the configural treatment. */
function thresholdLines(spec, mode, counts, refs, items = spec.items, free = new Set()) {
  const parts = [];
  let t = 1;
  for (const it of items) {
    const allHere = mode === 'all' && !free.has(it);
    for (let j = 1; j <= counts[it]; j++) {
      const labelled = allHere || j === 1 || (j === 2 && refs.has(it));
      parts.push(labelled ? `[${it}$${j}] (t${t});` : `[${it}$${j}];`);
      t++;
    }
  }
  return wrapList(parts);
}

function buildMgCategorical(spec, mt, step, variant) {
  const P = mgPieces(spec, mt), plan = stepPlan(spec, 'groups', mt, step, variant);
  const { items, bifactor } = P;
  const counts = thresholdCounts(spec);
  const { refs } = thresholdReferents(spec, counts, { general: bifactor }); // one referent per factor (+ one for G), ≥ 3 categories each
  const thr = plan.intercepts ? thresholdLines(spec, 'all', counts, refs, items, plan.free.intercepts) : thresholdLines(spec, 'partial', counts, refs);
  const uniqFix = wrapList(items.map((it) => `${it}@1;`));
  const uniqFree = wrapList(items.map((it) => `${it}*;`));
  const uniqGrp = !plan.residuals ? uniqFree : plan.free.residuals.size ? wrapList(items.map((it) => (plan.free.residuals.has(it) ? `${it}*;` : `${it}@1;`))) : uniqFix;
  const cov = plan.varcov ? P.covLabels(plan.free.varcov) : [];
  const main = [...P.by, P.varFix, ...cov, P.meanFix, thr, uniqFix];
  const grp = [
    ...(plan.configural ? P.by : P.freeLoadingLines(plan.free.loadings)),
    plan.configural || plan.varcov ? P.varFixExcept(plan.free.varcov) : P.varFree,
    ...cov,
    plan.means ? P.meanFixExcept(plan.free.means) : P.meanFree,
    thr, uniqGrp,
  ];
  const C = MG_CHAIN[mt];
  const header = { ...C.header, parameterization: 'THETA', grouping: true };
  if (mt === 'esem') delete header.iterations;
  const seq = spec.groups.invariance?.sequence || INV_SEQUENCE;
  const { difftestIn, difftestOut } = diffTestLinks(spec, 'groups', mt, step, variant, seq, C.filePrefix);
  const lines = [...titleLine(`${C.title(true)} - ${stepLabel(step, { thresholds: true })}${branchTag(plan)}`), ...headerBlocks(spec, { ...header, difftestIn }), 'MODEL:', ...main];
  for (const code of spec.groups.codes.slice(1)) lines.push(`MODEL ${groupLabels(spec).get(String(code.code))}:`, ...grp);
  lines.push(...outputBlock(spec));
  if (difftestOut) lines.push('SAVEDATA:', `DIFFTEST = ${difftestOut};`);
  return lines.join('\n') + '\n';
}

function buildMgInvariance(spec, mt, step, variant = '') {
  return isCategoricalInvariance(spec) ? buildMgCategorical(spec, mt, step, variant) : buildMgContinuous(spec, mt, step, variant);
}

// ---------- Longitudinal (2-wave, within-person) measurement invariance ----------
// Single group, two measurement blocks (one per wave) sharing ONE factor pattern. Loadings are equated across
// waves via the ESEM block flag "(*tN 1)" (Morin et al.) or, for the CFA families, via shared BY labels.
// Residual & intercept invariance reuse the position-based labels (i1-i6 / u1-u6), identical for both waves →
// cross-wave equality for free; a partial model writes the freed pair as "[z2_t1*]; … [z2_t2*];" (Morin's T34).
// Each indicator's residual is correlated across the two waves with PWITH-equivalent WITH statements. The
// app's CUMULATIVE step order (configural→weak→strong→strict→varcov→latent means) reproduces Morin's
// per-block syntax but bundles it so df increases monotonically for the comparison table.
function longRanges(k) {
  return { t1: k > 1 ? `F1-F${k}` : 'F1', t2: k > 1 ? `F${k + 1}-F${2 * k}` : `F${k + 1}` };
}
// Correlated uniquenesses across waves: one "WITH" per matching indicator. Equivalent to Mplus PWITH, but PWITH
// requires its two lists to stay on a single line — they break ("mismatched variables for PWITH") once wrapped
// for many indicators — so we emit explicit pairwise statements, robust for any indicator count.
function pwithLines(a, b) { return a.map((it, i) => `${it} WITH ${b[i]};`); }
// Cross-sectional factor covariance equality: each matching within-wave pair shares one label; a freed pair
// (partial var–cov, CFA) is written unlabelled at both waves.
function longCovLabels(k, free = new Set()) {
  const out = [];
  let c = 1;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const lab = free.has(`F${i + 1}~F${j + 1}`) ? '' : ` (lcov${c})`;
    out.push(`F${i + 1} WITH F${j + 1}${lab};`, `F${k + i + 1} WITH F${k + j + 1}${lab};`);
    c++;
  }
  return out;
}
// Which cumulative constraints a step adds (shared by the ESEM, CFA and categorical builders), with the branch.
function longPlan(spec, mt, step, variant) {
  const p = stepPlan(spec, 'time', mt, step, variant);
  return { ...p, equate: p.loadings, meanFix: p.means };
}
// Time-2 factor variances refixed @1 (freed ones stay *) and Time-2 means refixed @0 (freed ones stay free).
function t2VarLines(k, free, gid = null, gFirst = false) {
  const t2r = longRanges(k).t2;
  if (!free.size) return gid ? (gFirst ? ['G2@1;', `${t2r}@1;`] : [`${t2r}@1;`, 'G2@1;']) : [`${t2r}@1;`];
  const fs = Array.from({ length: k }, (_, i) => `F${i + 1}`);                  // the Time-1 names the ids use
  const ids = gid ? (gFirst ? [gid, ...fs] : [...fs, gid]) : fs;
  const t2 = (id) => (id === gid ? 'G2' : `F${k + Number(id.slice(1))}`);
  return ids.map((id) => `${t2(id)}${free.has(id) ? '*' : '@1'};`);
}
function t2MeanLines(k, free, gid = null) {
  const ids = [...Array.from({ length: k }, (_, i) => `F${i + 1}`), ...(gid ? [gid] : [])];
  const t2 = (id) => (id === gid ? 'G2' : `F${k + Number(id.slice(1))}`);
  if (!free.size) return [`[${longRanges(k).t2}@0];`, ...(gid ? ['[G2@0];'] : [])];
  return ids.map((id) => `[${t2(id)}${free.has(id) ? '' : '@0'}];`);
}
// Intercept / mean lines common to the builders (only when intercepts are equated): labelled pairs, the freed
// pairs written "[item*]" at both waves; Time-1 latent means fixed, Time-2 means free (refixed for the mean test).
function longInterceptMeanLines(t1, t2, k, f, freeIdx, gid = null) {
  const out = [labeledExcept(t1, 'i', true, freeIdx), labeledExcept(t2, 'i', true, freeIdx), `[${longRanges(k).t1}@0];`];
  if (gid) out.push('[G1@0];');
  out.push(...(f.meanFix ? t2MeanLines(k, f.free.means, gid) : [`[${longRanges(k).t2}];`, ...(gid ? ['[G2];'] : [])]));
  return out;
}

// One wave's ESEM target blocks — F<fBase+j> BY <main items> <other items>~0 (*t<w>); the Time-2 main items are the
// wave counterparts of the Time-1 pattern. Under Geomin the wave is one "F1-Fk BY items" line instead; writing the
// Geomin shorthand under ROTATION = TARGET leaves the rotation unidentified ("Fewer than 6 loadings have been given
// target values in EFA set", no standard errors), so the two rotations must write different blocks.
function waveTargetBlocks(spec, items, fBase, tag) {
  const [t1] = spec.longitudinal.waves;
  return spec.factors.map((fac, fi) => {
    const mains = new Set(mainItemsForFactor(spec, fac.id).map((it) => (items === t1 ? it : waveCounterpart(spec, it))));
    return stmt([`F${fBase + fi} BY`, ...items.map((it) => (mains.has(it) ? it : `${it}~0`)), tag]);
  });
}
// One wave's bifactor-ESEM set: G on all items, then each specific factor's target block.
function waveBifactorBlocks(spec, items, gid, fBase, tag) {
  const [t1] = spec.longitudinal.waves;
  const out = [stmt([`${gid} BY`, ...items, tag])];
  spec.factors.forEach((fac, fi) => {
    const mains = new Set(mainItemsForFactor(spec, fac.id).map((it) => (items === t1 ? it : waveCounterpart(spec, it))));
    out.push(stmt([`F${fBase + fi} BY`, ...items.map((it) => (mains.has(it) ? it : `${it}~0`)), tag]));
  });
  return out;
}
// CFA-family BY lines across waves, standardized-factor identification (first loading free *). Loadings are
// equated across waves via shared labels (L<f>_<p> / LG_<p>). Mplus rejects inline per-item labels on one BY
// line ("F1 BY X1* (L1_1) X2 …"), so when labelling we emit ONE BY statement per loading; a freed loading
// (partial weak invariance) is the unlabelled statement at both waves.
function cfaWaveByLines(fid, items, tag, equate, freePos = new Set()) {
  if (!equate) return [stmt([`${fid} BY`, ...items.map((it, p) => (p === 0 ? `${it}*` : it))])];
  return items.map((it, p) => stmt([`${fid} BY`, p === 0 ? `${it}*` : it, ...(freePos.has(p) ? [] : [`(${tag}_${p + 1})`])]));
}
/** Freed loading ids 'F1:X3' / 'G:X3' → the positions to leave unlabelled within each factor's BY statements. */
function freeLoadingPositions(spec, free, fid, items) {
  return new Set([...free].filter((id) => id.startsWith(`${fid}:`)).map((id) => items.indexOf(id.slice(fid.length + 1))).filter((p) => p >= 0));
}
/** Time-2 residual lines of the CFA-family and ESEM builders when uniquenesses are equated. */
function longResidualLines(t1, t2, freeIdx) { return [labeledExcept(t1, 'u', false, freeIdx), labeledExcept(t2, 'u', false, freeIdx)]; }

const LONG_TITLE = { esem: 'Longitudinal invariance', cfa: 'Longitudinal invariance (CFA)', besem: 'Longitudinal invariance (bifactor-ESEM)', bcfa: 'Longitudinal invariance (bifactor-CFA)' };
const LONG_HEADER = {
  esem: { rotation: true, iterations: 10000 },
  cfa: { rotation: false },
  // bifactor-ESEM across waves (Morin, T28–T41): 100000 iterations, the most iteration-hungry family
  besem: { rotationOverride: 'ROTATION=TARGET(ORTHOGONAL);', iterations: 100000 },
  bcfa: { rotation: false, iterations: 10000 },
};

function buildLongContinuous(spec, mt, step, variant) {
  const [t1, t2] = spec.longitudinal.waves;
  const k = spec.factors.length;
  const { t1: t1r, t2: t2r } = longRanges(k);
  const f = longPlan(spec, mt, step, variant);
  const bifactor = mt === 'besem' || mt === 'bcfa';
  const gid = bifactor ? 'G' : null;
  const flag = (w) => `(*${w}${f.equate ? ' 1' : ''})`;
  const lines = [...titleLine(`${LONG_TITLE[mt]} - ${stepLabel(step)}${branchTag(f)}`), ...headerBlocks(spec, { ...LONG_HEADER[mt], useVars: [...t1, ...t2] }), 'MODEL:'];
  // measurement blocks
  if (mt === 'esem') {
    lines.push(...(spec.rotation.type === 'TARGET'
      ? [...waveTargetBlocks(spec, t1, 1, flag('t1')), ...waveTargetBlocks(spec, t2, k + 1, flag('t2'))]
      : [stmt([`${t1r} BY`, ...t1, flag('t1')]), stmt([`${t2r} BY`, ...t2, flag('t2')])]));
  } else if (mt === 'besem') {
    lines.push(...waveBifactorBlocks(spec, t1, 'G1', 1, flag('t1')), ...waveBifactorBlocks(spec, t2, 'G2', k + 1, flag('t2')));
  } else {
    // CFA families: Time-1 factors (F1..Fk) before Time-2 factors (F(k+1)..F2k) so the range syntax stays contiguous
    if (bifactor) lines.push(...cfaWaveByLines('G1', t1, 'LG', f.equate, freeLoadingPositions(spec, f.free.loadings, 'G', t1)));
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${fi + 1}`, mainItemsForFactor(spec, fac.id), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    if (bifactor) lines.push(...cfaWaveByLines('G2', t2, 'LG', f.equate, freeLoadingPositions(spec, f.free.loadings, 'G', t1)));
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${k + fi + 1}`, mainItemsForFactor(spec, fac.id).map((it) => waveCounterpart(spec, it)), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    lines.push(...(bifactor ? ['G1@1;'] : []), `${t1r}@1;`);                 // Time-1 factor variances fix the metric
    if (!f.equate || f.varcov) lines.push(...(f.varcov ? t2VarLines(k, f.free.varcov, gid, true) : [...(bifactor ? ['G2@1;'] : []), `${t2r}@1;`])); // T2 vars: @1 at configural & varcov+, else free
    if (bifactor) {
      const w1 = ['G1', ...Array.from({ length: k }, (_, i) => `F${i + 1}`)];
      const w2 = ['G2', ...Array.from({ length: k }, (_, i) => `F${k + i + 1}`)];
      lines.push(...orthogonalityLines(w1), ...orthogonalityLines(w2));     // bifactor: orthogonal within each wave
    }
  }
  if (f.residuals) lines.push(...longResidualLines(t1, t2, positionsOf(t1, f.free.residuals)));
  if (f.varcov) {
    if (mt === 'esem') lines.push(...t2VarLines(k, f.free.varcov), ...longCovLabels(k, f.free.varcov)); // T1 vars @1 by ESEM default
    else if (mt === 'besem') {
      lines.push(...t2VarLines(k, f.free.varcov, 'G'));
      const fact1 = ['G1', ...Array.from({ length: k }, (_, i) => `F${i + 1}`)];
      const fact2 = ['G2', ...Array.from({ length: k }, (_, i) => `F${k + i + 1}`)];
      let c = 1;
      for (let i = 0; i < fact1.length; i++) for (let j = i + 1; j < fact1.length; j++) { lines.push(`${fact1[i]} WITH ${fact1[j]} (lcov${c});`, `${fact2[i]} WITH ${fact2[j]} (lcov${c});`); c++; }
    } else if (mt === 'cfa') lines.push(...longCovLabels(k, f.free.varcov));
  }
  if (f.intercepts) lines.push(...longInterceptMeanLines(t1, t2, k, f, positionsOf(t1, f.free.intercepts), gid));
  if (spec.longitudinal.correlatedUniqueness) lines.push(...pwithLines(t1, t2));
  lines.push(...outputBlock(spec));
  return lines.join('\n') + '\n';
}

// ---------- Longitudinal invariance with ordinal indicators (WLSMV / THETA / DIFFTEST) ----------
// Morin's thresholds logic (Hoyle ch. 27 supplement T42–T59; the multi-group categorical chain above) laid over
// two waves within one group: thresholds are equated across waves through shared labels th<item#>_<threshold#>
// — the first threshold of every item plus the second threshold of one referent item per factor (and one for G)
// from the configural model on, which identifies the Time-2 latent means from the start; THETA parameterization
// with the Time-1 uniquenesses fixed at 1 and the Time-2 ones free until the strict step refixes them; the weak,
// var–cov and latent-mean steps constrain what the continuous chain constrains; a partial strong model keeps the
// configural treatment for the freed items; DIFFTEST chains the adjacent selected steps with this chain's own
// files (LongInv_<mt>_diff_<step>.dat).
function isCategoricalLongitudinal(spec) {
  const cols = [...(spec.longitudinal?.waves?.[0] || []), ...(spec.longitudinal?.waves?.[1] || [])];
  const cat = spec.data?.categorical || [];
  return cols.length > 0 && cols.every((c) => cat.includes(c));
}
function buildLongCategorical(spec, mt, step, variant) {
  const [t1, t2] = spec.longitudinal.waves;
  const k = spec.factors.length;
  const { t1: t1r, t2: t2r } = longRanges(k);
  const f = longPlan(spec, mt, step, variant);
  const bifactor = mt === 'besem' || mt === 'bcfa';
  const gid = bifactor ? 'G' : null;
  const counts = thresholdCounts(spec);                                  // Time-1 items; Time-2 carries the same categories (validated)
  const { refs } = thresholdReferents(spec, counts, { general: bifactor });
  const freeThr = positionsOf(t1, f.free.intercepts), freeRes = positionsOf(t1, f.free.residuals);
  const thrLines = (items) => {
    const parts = [];
    items.forEach((it, p) => {
      const n = counts[t1[p]] || 1;
      const allHere = f.intercepts && !freeThr.has(p);                   // strong and later: every threshold equated, freed items keep the configural treatment
      for (let j = 1; j <= n; j++) {
        const labelled = allHere || j === 1 || (j === 2 && refs.has(t1[p]));
        parts.push(labelled ? `[${it}$${j}] (th${p + 1}_${j});` : `[${it}$${j}];`);
      }
    });
    return wrapList(parts);
  };
  const flag = (w) => `(*${w}${f.equate ? ' 1' : ''})`;
  const seq = spec.longitudinal.invariance?.sequence || INV_SEQUENCE;
  const { difftestIn, difftestOut } = diffTestLinks(spec, 'time', mt, step, variant, seq, `LongInv_${mt}`);
  const header = { ...LONG_HEADER[mt], parameterization: 'THETA', difftestIn, useVars: [...t1, ...t2] };
  if (mt === 'cfa') header.iterations = 10000;
  const lines = [...titleLine(`${LONG_TITLE[mt]} - ${stepLabel(step, { thresholds: true })}${branchTag(f)}`), ...headerBlocks(spec, header), 'MODEL:'];
  // measurement blocks — the same forms as the continuous builders
  if (mt === 'esem') {
    lines.push(stmt([`${t1r} BY`, ...t1, flag('t1')]), stmt([`${t2r} BY`, ...t2, flag('t2')]));
    if (f.varcov) lines.push(...t2VarLines(k, f.free.varcov), ...longCovLabels(k, f.free.varcov));
  } else if (mt === 'cfa') {
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${fi + 1}`, mainItemsForFactor(spec, fac.id), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${k + fi + 1}`, mainItemsForFactor(spec, fac.id).map((it) => waveCounterpart(spec, it)), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    lines.push(`${t1r}@1;`);
    if (!f.equate || f.varcov) lines.push(...(f.varcov ? t2VarLines(k, f.free.varcov) : [`${t2r}@1;`]));
    if (f.varcov) lines.push(...longCovLabels(k, f.free.varcov));
  } else if (mt === 'besem') {
    lines.push(...waveBifactorBlocks(spec, t1, 'G1', 1, flag('t1')), ...waveBifactorBlocks(spec, t2, 'G2', k + 1, flag('t2')));
    if (f.varcov) {
      lines.push(...t2VarLines(k, f.free.varcov, 'G'));
      const fact1 = ['G1', ...Array.from({ length: k }, (_, i) => `F${i + 1}`)];
      const fact2 = ['G2', ...Array.from({ length: k }, (_, i) => `F${k + i + 1}`)];
      let c = 1;
      for (let i = 0; i < fact1.length; i++) for (let j = i + 1; j < fact1.length; j++) { lines.push(`${fact1[i]} WITH ${fact1[j]} (lcov${c});`, `${fact2[i]} WITH ${fact2[j]} (lcov${c});`); c++; }
    }
  } else {
    lines.push(...cfaWaveByLines('G1', t1, 'LG', f.equate, freeLoadingPositions(spec, f.free.loadings, 'G', t1)));
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${fi + 1}`, mainItemsForFactor(spec, fac.id), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    lines.push(...cfaWaveByLines('G2', t2, 'LG', f.equate, freeLoadingPositions(spec, f.free.loadings, 'G', t1)));
    spec.factors.forEach((fac, fi) => lines.push(...cfaWaveByLines(`F${k + fi + 1}`, mainItemsForFactor(spec, fac.id).map((it) => waveCounterpart(spec, it)), `L${fi + 1}`, f.equate, freeLoadingPositions(spec, f.free.loadings, fac.id, mainItemsForFactor(spec, fac.id)))));
    lines.push('G1@1;', `${t1r}@1;`);
    if (!f.equate || f.varcov) lines.push(...(f.varcov ? t2VarLines(k, f.free.varcov, 'G', true) : ['G2@1;', `${t2r}@1;`]));
    const w1 = ['G1', ...Array.from({ length: k }, (_, i) => `F${i + 1}`)];
    const w2 = ['G2', ...Array.from({ length: k }, (_, i) => `F${k + i + 1}`)];
    lines.push(...orthogonalityLines(w1), ...orthogonalityLines(w2));
  }
  // thresholds (equality across waves by shared labels), THETA uniquenesses, latent means
  lines.push(thrLines(t1), thrLines(t2));
  lines.push(wrapList(t1.map((it) => `${it}@1;`)));
  lines.push(wrapList(t2.map((it, p) => (f.residuals && !freeRes.has(p) ? `${it}@1;` : `${it}*;`))));
  lines.push(`[${t1r}@0];`);
  if (bifactor) lines.push('[G1@0];');
  lines.push(...(f.meanFix ? t2MeanLines(k, f.free.means, gid) : [`[${t2r}];`, ...(bifactor ? ['[G2];'] : [])]));
  if (spec.longitudinal.correlatedUniqueness) lines.push(...pwithLines(t1, t2));
  lines.push(...outputBlock(spec));
  if (difftestOut) lines.push('SAVEDATA:', `DIFFTEST = ${difftestOut};`);
  return lines.join('\n') + '\n';
}

/** Dispatch. A trailing "@p" selects the partial-invariance branch of a chain ("inv:scalar@p", "linv:esem:strict@p"). */
export function buildInp(spec, modelType) {
  let key = modelType, variant = '';
  const at = modelType.indexOf('@');
  if (at >= 0) { variant = modelType.slice(at + 1); key = modelType.slice(0, at); }
  if (key.startsWith('linv:')) {
    const [, mt0, step] = key.split(':');
    const mt = ['cfa', 'besem', 'bcfa'].includes(mt0) ? mt0 : 'esem';
    return isCategoricalLongitudinal(spec) ? buildLongCategorical(spec, mt, step, variant) : buildLongContinuous(spec, mt, step, variant);
  }
  const colon = key.indexOf(':');
  if (colon > 0 && MG_BY_KEY[key.slice(0, colon)]) return buildMgInvariance(spec, MG_BY_KEY[key.slice(0, colon)], key.slice(colon + 1), variant);
  switch (key) {
    case 'cfa': return buildCFA(spec);
    case 'esem': return spec.rotation.type === 'TARGET' ? buildESEMTarget(spec) : buildESEMGeomin(spec);
    case 'bifactorCfa': return buildBifactorCfa(spec);
    case 'bifactorEsem': return buildBifactorEsem(spec);
    default: throw new Error(`Unknown model type: ${modelType}`);
  }
}

const MT_LABEL = { cfa: 'CFA', esem: 'ESEM', bcfa: 'Bifactor-CFA', besem: 'Bifactor-ESEM' };
const wantedChains = (spec) => {
  const want = [];
  if (spec.modelTypes.cfa) want.push('cfa');
  if (spec.modelTypes.esem) want.push('esem');
  if (spec.modelTypes.bifactorCfa) want.push('bcfa');
  if (spec.modelTypes.bifactorEsem) want.push('besem');
  return want.length ? want : ['esem'];
};
/** One chain's steps as model entries: the full chain, or (variant 'p') the branch from its first changed step on,
 *  skipped steps left out. `tag` prefixes the labels when several chains are present. */
function chainModels(spec, mode, mt, variant, tag) {
  const seq = (invHolder(spec, mode)?.sequence) || INV_SEQUENCE;
  const br = variant === 'p' ? invBranch(spec, mode, mt) : null;
  const start = br ? branchStart(br) : -1;
  const thresholds = mode === 'time' ? isCategoricalLongitudinal(spec) : isCategoricalInvariance(spec);
  const out = [];
  seq.forEach((step, i) => {
    if (br && (stepIdx(step) < start || br.skipped.includes(step))) return;
    const p = br ? 'p' : '';
    const key = mode === 'time' ? `linv:${mt}:${step}${p ? '@p' : ''}` : `${MG_CHAIN[mt].prefix}:${step}${p ? '@p' : ''}`;
    const file = mode === 'time' ? `LongInv_${mt}_${i + 1}${p}_${step}.inp` : `${MG_CHAIN[mt].filePrefix}_${i + 1}${p}_${step}.inp`;
    const partialHere = br?.partial[step]?.length ? ` · partial (${br.partial[step].join(', ')})` : (br ? ' · partial branch' : '');
    out.push({ key, step, modelType: mt, variant: p, label: `${tag}${stepLabel(step, { thresholds })}${partialHere}`, file });
  });
  return out;
}
/** The partial-invariance branch of one chain (empty without a branch): the models to (re)run after a step failed. */
export function branchModels(spec, mode, mt) {
  if (!invBranch(spec, mode, mt).active) return [];
  const many = wantedChains(spec).length > 1 || mt !== 'esem';
  return chainModels(spec, mode, mt, 'p', many ? `${MT_LABEL[mt]} · ` : '');
}

/** Which models the spec asks for, in display order. */
export function requestedModels(spec) {
  const out = [];
  const k = spec.factors.length, rot = spec.rotation.type;
  // Longitudinal invariance: single-group sequences across two waves for the checked measurement models,
  // the measurement models themselves on the Time-1 indicators first (Morin's Table 1: "Time 1 only").
  if (spec.longitudinal?.enabled && spec.longitudinal.waves?.[0]?.length) {
    const w1 = spec.longitudinal.waveLabels?.[0] || 'Time 1';
    if (spec.modelTypes.cfa) out.push({ key: 'cfa', label: `CFA · ${w1}`, file: `CFA_${k}f.inp` });
    if (spec.modelTypes.esem) out.push({ key: 'esem', label: `ESEM (${rot === 'TARGET' ? 'Target' : 'Geomin'}) · ${w1}`, file: `ESEM_${rot.toLowerCase()}_${k}f.inp` });
    if (spec.modelTypes.bifactorCfa) out.push({ key: 'bifactorCfa', label: `Bifactor-CFA · ${w1}`, file: `BifactorCFA_${k}s.inp` });
    if (spec.modelTypes.bifactorEsem) out.push({ key: 'bifactorEsem', label: `Bifactor-ESEM · ${w1}`, file: `BifactorESEM_${k}s.inp` });
    for (const mt of wantedChains(spec)) out.push(...chainModels(spec, 'time', mt, '', `${MT_LABEL[mt]} · `), ...chainModels(spec, 'time', mt, 'p', `${MT_LABEL[mt]} · `));
    return out;
  }
  // The checked measurement models are always generated on the total sample (Morin's Table 1 reports the
  // total-group CFA/ESEM/bifactor models before the multi-group ones). With grouping on, one invariance
  // sequence follows per checked measurement model — CFA, ESEM, bifactor-CFA, bifactor-ESEM, each with
  // its own file prefix (and DIFFTEST files) so the chains can share a folder; ESEM when none is checked.
  if (spec.modelTypes.cfa) out.push({ key: 'cfa', label: 'CFA', file: `CFA_${k}f.inp` });
  if (spec.modelTypes.esem) out.push({ key: 'esem', label: `ESEM (${rot === 'TARGET' ? 'Target' : 'Geomin'})`, file: `ESEM_${rot.toLowerCase()}_${k}f.inp` });
  if (spec.modelTypes.bifactorCfa) out.push({ key: 'bifactorCfa', label: 'Bifactor-CFA', file: `BifactorCFA_${k}s.inp` });
  if (spec.modelTypes.bifactorEsem) out.push({ key: 'bifactorEsem', label: 'Bifactor-ESEM', file: `BifactorESEM_${k}s.inp` });
  if (spec.groups?.enabled && spec.groups.variable) {
    const want = wantedChains(spec);
    for (const mt of want) {
      // the ESEM chain keeps its bare step labels when it is the only chain
      const tag = mt === 'esem' && want.length === 1 ? '' : `${MT_LABEL[mt]} · `;
      out.push(...chainModels(spec, 'groups', mt, '', tag), ...chainModels(spec, 'groups', mt, 'p', tag));
    }
  }
  return out;
}

/** Longest line length — used by tests to assert the 90-char Mplus limit. */
export function maxLineLength(inp) {
  return inp.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
}

export { isCategoricalInvariance, isCategoricalLongitudinal, diffTestName, labeledExcept };
