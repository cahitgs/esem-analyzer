// apa-render.js — render ParsedModel(s) into APA tables + prose (HTML strings). Pure.
// Number format follows APA: leading zero stripped for |x|<1; χ² 2 dp; loadings/fit 3 dp.
import { apaNum, apaP } from './ui.js';

const f2 = (x) => apaNum(x, 2, false);   // χ², no strip
const f3 = (x) => apaNum(x, 3);          // CFI/TLI/RMSEA/SRMR/λ/ω, strip leading zero
const ci = (lo, hi) => (lo == null || hi == null ? '—' : `[${f3(lo)}, ${f3(hi)}]`);

// ---- regularized upper incomplete gamma → chi-square upper-tail p-value ----
function gammaln(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (let j = 0; j < 6; j++) s += c[j] / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
function pchisqUpper(x, k) {
  if (x <= 0 || k <= 0) return 1;
  const a = k / 2, xx = x / 2;
  if (xx < a + 1) { // series for lower P
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 200; n++) { ap++; del *= xx / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-xx + a * Math.log(xx) - gammaln(a));
  }
  let b = xx + 1 - a, c = 1e300, d = 1 / b, h = d; // continued fraction for upper Q
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return h * Math.exp(-xx + a * Math.log(xx) - gammaln(a));
}

/** Satorra–Bentler scaled χ² difference. mc = more constrained (larger df), mu = less constrained. */
export function sbChiSqDiff(mc, mu) {
  const { chi2: T0, scalingFactor: c0, df: df0 } = mc;
  const { chi2: T1, scalingFactor: c1, df: df1 } = mu;
  if ([T0, df0, T1, df1].some((v) => v == null) || df0 === df1) return null;
  const cc0 = c0 == null ? 1 : c0, cc1 = c1 == null ? 1 : c1;
  const cd = (df0 * cc0 - df1 * cc1) / (df0 - df1);
  if (!(cd > 0)) return null;
  const TRd = (T0 * cc0 - T1 * cc1) / cd;
  const ddf = Math.abs(df0 - df1);
  return { TRd, df: ddf, p: pchisqUpper(TRd, ddf), scaled: c0 != null || c1 != null };
}

function verdict(fit) {
  if (fit.cfi == null || fit.rmsea == null) return 'an estimable';
  if (fit.cfi >= 0.95 && fit.tli >= 0.95 && fit.rmsea <= 0.06) return 'excellent';
  if (fit.cfi >= 0.90 && fit.rmsea <= 0.08) return 'acceptable';
  return 'poor';
}

// ============================ Fit table ============================
/**
 * models: [{ label, parsed }]. deltaMode: 'consecutive' (each row vs the row above) | 'none'.
 * Δχ² uses the Satorra–Bentler scaling; the row above is treated as the more-constrained model
 * when it has the larger df.
 */
/** Model family read from the output itself: a rotated solution is ESEM, a general factor makes it bifactor. */
export function fitFamily(p) {
  if (!p) return null;
  const rotated = !!p.rotation, bifactor = !!p.generalFactor;
  return bifactor ? (rotated ? 'besem' : 'bcfa') : (rotated ? 'esem' : 'cfa');
}

/** Which model each fit row is compared with. 'auto' follows Morin's (2023) sequence whenever the outputs span at
 *  least two of the four measurement models: ESEM and bifactor-CFA are compared with the CFA, bifactor-ESEM with
 *  the ESEM (else with the bifactor-CFA, else with the CFA). A χ² difference is only meaningful for nested pairs
 *  (CFA within ESEM, bifactor-CFA within bifactor-ESEM); the other pairs get ΔCFI/ΔTLI/ΔRMSEA only. Outputs of one
 *  family (e.g. CFAs with 1, 2, 3 factors) keep the older row-by-row ('consecutive') comparison. */
export function fitComparisons(models, deltaMode = 'auto') {
  if (deltaMode === 'none' || models.length < 2) return { mode: 'none', rows: models.map(() => ({ ref: null, nested: false })) };
  const fam = models.map((m) => fitFamily(m.parsed));
  const distinct = new Set(fam.filter(Boolean));
  const mode = deltaMode === 'consecutive' ? 'consecutive'
    : (deltaMode === 'reference' || (fam.every(Boolean) && distinct.size >= 2)) ? 'reference' : 'consecutive';
  if (mode === 'consecutive') return { mode, rows: models.map((m, i) => ({ ref: i ? i - 1 : null, nested: true })) };
  const first = (f) => fam.indexOf(f);
  const rows = models.map((m, i) => {
    const f = fam[i];
    let ref = -1, nested = false;
    if (f === 'esem') { ref = first('cfa'); nested = true; }
    else if (f === 'bcfa') { ref = first('cfa'); nested = false; }
    else if (f === 'besem') {
      if (first('esem') >= 0) { ref = first('esem'); nested = false; }
      else if (first('bcfa') >= 0) { ref = first('bcfa'); nested = true; }
      else { ref = first('cfa'); nested = false; }
    }
    return ref < 0 || ref === i ? { ref: null, nested: false } : { ref, nested };
  });
  return { mode, rows };
}

