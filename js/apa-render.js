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
export function renderFitTable(models, { deltaMode = 'consecutive', caption = 'Goodness-of-fit statistics', wlsmv = null } = {}) {
  // Auto-detect WLSMV: no model reports SRMR but at least one reports WRMR.
  const useWrmr = wlsmv != null ? wlsmv : (!models.some((m) => m.parsed.fit.srmr != null) && models.some((m) => m.parsed.fit.wrmr != null));
  const fitCol = useWrmr ? 'WRMR' : 'SRMR';
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', fitCol];
  if (deltaMode !== 'none') head.push('Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔTLI', 'ΔRMSEA');
  let rows = '';
  models.forEach((m, i) => {
    const f = m.parsed.fit;
    const cells = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli),
      `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`, f3(useWrmr ? f.wrmr : f.srmr)];
    if (deltaMode !== 'none') {
      if (i === 0) cells.push('—', '—', '—', '—', '—');
      else {
        const prev = models[i - 1].parsed.fit, cur = f;
        const mc = (prev.df ?? 0) >= (cur.df ?? 0) ? prev : cur;
        const mu = mc === prev ? cur : prev;
        const sb = useWrmr ? null : sbChiSqDiff(mc, mu);  // SB scaled diff is MLR-only
        const dcfi = cur.cfi != null && prev.cfi != null ? cur.cfi - prev.cfi : null;
        const dtli = cur.tli != null && prev.tli != null ? cur.tli - prev.tli : null;
        const drmsea = cur.rmsea != null && prev.rmsea != null ? cur.rmsea - prev.rmsea : null;
        cells.push(
          sb ? `${f2(sb.TRd)}${sb.p < 0.05 ? '*' : ''}` : '—',
          sb ? sb.df : '—',
          dcfi != null ? signed(dcfi, 3) : '—',
          dtli != null ? signed(dtli, 3) : '—',
          drmsea != null ? signed(drmsea, 3) : '—',
        );
      }
    }
    rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  });
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'}. CFI = comparative fit index; TLI = Tucker–Lewis index; RMSEA = root mean square error of approximation; ${fitCol} = ${useWrmr ? 'weighted' : 'standardized'} root mean square residual.${useWrmr ? ' For the WLSMV estimator, χ² differences require the DIFFTEST option; compare models via ΔCFI/ΔTLI/ΔRMSEA.' : ' Δχ²(s) = Satorra–Bentler scaled χ² difference for the MLR estimator.'}${unestimatedFitNote(models, { html: true })} * <i>p</i> &lt; .05.</p>`;
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
/** Morin's rule (Chen, 2007; Cheung & Rensvold, 2002): the step is supported when the CFI and the
 *  TLI each drop by no more than .010 and the RMSEA rises by no more than .015 — i.e.
 *  ΔCFI ≥ −.010, ΔTLI ≥ −.010, ΔRMSEA ≤ .015. The deltas are compared at the 3-decimal precision
 *  Mplus reports, so a displayed −.010 passes (raw floating-point noise such as
 *  .990 − 1.000 = −0.010000000000000009 must not fail it). ΔTLI is skipped only when a TLI is missing. */
export function invarianceDecision(prev, cur) {
  if (!prev) return { ok: null, text: '—', dcfi: null, dtli: null, drmsea: null };
  const diff = (a, b) => (a != null && b != null ? a - b : null);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const dcfi = diff(cur.cfi, prev.cfi), dtli = diff(cur.tli, prev.tli), drmsea = diff(cur.rmsea, prev.rmsea);
  const ok = dcfi != null && drmsea != null
    && r3(dcfi) >= -0.010 && (dtli == null || r3(dtli) >= -0.010) && r3(drmsea) <= 0.015;
  return { ok, text: dcfi == null ? '—' : (ok ? 'Supported' : 'Not supported'), dcfi, dtli, drmsea };
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
  return models.map((m, i) => ({ m, i, k: invStepIndex(m) ?? 99, df: m.parsed?.fit?.df ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.k - b.k) || (a.df - b.df) || (a.i - b.i))
    .map((x) => x.m);
}
/** Why an output carries no fit statistics (null when it has them). */
export function noFitReason(p) {
  if (p?.fit?.chi2 != null && p?.fit?.df != null) return null;
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
/** Rows of an invariance table: sequence order, each model's nearest ESTIMATED predecessor and the decision
 *  against it. A model whose .out has no fit statistics keeps its place but is marked unestimated and skipped
 *  by the comparisons, so a failed step can neither scramble the rows nor hide the configural baseline. */
export function invarianceSeries(models) {
  const rows = [];
  let prev = null;
  for (const m of sortInvarianceModels(models)) {
    const f = m.parsed.fit || {};
    const reason = noFitReason(m.parsed);
    const estimated = reason == null;
    const dec = estimated ? invarianceDecision(prev ? prev.parsed.fit : null, f)
      : { ok: null, text: 'Not estimated', dcfi: null, dtli: null, drmsea: null };
    rows.push({ m, f, estimated, reason, prev, dec });
    if (estimated) prev = m;
  }
  return rows;
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
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', wlsmv ? 'Δχ²' : 'Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔTLI', 'ΔRMSEA', 'Decision'];
  const series = invarianceSeries(models);
  let rows = '';
  let missingDiff = false;
  for (const r of series) {
    const { m, f, dec } = r;
    if (!r.estimated) {
      const cells = [m.label, ...Array(10).fill('—'), '<span style="color:var(--danger);font-weight:600">Not estimated</span>'];
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
    const colour = dec.ok === true ? 'color:var(--good)' : dec.ok === false ? 'color:var(--danger)' : '';
    const cells = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`,
      dchi, ddf, dec.dcfi != null ? signed(dec.dcfi, 3) : '—', dec.dtli != null ? signed(dec.dtli, 3) : '—', dec.drmsea != null ? signed(dec.drmsea, 3) : '—',
      `<span style="${colour};font-weight:600">${dec.text}</span>`];
    rows += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  }
  const across = longitudinal ? 'across two time points' : `across ${models[0]?.parsed.nGroups ?? 2} groups`;
  const dchiNote = wlsmv
    ? `Δχ² = WLSMV difference test (Mplus DIFFTEST) against the preceding model; WLSMV χ² values cannot be differenced directly.${missingDiff ? ' Missing Δχ² values: run the generated models in order, in one folder, so each step finds the previous step’s DIFFTEST file.' : ''}`
    : 'Δχ²(s) = Satorra–Bentler scaled difference.';
  const note = `<p class="apa-note"><i>Note.</i> N = ${models[0]?.parsed.nObs ?? '—'} ${across}. Models are ordered from least to most constrained; each Δ compares with the preceding model. Invariance is supported when ΔCFI ≥ −.010, ΔTLI ≥ −.010, and ΔRMSEA ≤ .015 (Chen, 2007). ${dchiNote}${unestimatedNote(series, { html: true })} * <i>p</i> &lt; .05.</p>`;
  return `<table class="apa-table"><caption><b>Table.</b> ${caption}</caption><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>${note}`;
}

/** Plain-text invariance paragraph shared by the manuscript (renderInvarianceProse) and the Word/.docx export. */
export function invarianceProseText(models, { longitudinal = false } = {}) {
  const series = invarianceSeries(models);
  const est = series.filter((r) => r.estimated);
  const skipped = series.filter((r) => !r.estimated);
  const over = longitudinal ? 'across the two time points' : 'across groups';
  const skippedSentence = skipped.length
    ? ` The ${joinList(skipped.map((r) => r.m.label.toLowerCase()))} model${skipped.length > 1 ? 's' : ''} could not be estimated (${joinList([...new Set(skipped.map((r) => r.reason))])}) and ${skipped.length > 1 ? 'were' : 'was'} left out of the comparisons.`
    : '';
  if (est.length < 2) return skippedSentence.trim();
  const supported = [], failedAt = [];
  est.forEach((r, i) => { if (i === 0) { supported.push(r.m.label); return; } if (r.dec.ok) supported.push(r.m.label); else failedAt.push(r); });
  let s = `${est[0].m.label} invariance provided a baseline against which more constrained models were compared. `;
  if (!failedAt.length) {
    const held = joinList(supported.slice(1).map((x) => x.toLowerCase()));
    s += `All constraints were tenable: ${held} invariance ${supported.length > 2 ? 'were each' : 'was'} supported (ΔCFI ≥ −.010, ΔTLI ≥ −.010, ΔRMSEA ≤ .015), indicating full measurement invariance ${over}.`;
  } else {
    const first = failedAt[0];
    const held = supported.slice(1).map((x) => x.toLowerCase());
    s += held.length ? `${joinList(held)} invariance ${held.length > 1 ? 'were' : 'was'} supported, but ` : '';
    s += `${first.m.label.toLowerCase()} invariance was not supported (${deltaText(first.dec)}), indicating non-invariance at this level. Partial-invariance follow-ups (freeing the most divergent parameters via modification indices) are recommended before comparing ${longitudinal ? 'time points' : 'groups'} further.`;
  }
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

function comparisonSentence(models) {
  const corrMean = (p) => { const v = p.factorCorr.map((c) => Math.abs(c.est)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const a = models[0].parsed, b = models[models.length - 1].parsed;
  const ra = corrMean(a), rb = corrMean(b);
  if (ra == null || rb == null) return '';
  const dir = rb < ra ? 'lower' : 'higher';
  // bare sentence: renderProse wraps every paragraph itself
  return `Relative to the ${esc(models[0].label)} solution (mean |r| = ${f3(ra)}), factor correlations were ${dir} in the ${esc(models[models.length - 1].label)} solution (mean |r| = ${f3(rb)}), consistent with the expected effect of freely estimating cross-loadings.`;
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function joinList(arr) { if (arr.length <= 1) return arr[0] || ''; if (arr.length === 2) return arr.join(' and '); return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1]; }