/** Δ statistics of `cur` against `ref`: Satorra–Bentler scaled Δχ² only for nested MLR pairs, index differences always. */
export function fitDelta(ref, cur, { nested = true, useWrmr = false } = {}) {
  const mc = (ref.df ?? 0) >= (cur.df ?? 0) ? ref : cur;
  const mu = mc === ref ? cur : ref;
  const sb = nested && !useWrmr ? sbChiSqDiff(mc, mu) : null;
  return {
    sb,
    dcfi: cur.cfi != null && ref.cfi != null ? cur.cfi - ref.cfi : null,
    dtli: cur.tli != null && ref.tli != null ? cur.tli - ref.tli : null,
    drmsea: cur.rmsea != null && ref.rmsea != null ? cur.rmsea - ref.rmsea : null,
  };
}

export const REFERENCE_NOTE = 'Each Δ compares the model with the reference model in the vs. column — the ESEM with the CFA, then each bifactor model with its first-order counterpart, the comparisons of Morin (2023), who makes the second one for the retained first-order model; Δχ²(s) is given only for nested pairs (CFA within ESEM, bifactor-CFA within bifactor-ESEM).';

export function renderFitTable(models, { deltaMode = 'auto', caption = 'Goodness-of-fit statistics', wlsmv = null } = {}) {
  // Auto-detect WLSMV: no model reports SRMR but at least one reports WRMR.
  const useWrmr = wlsmv != null ? wlsmv : (!models.some((m) => m.parsed.fit.srmr != null) && models.some((m) => m.parsed.fit.wrmr != null));
  const fitCol = useWrmr ? 'WRMR' : 'SRMR';
  const cmp = fitComparisons(models, deltaMode);
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', fitCol];
  if (cmp.mode !== 'none') head.push(...(cmp.mode === 'reference' ? ['vs.'] : []), 'Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔTLI', 'ΔRMSEA');
  let rows = '';
  models.forEach((m, i) => {
    const f = m.parsed.fit;
    const cells = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli),
      `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`, f3(useWrmr ? f.wrmr : f.srmr)];
    if (cmp.mode !== 'none') {
      const c = cmp.rows[i];
      if (c.ref == null) cells.push(...(cmp.mode === 'reference' ? ['—'] : []), '—', '—', '—', '—', '—');
      else {
        const d = fitDelta(models[c.ref].parsed.fit, f, { nested: c.nested, useWrmr });
        if (cmp.mode === 'reference') cells.push(models[c.ref].label);
        cells.push(
          d.sb ? `${f2(d.sb.TRd)}${d.sb.p < 0.05 ? '*' : ''}` : '—',
          d.sb ? d.sb.df : '—',
          d.dcfi != null ? signed(d.dcfi, 3) : '—',
          d.dtli != null ? signed(d.dtli, 3) : '—',
          d.drmsea != null ? signed(d.drmsea, 3) : '—',
        );
      }
    }
    rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  });
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'}. CFI = comparative fit index; TLI = Tucker–Lewis index; RMSEA = root mean square error of approximation; ${fitCol} = ${useWrmr ? 'weighted' : 'standardized'} root mean square residual.${cmp.mode === 'reference' ? ' ' + REFERENCE_NOTE : ''}${useWrmr ? ' For the WLSMV estimator, χ² differences require the DIFFTEST option; compare models via ΔCFI/ΔTLI/ΔRMSEA.' : ' Δχ²(s) = Satorra–Bentler scaled χ² difference for the MLR estimator.'}${unestimatedFitNote(models, { html: true })} * <i>p</i> &lt; .05.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption>`
    + `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}`;
}

function signed(x, dp) { const s = apaNum(Math.abs(x), dp); return (x < 0 ? '−' : '+') + s; }
/** "ΔCFI = −.024, ΔTLI = −.037, ΔRMSEA = +.071" — indices without a value are left out. */
export function deltaText(dec) {
  const parts = [['ΔCFI', dec.dcfi], ['ΔTLI', dec.dtli], ['ΔRMSEA', dec.drmsea]].filter(([, v]) => v != null).map(([k, v]) => `${k} = ${signed(v, 3)}`);
  return parts.length ? parts.join(', ') : 'fit statistics unavailable';
}

// ======================= Measurement-invariance table =======================
/** Chen's (2007) guideline as Morin (2023) and Swami et al. (2023) state it: decreases of no more than .010 in CFI
 *  and TLI and an increase of no more than .015 in RMSEA support the more constrained model; larger changes suggest
 *  that the constraints a step adds are not tenable. The deltas are compared at the 3-decimal precision Mplus
 *  reports (a displayed −.010 still stays within the guideline; raw
 *  floating-point noise such as .990 − 1.000 = −0.010000000000000009 must not move the result). ok = the
 *  step stays within the guideline; it is a reading aid for the Δ columns, not a verdict — the tables carry
 *  no decision column. ΔTLI is skipped only when a TLI is missing. */
export function invarianceDecision(prev, cur) {
  if (!prev) return { ok: null, text: '—', dcfi: null, dtli: null, drmsea: null };
  const diff = (a, b) => (a != null && b != null ? a - b : null);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const dcfi = diff(cur.cfi, prev.cfi), dtli = diff(cur.tli, prev.tli), drmsea = diff(cur.rmsea, prev.rmsea);
  const ok = dcfi != null && drmsea != null
    && r3(dcfi) >= -0.010 && (dtli == null || r3(dtli) >= -0.010) && r3(drmsea) <= 0.015;
  return { ok, text: dcfi == null ? '—' : (ok ? 'Within guideline' : 'Beyond guideline'), dcfi, dtli, drmsea };
}

// ---- step order and estimation status (shared by the on-screen table, the prose and the Word/.docx export) ----
// The order is the invariance sequence itself (configural → metric → scalar → strict → var/cov → latent
// means), read from the step the parser takes out of the TITLE (or from the row label). The old rule —
// sort by df — put every output WITHOUT fit statistics first, so one failed step scrambled the whole table.
const STEP_PATTERNS = [
  [0, /configural/i], [1, /metric|weak|loading/i], [2, /scalar|strong|intercept/i],
  [3, /strict|residual|uniq/i], [5, /mean/i], [4, /var|covar/i],
];
/** 0–5 for a recognisable invariance step, else null (df then decides). */
export function invStepIndex(m) {
  const key = m.parsed?.invStep || m.label || '';
  for (const [idx, re] of STEP_PATTERNS) if (re.test(key)) return idx;
  return null;
}
/** The models in sequence order (unknown steps last, then by df, then input order). Input is not mutated. */
export function sortInvarianceModels(models) {
  return models.map((m, i) => ({ m, i, k: invStepIndex(m) ?? 99, br: m.parsed?.invBranch ? 1 : 0, df: m.parsed?.fit?.df ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.k - b.k) || (a.br - b.br) || (a.df - b.df) || (a.i - b.i))
    .map((x) => x.m);
}
/** Why an output carries no fit statistics (null when it has them). */
export function noFitReason(p) {
  if (p?.fit?.chi2 != null && p?.fit?.df != null) return null;
  if (p?.emptyCategory) return `a response category of ${p.emptyCategory.variable} is empty in group ${p.emptyCategory.group} — merge it on the Model step`;
  if (p?.inputError) return `Mplus input error — ${p.inputError}`;
  if (!p?.converged) return 'did not converge';
  if (p.rotationFailed) return 'rotation did not converge';
  if (p.chiSquareComputed === false) return 'χ² could not be computed';
  if (p.seComputed === false) return 'standard errors could not be computed';
  // estimated, but only a loglikelihood-based fit exists (e.g. MLR with categorical indicators: Mplus
  // reports loglikelihood/AIC/BIC and no χ²-based indices) — not a failure
  if (p.fit?.logLik != null) return null;
  return 'no fit statistics reported';
}
/** Estimated without χ²-based fit indices (loglikelihood only). */
export function chiSquareFree(p) { return noFitReason(p) == null && p?.fit?.chi2 == null; }
/** The sentence for such a model (shared by the manuscript and the Word/.docx export). */
export function noChiSquareSentence(label, f) {
  return `The ${label} model converged (log-likelihood = ${f2(f.logLik)}, AIC = ${f2(f.aic)}, BIC = ${f2(f.bic)}), but Mplus reports no χ²-based fit indices for it (as with MLR and categorical indicators), so CFI, TLI and RMSEA are not available.`;
}
// ---- the partial-invariance branch (Byrne et al., 1989; Morin, 2023) ----
// A branch model's TITLE tag (parsed into parsed.invBranch) says which parameters it frees and which steps it
// leaves out. The branch replaces the full chain from its first changed step on: the full model of the step that
// failed stays in the table as the record of the failure (reported, not retained), the full models of the later
// steps are superseded, and every Δ is taken against the last RETAINED model.
const STEP_KEYS = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const STEP_WORD = { configural: 'configural', metric: 'weak', scalar: 'strong', strict: 'strict', varcov: 'latent variance–covariance', latentmean: 'latent means' };
const KIND_WORDS = { metric: ['loading', 'loadings'], scalar: ['intercept', 'intercepts'], strict: ['uniqueness', 'uniquenesses'], varcov: ['factor variance/covariance term', 'factor variance/covariance terms'], latentmean: ['latent mean', 'latent means'] };
export const branchOf = (m) => m?.parsed?.invBranch || null;
const stepKeyOf = (m) => { const i = invStepIndex(m); return i == null ? null : STEP_KEYS[i]; };
const stepPos = (key) => STEP_KEYS.indexOf(key);
/** Human form of a freed parameter id: 'Z2' → 'Z2', 'F1:X3' → 'F1 → X3', 'F1~F2' → 'F1–F2'. */
const idText = (id) => String(id).replace(':', ' → ').replace('~', '–');
/** "Z2 intercept free", "Z2 and Z4 thresholds free", "3 intercepts freed" (a title tag that only kept the count). */
export function freedText(branch, step, thresholds = false) {
  const ids = branch.partial?.[step] || [];
  const n = branch.counts?.[step] ?? ids.length;
  const words = step === 'scalar' && thresholds ? ['thresholds', 'thresholds'] : KIND_WORDS[step] || ['parameter', 'parameters'];
  if (!ids.length) return `${n} ${n === 1 ? words[0] : words[1]} freed`;
  return `${joinList(ids.map(idText))} ${ids.length === 1 ? words[0] : words[1]} free`;
}
/** The row label of an invariance output: its step; the partial model of a step reads "Partial strong (Z2 intercept
 *  free)"; the later branch models keep their step label (the note says what they are built from). */
export function invarianceLabel(p) {
  const step = p?.invStep || null;
  const b = p?.invBranch;
  if (!step || !b) return step;
  const key = STEP_KEYS[invStepIndex({ parsed: p })] || null;
  if (key && b.partial?.[key]) return `Partial ${STEP_WORD[key]} (${freedText(b, key, /threshold/i.test(step))})`;
  return step;
}
/** The modification index a failed model reports for a parameter freed at `step` (max over groups), or null. */
export function modIndexFor(parsed, step, id) {
  const mi = parsed?.modIndices;
  if (!mi?.entries?.length || !id) return null;
  // Mplus prints variable names in upper case; a longitudinal pair ("z2_t1/z2_t2", "F1:x3_t1/x3_t2") takes the larger index
  const U = (x) => String(x || '').toUpperCase();
  const [head, tail] = String(id).includes(':') ? String(id).split(':') : [null, String(id)];
  const names = tail.split('/').map(U);
  const hits = mi.entries.filter((e) => {
    if (step === 'metric') return e.kind === 'BY' && names.includes(U(e.b)) && (names.length > 1 || U(e.a) === U(head));
    if (step === 'varcov') return names.some((part) => { // a covariance pair across time: "F1~F2/F4~F5"
      if (part.includes('~')) { const [x, y] = part.split('~'); return e.kind === 'WITH' && ((U(e.a) === x && U(e.b) === y) || (U(e.a) === y && U(e.b) === x)); }
      return e.kind === 'VAR' && U(e.a) === part;
    });
    if (step === 'strict') return e.kind === 'VAR' && names.includes(U(e.a));
    // intercepts, thresholds ("[ Z2$2 ]", or "[ PSI1_T1$ ]" when Mplus truncates the name) and latent means
    return e.kind === 'MEAN' && (names.includes(U(e.a)) || names.includes(U(e.a).replace(/\$.*$/, '')));
  });
  return hits.length ? Math.max(...hits.map((e) => e.mi)) : null;
}

/** Rows of an invariance table: sequence order, each model's nearest ESTIMATED predecessor among the retained
 *  models and the Δ against it. A model whose .out has no fit statistics keeps its place but is marked
 *  unestimated and skipped by the comparisons, so a failed step can neither scramble the rows nor hide the
 *  configural baseline. skipped = the unestimated models between a row and its comparison model (the row then
 *  carries a letter mark, explained in the note); after = the first earlier retained step whose Δ went beyond
 *  the guideline (null if none) — the rows after it are reported for completeness. With a partial-invariance
 *  branch: retained = false on the full model of the step that failed (shown, not a comparison model), the full
 *  models of the later steps are left out, branch = the model's branch info, partialStep = the step whose
 *  partial model this row is. */
export function invarianceSeries(models) {
  const sorted = sortInvarianceModels(models);
  const branches = sorted.filter(branchOf);
  const partialAt = new Set(), skippedSteps = new Set();
  let start = Infinity;
  for (const m of branches) {
    const b = branchOf(m);
    for (const st of Object.keys(b.partial || {})) { partialAt.add(st); start = Math.min(start, stepPos(st)); }
    for (const st of b.skipped || []) { skippedSteps.add(st); start = Math.min(start, stepPos(st) + 1); }
  }
  const rows = [];
  let prev = null, skipped = [], exceeded = null, marks = 0;
  for (const m of sorted) {
    const key = stepKeyOf(m);
    const b = branchOf(m);
    let retained = true;
    if (!b && key) {
      if (partialAt.has(key) || skippedSteps.has(key)) retained = false; // the failed step, kept as the record
      else if (stepPos(key) >= start) continue;                           // superseded by the branch
    }
    const f = m.parsed.fit || {};
    const reason = noFitReason(m.parsed);
    const estimated = reason == null;
    const dec = estimated ? invarianceDecision(prev ? prev.parsed.fit : null, f)
      : { ok: null, text: 'Not estimated', dcfi: null, dtli: null, drmsea: null };
    const row = { m, f, estimated, reason, prev, dec, skipped: estimated && prev ? skipped : [], after: exceeded, mark: '', retained, branch: b, partialStep: b && key && b.partial?.[key] ? key : null };
    if (row.skipped.length) row.mark = String.fromCharCode(97 + marks++);
    rows.push(row);
    if (estimated && retained) { prev = m; skipped = []; if (dec.ok === false && !exceeded) exceeded = m; }
    else if (!estimated) skipped = [...skipped, m];
  }
  return rows;
}
/** The sentences a branch adds to a table note / the prose: what the partial models free and are compared with,
 *  what the later models are built from, which steps were left out. html → labels escaped. */
export function branchNote(series, { html = false } = {}) {
  const lbl = (r) => (html ? esc(r.m.label) : r.m.label);
  const thr = series.some((r) => /threshold/i.test(r.m.parsed?.invStep || ''));
  const out = [];
  for (const r of series.filter((x) => x.partialStep)) {
    const st = r.partialStep;
    const later = series.filter((x) => x.branch && x !== r && x.estimated && stepPos(stepKeyOf(x.m)) > stepPos(st));
    const failed = series.find((x) => !x.retained && stepKeyOf(x.m) === st);
    const n = (r.branch.partial[st] || []).length || r.branch.counts?.[st] || 1;
    out.push(`The partial ${STEP_WORD[st]} model frees the ${freedText(r.branch, st, thr).replace(/ free$/, '')}${failed ? ` — the parameter${n > 1 ? 's' : ''} with the largest modification ${n > 1 ? 'indices' : 'index'} of the ${lbl(failed).toLowerCase()} model, which is reported but not retained` : ''} — and is compared with the ${r.prev ? lbl({ m: r.prev }).toLowerCase() : 'preceding'} model${later.length ? `; the ${joinList(later.map((x) => lbl(x).toLowerCase()))} model${later.length > 1 ? 's are' : ' is'} built from it` : ''} (Byrne et al., 1989; Morin, 2023).`);
  }
  const skippedSteps = [...new Set(series.flatMap((r) => r.branch?.skipped || []))];
  for (const st of skippedSteps) {
    const after = series.filter((x) => x.branch && x.estimated && x.branch.skipped.includes(st));
    const failed = series.find((x) => !x.retained && stepKeyOf(x.m) === st);
    if (!after.length) continue;
    out.push(`The ${joinList(after.map((x) => lbl(x).toLowerCase()))} model${after.length > 1 ? 's are' : ' is'} estimated without the ${STEP_WORD[st]} constraints${failed ? ` (the ${lbl(failed).toLowerCase()} model is reported but not retained; its constraints have no partial form in an ESEM set)` : ''} and compared with the last retained model (Morin, 2023).`);
  }
  return out.join(' ');
}
/** Note sentences shared by the on-screen table and the Word/.docx export: how to read the Δ columns (Chen's
 *  guideline, the rows after a step that went beyond it), the branch sentences, and the letter marks of rows whose
 *  comparison model is not the preceding step. html → labels escaped for innerHTML. */
export function invarianceGuidelineNote(series, { html = false } = {}) {
  const lbl = (m) => (html ? esc(m.label) : m.label);
  const beyond = series.some((r) => r.estimated && r.retained && r.dec.ok === false);
  let s = 'Models are ordered from least to most constrained; each Δ compares with the preceding retained model. As a guideline (Chen, 2007), a decrease of more than .010 in CFI or TLI, or an increase of more than .015 in RMSEA, suggests that the constraints a step adds are not tenable'
    + (beyond ? '; the rows after such a step are reported for completeness and do not establish those levels of invariance (Morin, 2023).' : '.');
  const bn = branchNote(series, { html });
  if (bn) s += ' ' + bn;
  for (const r of series.filter((x) => x.mark)) {
    s += ` ${html ? `<sup>${r.mark}</sup>` : r.mark} Compared with the ${lbl(r.prev)} model because the ${joinList(r.skipped.map(lbl))} model${r.skipped.length > 1 ? 's' : ''} could not be estimated, so the Δ covers the constraints of both steps.`;
  }
  return s;
}
/** Fit-table note suffix naming the models without fit statistics and the loglikelihood-only ones ('' when
 *  every model has χ²-based indices). html → labels escaped for innerHTML; plain text for the .docx path. */
export function unestimatedFitNote(models, { html = false } = {}) {
  const lbl = (m) => (html ? esc(m.label) : m.label);
  const bad = models.filter((m) => noFitReason(m.parsed));
  const llOnly = models.filter((m) => chiSquareFree(m.parsed));
  let s = '';
  if (bad.length) s += ` Not estimated: Mplus produced no fit statistics for ${joinList(bad.map((m) => `${lbl(m)} (${noFitReason(m.parsed)})`))} — see the .out.`;
  if (llOnly.length) s += ` ${joinList(llOnly.map(lbl))}: Mplus reports no χ²-based fit indices for this model (loglikelihood-based estimation, e.g. MLR with categorical indicators); CFI, TLI and RMSEA are unavailable.`;
  return s;
}
/** Note sentence for unestimated rows ('' when every model has fit statistics). */
export function unestimatedNote(rows, { html = false } = {}) {
  const bad = rows.filter((r) => !r.estimated);
  if (!bad.length) return '';
  return ` Not estimated: Mplus produced no fit statistics for ${joinList(bad.map((r) => `${html ? esc(r.m.label) : r.m.label} (${r.reason})`))} — see the .out; these rows are excluded from the comparisons, and each Δ compares with the nearest estimated model above.`;
}

export function renderInvarianceTable(models, { caption, longitudinal = false } = {}) {
  if (!caption) caption = longitudinal ? 'Tests of longitudinal measurement invariance' : 'Tests of measurement invariance across groups';
  // WLSMV (categorical) sequences: the χ² values cannot be differenced or SB-scaled — the only
  // valid Δχ² is Mplus's DIFFTEST, which each step's own .out reports against the previous step.
  const wlsmv = models.some((m) => /MV$/i.test(m.parsed.estimator || '') || m.parsed.diffTest);
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', wlsmv ? 'Δχ²' : 'Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔTLI', 'ΔRMSEA'];
  const series = invarianceSeries(models);
  let rows = '';
  let missingDiff = false;
  for (const r of series) {
    const { m, f, dec } = r;
    if (!r.estimated) {
      const cells = [esc(m.label), '<span style="color:var(--danger);font-weight:600">Not estimated</span>', ...Array(9).fill('—')];
      rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
      continue;
    }
    const prev = r.prev ? r.prev.parsed.fit : null;
    let dchi = '—', ddf = '—';
    if (prev && wlsmv) {
      const d = m.parsed.diffTest;
      if (d) { dchi = f2(d.chi2) + (d.p != null && d.p < 0.05 ? '*' : ''); ddf = d.df; }
      else missingDiff = true;
    } else if (prev) { const mc = (prev.df ?? 0) >= (f.df ?? 0) ? prev : f; const mu = mc === prev ? f : prev; const sb = sbChiSqDiff(mc, mu); if (sb) { dchi = f2(sb.TRd) + (sb.p < 0.05 ? '*' : ''); ddf = sb.df; } }
    const cells = [esc(m.label) + (r.mark ? `<sup>${r.mark}</sup>` : '') + (r.retained ? '' : '<sup>†</sup>'), f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`,
      dchi, ddf, dec.dcfi != null ? signed(dec.dcfi, 3) : '—', dec.dtli != null ? signed(dec.dtli, 3) : '—', dec.drmsea != null ? signed(dec.drmsea, 3) : '—'];
    rows += `<tr${r.retained ? '' : ' class="not-retained"'}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }
  const across = longitudinal ? 'across two time points' : `across ${models[0]?.parsed.nGroups ?? 2} groups`;
  const dchiNote = wlsmv
    ? `Δχ² = WLSMV difference test (Mplus DIFFTEST) against the preceding model; WLSMV χ² values cannot be differenced directly.${missingDiff ? ' Missing Δχ² values: run the generated models in order, in one folder, so each step finds the previous step’s DIFFTEST file.' : ''}`
    : 'Δχ²(s) = Satorra–Bentler scaled difference.';
  const dagger = series.some((r) => !r.retained) ? ' † Reported but not retained.' : '';
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'} ${across}. ${invarianceGuidelineNote(series, { html: true })} ${dchiNote}${unestimatedNote(series, { html: true })}${dagger} * <i>p</i> &lt; .05.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}`;
}

/** Plain-text invariance paragraph shared by the manuscript (renderInvarianceProse) and the Word/.docx export. */
export function invarianceProseText(models, { longitudinal = false } = {}) {
  const series = invarianceSeries(models);
  const est = series.filter((r) => r.estimated);
  const skipped = series.filter((r) => !r.estimated);
  const over = longitudinal ? 'across the two time points' : 'across groups';
  const lower = (r) => r.m.label.toLowerCase();
  const thr = series.some((r) => /threshold/i.test(r.m.parsed?.invStep || ''));
  const skippedSentence = skipped.length
    ? ` The ${joinList(skipped.map(lower))} model${skipped.length > 1 ? 's' : ''} could not be estimated (${joinList([...new Set(skipped.map((r) => r.reason))])}) and ${skipped.length > 1 ? 'were' : 'was'} left out of the comparisons.`
    : '';
  if (est.length < 2) return skippedSentence.trim();
  // the comparison model, named when it is not the preceding step
  const against = (r) => (r.skipped.length ? `, against the ${r.prev.label.toLowerCase()} model because the ${joinList(r.skipped.map((x) => x.label.toLowerCase()))} model${r.skipped.length > 1 ? 's' : ''} could not be estimated` : '');
  const guideline = 'Chen’s (2007) guideline of a decrease of no more than .010 in CFI and TLI and an increase of no more than .015 in RMSEA';
  let s = `${est[0].m.label} invariance provided a baseline against which more constrained models were compared.`;
  let within = [], afterPartial = null, said = false, broke = false;
  const flush = () => {
    if (!within.length) return;
    const held = joinList(within.map(lower));
    s += ` The ${held} model${within.length > 1 ? 's' : ''}${afterPartial ? `, built from the ${afterPartial} model,` : ''} stayed within ${said ? 'the' : guideline} ${said ? 'guideline' : ''}`.replace(/\s+$/, '')
      + ` (${within.map((r) => `${lower(r)}: ${deltaText(r.dec)}${against(r)}`).join('; ')}), which is consistent with ${broke || afterPartial ? `${held} invariance` : 'full measurement invariance'} ${over}.`;
    said = true; within = [];
  };
  for (let i = 1; i < est.length; i++) {
    const r = est[i];
    if (!r.retained) {
      // the step that failed: its partial model (next row at the same step) or the skip that follows
      flush();
      const st = stepKeyOf(r.m);
      s += ` The ${lower(r)} model went beyond ${said ? 'the guideline' : guideline} (${deltaText(r.dec)}${against(r)}).`;
      said = true;
      const partial = est.find((x) => x.partialStep === st);
      if (partial) {
        const id = partial.branch.partial[st]?.[0];
        const mi = modIndexFor(r.m.parsed, st, id);
        s += ` The modification indices pointed to the ${freedText(partial.branch, st, thr).replace(/ free$/, '')}${mi != null ? ` (MI = ${apaNum(mi, 1, false)})` : ''}; with ${(partial.branch.partial[st] || []).length === 1 ? 'its' : 'their'} equality constraint${(partial.branch.partial[st] || []).length === 1 ? '' : 's'} removed, the ${lower(partial)} model ${partial.dec.ok === false ? `still went beyond the guideline (${deltaText(partial.dec)}), so further parameters should be freed one at a time before the sequence continues` : `stayed within the guideline relative to the ${partial.prev ? partial.prev.label.toLowerCase() : 'preceding'} model (${deltaText(partial.dec)}), which is consistent with partial ${STEP_WORD[st]} invariance`} (Byrne et al., 1989; Morin, 2023).`;
        afterPartial = `partial ${STEP_WORD[st]}`;
        i = est.indexOf(partial); // the partial row is told; continue after it
        if (partial.dec.ok === false) broke = true;
      } else if (est.some((x) => x.branch?.skipped?.includes(st))) {
        s += ` These constraints have no partial form in an ESEM set (Morin, 2023), so the following models were estimated without them and compared with the last retained model.`;
        afterPartial = afterPartial || null;
      }
      continue;
    }
    if (r.partialStep && !est.some((x) => !x.retained && stepKeyOf(x.m) === r.partialStep)) { within.push(r); continue; } // partial row without its failed model present
    if (r.dec.ok === false) {
      flush();
      s += ` The ${lower(r)} model went beyond ${said ? 'the guideline' : guideline} (${deltaText(r.dec)}${against(r)}), so ${lower(r)} invariance should not be accepted as it stands; a partial-invariance model that frees the parameters with the largest modification indices should be examined before the sequence continues (Morin, 2023).`;
      said = true; broke = true;
      const rest = est.slice(i + 1).filter((x) => x.retained);
      if (rest.length) s += ` The ${joinList(rest.map(lower))} model${rest.length > 1 ? 's' : ''} of the full sequence ${rest.length > 1 ? 'are' : 'is'} reported in the table for completeness: each was compared with the model before it and does not establish that level of invariance.`;
      break;
    }
    within.push(r);
  }
  flush();
  return s + skippedSentence;
}
export function renderInvarianceProse(models, opts = {}) {
  const s = invarianceProseText(models, opts);
  return s ? `<p class="apa-prose">${s}</p>` : '';
}

// ======================= Loadings table =======================
// Morin (Hoyle Handbook, ch. 27) Table-2 layout: items grouped into subscale blocks (one per
// specific/primary factor), each block closed by its ω row; main loadings bold, non-significant
// loadings (p ≥ .05) italic; the G-factor's ω rides on the last block's ω row.
/**
 * Shared structural model for the loadings table — consumed by renderLoadingsTable below and by
 * the Word/.docx exporters (docx-export.js) so the two layouts cannot drift.
 * rows: {kind:'rule'} between blocks | {kind:'item'|'omega', cells:[{t, bold?, italic?, cross?}]};
 * corr: lower-triangle rows for factors[1..] — the leading factor-name cell is added by each
 * renderer from fid (via its own factorLabels), then cells cover the factor columns + empty δ.
 */
export function buildLoadingsModel(parsed, { targetMatrix = null } = {}) {
  const factors = parsed.factorOrder;
  const isTarget = (item, fid) => {
    if (targetMatrix) return !!targetMatrix[item]?.[fid];
    if (parsed.generalFactor) return fid === parsed.generalFactor || parsed.specificFactor[item] === fid;
    return parsed.primaryFactor[item] === fid;
  };
  // the factor whose subscale block an item belongs to (never the general factor)
  const blockOf = (item) => {
    if (targetMatrix) { const hit = factors.find((fid) => fid !== parsed.generalFactor && targetMatrix[item]?.[fid]); if (hit) return hit; }
    return parsed.generalFactor ? parsed.specificFactor[item] : parsed.primaryFactor[item];
  };
  const blockFactors = factors.filter((fid) => fid !== parsed.generalFactor);
  const blocks = blockFactors.map((fid) => ({ fid, items: parsed.items.filter((it) => blockOf(it) === fid) })).filter((b) => b.items.length);
  const leftovers = parsed.items.filter((it) => !blocks.some((b) => b.items.includes(it)));
  if (leftovers.length) blocks.push({ fid: null, items: leftovers });

  const rows = [];
  let anyNonSig = false;
  blocks.forEach((blk, bi) => {
    if (bi > 0) rows.push({ kind: 'rule' });
    for (const it of blk.items) {
      const cells = [{ t: it }];
      for (const fid of factors) {
        const L = parsed.loadings[fid]?.[it];
        const bold = isTarget(it, fid);
        const italic = L?.p != null && L.p >= 0.05;
        if (italic) anyNonSig = true;
        cells.push({ t: f3(L?.est), bold, italic, cross: !bold });
      }
      cells.push({ t: f3(parsed.uniqueness[it]) });
      rows.push({ kind: 'item', cells });
    }
    // block ω row: the block factor's ω under its own column; G's ω on the last block's row
    const last = bi === blocks.length - 1;
    const om = [{ t: 'ω' }];
    for (const fid of factors) {
      const show = fid === blk.fid || (last && parsed.generalFactor && fid === parsed.generalFactor);
      om.push({ t: show ? f3(parsed.omega[fid]) : '' });
    }
    om.push({ t: '' });
    rows.push({ kind: 'omega', cells: om });
  });

  // factor-correlation lower triangle; renderers omit it when the solution is orthogonal
  // (all correlations fixed at 0 — e.g. bifactor models)
  const anyCorr = parsed.factorCorr.some((c) => c.est != null && Math.abs(c.est) >= 0.0005);
  const corrAt = corrLookup(parsed);
  const corr = factors.map((fid, i) => {
    if (i === 0) return null; // first factor has no lower-triangle entries
    const cells = factors.map((gid, j) => ({ t: j < i ? f3(corrAt(fid, gid)) : j === i ? '—' : '' }));
    cells.push({ t: '' });
    return { fid, cells };
  }).filter(Boolean);

  return { factors, rows, corr, anyCorr, anyNonSig };
}

export function renderLoadingsTable(parsed, { targetMatrix = null, factorLabels = {}, caption = 'Standardized factor loadings (STDYX)' } = {}) {
  const model = buildLoadingsModel(parsed, { targetMatrix });
  const lbl = (fid) => factorLabels[fid] || fid;
  const head = ['Item', ...model.factors.map(lbl), 'δ'];
  let body = '';
  for (const r of model.rows) {
    if (r.kind === 'rule') { body += `<tr class="grp-rule"><td colspan="${head.length}"></td></tr>`; continue; }
    if (r.kind === 'item') {
      body += `<tr>${r.cells.map((c, i) => (i === 0 || i === r.cells.length - 1
        ? `<td>${c.t}</td>`
        : `<td class="${c.bold ? 'target' : 'crossload'}">${c.italic ? `<i>${c.t}</i>` : c.t}</td>`)).join('')}</tr>`;
    } else {
      body += `<tr>${r.cells.map((c) => `<td>${c.t}</td>`).join('')}</tr>`;
    }
  }
  let corrRows = '';
  for (const r of model.corr) corrRows += `<tr><td>${lbl(r.fid)}</td>${r.cells.map((c) => `<td>${c.t}</td>`).join('')}</tr>`;
  const corrHeader = `<tr class="grp-rule"><td colspan="${head.length}"></td></tr><tr><td colspan="${head.length}" style="text-align:left;font-style:italic">Factor correlations</td></tr>`;

  const note = `<p class="apa-note"><i>Note.</i> Target (primary) loadings in <b>bold</b>; cross-loadings in grey${model.anyNonSig ? '; non-significant loadings (<i>p</i> ≥ .05) in <i>italics</i>' : ''}. δ = uniqueness (1 − R²); ω = McDonald's composite reliability (per subscale block${parsed.generalFactor ? '; the general factor’s ω is shown on the last block' : ''}).</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption>`
    + `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
    + `<tbody>${body}${model.anyCorr ? corrHeader + corrRows : ''}</tbody></table>${note}`;
}

function corrLookup(parsed) {
  const map = new Map();
  for (const c of parsed.factorCorr) { map.set(`${c.a}|${c.b}`, c.est); map.set(`${c.b}|${c.a}`, c.est); }
  return (a, b) => (map.has(`${a}|${b}`) ? map.get(`${a}|${b}`) : null);
}

// ============================ Prose ============================
export function renderProse(models, { factorLabels = {} } = {}) {
  const paras = [];
  for (const m of models) {
    const reason = noFitReason(m.parsed);
    if (reason) { paras.push(`The ${esc(m.label)} model could not be estimated (${reason}); inspect its Mplus output before interpreting any of its estimates.`); continue; }
    const f = m.parsed.fit;
    if (f.chi2 == null) { paras.push(`${noChiSquareSentence(esc(m.label), f)} ${loadingsSentence(m.parsed)}`); continue; }
    const v = verdict(f);
    paras.push(`The ${esc(m.label)} model provided ${v} fit to the data, <span class="stat">χ²</span>(${f.df}) = ${f2(f.chi2)}, <span class="stat">p</span> ${apaP(f.p)}, CFI = ${f3(f.cfi)}, TLI = ${f3(f.tli)}, RMSEA = ${f3(f.rmsea)} [90% CI ${f3(f.rmseaLo)}, ${f3(f.rmseaHi)}], SRMR = ${f3(f.srmr)}. ${loadingsSentence(m.parsed)}`);
  }
  const estimated = models.filter((m) => !noFitReason(m.parsed));
  const cmp = estimated.length >= 2 ? comparisonSentence(estimated) : '';
  if (cmp) paras.push(cmp);
  return paras.map((p) => `<p class="apa-prose">${p}</p>`).join('');
}

function loadingsSentence(p) {
  const targets = [];
  for (const it of p.items) { const fid = p.primaryFactor[it]; const v = p.loadings[fid]?.[it]?.est; if (v != null) targets.push(Math.abs(v)); }
  const omegas = Object.values(p.omega).filter((x) => x != null);
  if (!targets.length) return '';
  const lmin = f3(Math.min(...targets)), lmax = f3(Math.max(...targets));
  const wmin = omegas.length ? f3(Math.min(...omegas)) : null, wmax = omegas.length ? f3(Math.max(...omegas)) : null;
  let s = `Target standardized loadings ranged from |λ| = ${lmin} to ${lmax}`;
  if (wmin) s += `, with composite reliabilities of ω = ${wmin} to ${wmax}`;
  return s + '.';
}

function comparisonSentence(all) {
  const corrMean = (p) => { const v = p.factorCorr.map((c) => Math.abs(c.est)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // first-order solutions only: bifactor factor correlations are fixed at 0 by construction
  const models = all.filter((m) => !m.parsed.generalFactor);
  if (models.length < 2) return '';
  const a = models[0].parsed, b = models[models.length - 1].parsed;
  const ra = corrMean(a), rb = corrMean(b);
  if (ra == null || rb == null) return '';
  const dir = rb < ra ? 'lower' : 'higher';
  // bare sentence: renderProse wraps every paragraph itself
  return `Relative to the ${esc(models[0].label)} solution (mean |r| = ${f3(ra)}), factor correlations were ${dir} in the ${esc(models[models.length - 1].label)} solution (mean |r| = ${f3(rb)}), consistent with the expected effect of freely estimating cross-loadings.`;
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function joinList(arr) { if (arr.length <= 1) return arr[0] || ''; if (arr.length === 2) return arr.join(' and '); return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1]; }
