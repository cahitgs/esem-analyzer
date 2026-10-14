// out-parser.js — parse an Mplus .out into a ParsedModel. Pure (no DOM); Node-testable.
//
// Strategy: split into lines and scan on verbatim Mplus section headers.
//  - fit: anchor the EXACT "Chi-Square Test of Model Fit" (skip "...for the Baseline Model"),
//    read forward a few lines; same for RMSEA / CFI/TLI / SRMR / Loglikelihood / IC.
//  - loadings: take the FIRST "STDYX Standardization" block and stop at the next "STD*"
//    header so the STDY/STD copies aren't double-read; track the current sub-block
//    (Fk BY / Fj WITH / Intercepts / Variances / Residual Variances).
//  - R-SQUARE → communality; δ (uniqueness) = STDYX residual variance (= 1 − R²).
//
// Verified against a real ESEM .out (ESEM.dat, Geomin oblique, MLR).

const NUMLIKE = /^(-?\d+(?:\.\d+)?|\*+)$/;

// Labeled fit lines put the value LAST (and labels like "H0"/"AIC" contain digits),
// so always take the final numeric token, e.g. "H0 Value  -32781.176" → -32781.176.
function num(s) {
  if (s == null) return null;
  const ms = String(s).match(/-?\d+(?:\.\d+)?/g);
  return ms ? parseFloat(ms[ms.length - 1]) : null;
}

function findLine(lines, re, from = 0, to = lines.length) {
  for (let i = Math.max(0, from); i < to; i++) if (re.test(lines[i])) return i;
  return -1;
}

/**
 * Tokenize a results data row. Column-count-flexible so it handles:
 *   4 cols  "X1  0.820  0.012  69.976  0.000"  (Est, S.E., Est/S.E., P) — normal
 *   3 cols  "X1  0.479  0.479  0.519"          (StdYX, StdY, Std)       — no-SE standardized
 *   1 col   "X1  1.000"                          (Estimate only)        — no-SE unstandardized
 * The first value column is always the point estimate; S.E./z/p exist only in 4-col blocks.
 */
function dataRow(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 2) return null;
  const name = t[0];
  if (/^[\d.\-]/.test(name)) return null;          // first token must be a label, not a number
  const valsTok = t.slice(1);
  if (!valsTok.every((v) => NUMLIKE.test(v))) return null;
  const toN = (v) => (/^\*+$/.test(v) ? null : parseFloat(v));
  const vals = valsTok.map(toN);
  const four = vals.length >= 4;
  return { name, est: vals[0], se: four ? vals[1] : null, z: four ? vals[2] : null, p: four ? vals[3] : null, ncol: vals.length };
}

/** Parse one standardized/unstandardized parameter region into structured blocks. */
function parseParamRegion(lines, start, end) {
  const out = { loadings: {}, factorCorr: [], residual: {}, intercepts: {}, variances: {}, regressions: [], factorOrder: [], items: [] };
  let block = null; // {kind, factor?}
  const seenItem = new Set();
  for (let i = start; i < end; i++) {
    const L = lines[i];
    if (!L || !L.trim()) continue;
    let m;
    if ((m = L.match(/^\s+(\S+)\s+BY\s*$/))) { block = { kind: 'loading', factor: m[1] }; if (!out.loadings[m[1]]) { out.loadings[m[1]] = {}; out.factorOrder.push(m[1]); } continue; }
    if ((m = L.match(/^\s+(\S+)\s+WITH\s*$/))) { block = { kind: 'with', factor: m[1] }; continue; }
    if ((m = L.match(/^\s+(\S+)\s+ON\s*$/)))   { block = { kind: 'on', factor: m[1] }; continue; }
    const trimmed = L.trim();
    if (/^(Intercepts|Means|Thresholds|Scales)$/.test(trimmed)) { block = { kind: 'intercepts' }; continue; }
    if (/^Variances$/.test(trimmed))           { block = { kind: 'variances' }; continue; }
    if (/^Residual Variances$/.test(trimmed))  { block = { kind: 'residual' }; continue; }

    const row = dataRow(L);
    if (!row || !block) continue;
    switch (block.kind) {
      case 'loading':
        out.loadings[block.factor][row.name] = row;
        if (!seenItem.has(row.name)) { seenItem.add(row.name); out.items.push(row.name); }
        break;
      case 'with':
        out.factorCorr.push({ a: block.factor, b: row.name, ...row });
        break;
      case 'on':
        out.regressions.push({ dv: block.factor, iv: row.name, ...row });
        break;
      case 'residual':   out.residual[row.name] = row.est; break;
      case 'intercepts': out.intercepts[row.name] = row.est; break;
      case 'variances':  out.variances[row.name] = row.est; break;
    }
  }
  return out;
}

export function parseOut(text) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const res = {
    title: null, estimator: null, rotation: null, nObs: null, nFreeParams: null,
    invKind: null, invStep: null, invModel: null, diffTest: null,
    fit: {}, loadings: {}, factorOrder: [], items: [], factorCorr: [],
    residualVariances: {}, intercepts: {}, factorVariances: {}, rSquare: {},
    uniqueness: {}, omega: {}, primaryFactor: {}, regressions: [],
    converged: false, hasError: false, warnings: [],
  };

  res.converged = /THE MODEL ESTIMATION TERMINATED NORMALLY/.test(text);
  res.hasError = /(DID NOT TERMINATE NORMALLY|NO CONVERGENCE|PROBLEM OCCURRED|fatal error)/i.test(text);
  res.seComputed = !/STANDARD ERRORS OF THE MODEL PARAMETER ESTIMATES COULD NOT BE\s+COMPUTED/i.test(text);
  res.chiSquareComputed = !/CHI-SQUARE COULD NOT BE COMPUTED/i.test(text);
  if (!res.seComputed) res.warnings.push('Standard errors could not be computed — the model may not be identified.');
  if (!res.chiSquareComputed) res.warnings.push('Robust χ² and fit indices could not be computed for this model.');
  if (/NOT POSITIVE DEFINITE/i.test(text)) res.warnings.push('A covariance matrix was not positive definite — inspect the solution.');
  // A rotation that fails leaves no fit statistics: Mplus prints the unrotated solution only.
  res.rotationFailed = /NO CONVERGENCE IN ROTATION ALGORITHM|PROBLEM OCCURRED IN THE ROTATION ALGORITHM/i.test(text);
  if (res.rotationFailed) res.warnings.push('The rotation algorithm did not converge — Mplus reports the unrotated solution and no fit statistics.');

  // ---- title ---- (last non-empty line before SUMMARY OF ANALYSIS)
  const summaryIdx = findLine(lines, /^SUMMARY OF ANALYSIS\s*$/);
  if (summaryIdx > 0) {
    for (let i = summaryIdx - 1; i >= 0; i--) { if (lines[i].trim()) { res.title = lines[i].trim(); break; } }
  }
  // Recognize app-generated longitudinal invariance outputs by their TITLE so the Results step can
  // group a dropped set into one sequential comparison table (these models are single-group, so
  // nGroups can't be used). "Longitudinal invariance [(CFA)] - <Step>".
  if (res.title && /^Longitudinal invariance/i.test(res.title)) {
    res.invKind = 'longitudinal';
    res.invModel = /\(bifactor-CFA\)/i.test(res.title) ? 'bcfa' : /\(CFA\)/i.test(res.title) ? 'cfa' : /\(bifactor-ESEM\)/i.test(res.title) ? 'besem' : 'esem';
    // the separator is " - " WITH spaces — "(bifactor-ESEM)" contains a bare hyphen that must not match
    const m = res.title.match(/\s-\s(.+)$/);
    res.invStep = m ? m[1].trim() : null; // e.g. "Metric (loadings)"
  } else if (res.title && /^MG invariance/i.test(res.title)) {
    // App-generated multi-group titles: "MG invariance[ (categorical|CFA|bifactor-CFA|bifactor-ESEM)] - <Step>". The same
    // step capture labels every multi-group row by its step in the Results table and the Word export
    // (nGroups still decides the multi-group grouping; invKind only names the family).
    res.invKind = 'multigroup';
    res.invModel = /\(bifactor-ESEM/i.test(res.title) ? 'besem' : /\(bifactor-CFA/i.test(res.title) ? 'bcfa' : /\(CFA/i.test(res.title) ? 'cfa' : 'esem';
    const m = res.title.match(/\s-\s(.+)$/);
    res.invStep = m ? m[1].trim() : null;
  }
  let mm;
  for (const L of lines.slice(0, summaryIdx > 0 ? summaryIdx + 40 : 60)) {
    if ((mm = L.match(/^Estimator\s+(\S+)/))) res.estimator = mm[1];
    if ((mm = L.match(/^Rotation\s+(?!Algorithm\b)(\S+)/))) res.rotation = mm[1]; // not the "Rotation Algorithm" sub-heading
    if (res.nObs == null && (mm = L.match(/^Number of observations\s+(\d+)/))) res.nObs = parseInt(mm[1], 10);
  }
  // Multi-group lists per-group sizes plus a "Total sample size" line.
  const totalIdx = findLine(lines, /^\s*Total sample size\s+\d+/);
  if (totalIdx >= 0) res.nObs = num(lines[totalIdx]);
  const ngIdx = findLine(lines, /^Number of groups\s+(\d+)/);
  res.nGroups = ngIdx >= 0 ? parseInt(lines[ngIdx].match(/(\d+)\s*$/)?.[1] || '1', 10) : 1;

  // ---- fit ----
  const fitStart = findLine(lines, /^MODEL FIT INFORMATION\s*$/);
  const fit = res.fit;
  if (fitStart >= 0) {
    let i;
    if ((i = findLine(lines, /^Number of Free Parameters\s+\d+/, fitStart)) >= 0) res.nFreeParams = num(lines[i]);

    const li = findLine(lines, /^Loglikelihood\s*$/, fitStart);
    if (li >= 0) for (let j = li + 1; j < li + 10 && j < lines.length; j++) {
      if (/^\s*H0 Value\s/.test(lines[j])) fit.logLik = num(lines[j]);
      if (/^\s*H0 Scaling Correction Factor/.test(lines[j])) fit.logLikScaling = num(lines[j]);
    }
    let k;
    if ((k = findLine(lines, /^\s*Akaike \(AIC\)/, fitStart)) >= 0) fit.aic = num(lines[k]);
    if ((k = findLine(lines, /^\s*Bayesian \(BIC\)/, fitStart)) >= 0) fit.bic = num(lines[k]);
    if ((k = findLine(lines, /^\s*Sample-Size Adjusted BIC/, fitStart)) >= 0) fit.abic = num(lines[k]);

    // Chi-square — EXACT header avoids the Baseline-Model chi-square block
    const ci = findLine(lines, /^Chi-Square Test of Model Fit\s*$/, fitStart);
    if (ci >= 0) for (let j = ci + 1; j < ci + 8 && j < lines.length; j++) {
      const L = lines[j];
      if (/^\s*Value\s/.test(L)) fit.chi2 = num(L.replace('*', ''));
      else if (/^\s*Degrees of Freedom\s/.test(L)) fit.df = num(L);
      else if (/^\s*P-Value\s/.test(L)) fit.p = num(L);
      else if (/^\s*Scaling Correction Factor\s/.test(L)) fit.scalingFactor = num(L);
    }

    // WLSMV/ULSMV Δχ² vs the previous invariance step — printed only when the run carried
    // ANALYSIS: DIFFTEST=<previous step's derivatives file>. This is the ONLY valid Δχ² for
    // these estimators (their χ² values cannot be differenced or Satorra–Bentler-scaled).
    const di = findLine(lines, /^Chi-Square Test for Difference Testing\s*$/, fitStart);
    if (di >= 0) {
      const d = { chi2: null, df: null, p: null };
      for (let j = di + 1; j < di + 8 && j < lines.length; j++) {
        const L = lines[j];
        if (/^\s*Value\s/.test(L)) d.chi2 = num(L.replace('*', ''));
        else if (/^\s*Degrees of Freedom\s/.test(L)) d.df = num(L);
        else if (/^\s*P-Value\s/.test(L)) d.p = num(L);
      }
      if (d.chi2 != null && d.df != null) res.diffTest = d;
    }

    const ri = findLine(lines, /^RMSEA \(Root Mean Square/, fitStart);
    if (ri >= 0) for (let j = ri + 1; j < ri + 6 && j < lines.length; j++) {
      const L = lines[j];
      if (/^\s*Estimate\s/.test(L)) fit.rmsea = num(L);
      else if (/^\s*90 Percent C\.I\./.test(L)) { const ms = L.match(/(-?\d+\.\d+)\s+(-?\d+\.\d+)/); if (ms) { fit.rmseaLo = parseFloat(ms[1]); fit.rmseaHi = parseFloat(ms[2]); } }
      else if (/Probability RMSEA/.test(L)) fit.rmseaPClose = num(L);
    }

    const ti = findLine(lines, /^CFI\/TLI\s*$/, fitStart);
    if (ti >= 0) for (let j = ti + 1; j < ti + 5 && j < lines.length; j++) {
      if (/^\s*CFI\s/.test(lines[j])) fit.cfi = num(lines[j]);
      else if (/^\s*TLI\s/.test(lines[j])) fit.tli = num(lines[j]);
    }

    const si = findLine(lines, /^SRMR \(Standardized Root Mean/, fitStart);
    if (si >= 0) for (let j = si + 1; j < si + 4 && j < lines.length; j++) if (/^\s*Value\s/.test(lines[j])) { fit.srmr = num(lines[j]); break; }

    const wi = findLine(lines, /^WRMR \(Weighted Root Mean/, fitStart);
    if (wi >= 0) for (let j = wi + 1; j < wi + 4 && j < lines.length; j++) if (/^\s*Value\s/.test(lines[j])) { fit.wrmr = num(lines[j]); break; }
  }

  // ---- standardized (STDYX) parameter block ----
  const stdyxIdx = findLine(lines, /^STDYX Standardization\s*$/);
  if (stdyxIdx >= 0) {
    let end = findLine(lines, /^STDY Standardization\s*$/, stdyxIdx + 1);
    if (end < 0) end = findLine(lines, /^STD Standardization\s*$/, stdyxIdx + 1);
    if (end < 0) end = findLine(lines, /^R-SQUARE\s*$/, stdyxIdx + 1);
    if (end < 0) end = lines.length;
    const blk = parseParamRegion(lines, stdyxIdx + 1, end);
    res.loadings = blk.loadings;
    res.factorOrder = blk.factorOrder;
    res.items = blk.items;
    res.factorCorr = blk.factorCorr;
    res.residualVariances = blk.residual;
    res.intercepts = blk.intercepts;
    res.factorVariances = blk.variances;
    res.regressions = blk.regressions;
  } else if (findLine(lines, /^STANDARDIZED MODEL RESULTS\s*$/) >= 0) {
    // No-SE degraded form: a single "STANDARDIZED MODEL RESULTS" block with
    // StdYX/StdY/Std estimate columns and no "STDYX Standardization" sub-header.
    const sIdx = findLine(lines, /^STANDARDIZED MODEL RESULTS\s*$/);
    let end = findLine(lines, /^(R-SQUARE|QUALITY OF NUMERICAL|MODEL MODIFICATION|TECHNICAL|CONFIDENCE INTERVALS|RESIDUAL OUTPUT)/, sIdx + 1);
    if (end < 0) end = lines.length;
    const blk = parseParamRegion(lines, sIdx + 1, end);
    res.loadings = blk.loadings; res.factorOrder = blk.factorOrder; res.items = blk.items;
    res.factorCorr = blk.factorCorr; res.residualVariances = blk.residual;
    res.intercepts = blk.intercepts; res.factorVariances = blk.variances; res.regressions = blk.regressions;
    res.warnings.push('Standardized estimates shown without standard errors.');
  } else {
    // Fall back to unstandardized MODEL RESULTS if no standardized output requested.
    const mrIdx = findLine(lines, /^MODEL RESULTS\s*$/);
    if (mrIdx >= 0) {
      const end = findLine(lines, /^(STANDARDIZED MODEL RESULTS|R-SQUARE|QUALITY OF NUMERICAL)/, mrIdx + 1);
      const blk = parseParamRegion(lines, mrIdx + 1, end < 0 ? lines.length : end);
      res.loadings = blk.loadings; res.factorOrder = blk.factorOrder; res.items = blk.items;
      res.factorCorr = blk.factorCorr; res.residualVariances = blk.residual;
      res.intercepts = blk.intercepts; res.factorVariances = blk.variances; res.regressions = blk.regressions;
      res.warnings.push('No STANDARDIZED output found; loadings shown are unstandardized.');
    }
  }

  // ---- R-SQUARE → communality; δ = STDYX residual variance ----
  const rsIdx = findLine(lines, /^R-SQUARE\s*$/);
  if (rsIdx >= 0) {
    const end = findLine(lines, /^(QUALITY OF NUMERICAL|CONFIDENCE INTERVALS|MODEL MODIFICATION|TECHNICAL|RESIDUAL OUTPUT|DIAGRAM)/, rsIdx + 1);
    for (let i = rsIdx + 1; i < (end < 0 ? lines.length : end); i++) {
      const row = dataRow(lines[i]);
      if (row && res.items.includes(row.name)) res.rSquare[row.name] = row.est;
    }
  }
  for (const it of res.items) {
    res.uniqueness[it] = res.residualVariances[it] != null ? res.residualVariances[it]
      : (res.rSquare[it] != null ? 1 - res.rSquare[it] : null);
  }

  // ---- a-priori target pattern from the echoed INPUT (Morin's subscale blocks) ----
  // The .out echoes the input; the MODEL section's BY statements carry the intended pattern
  // (mains = items without "~0"). Dominant-loading assignment misplaces items whose specific
  // loading collapses (e.g. Morin Table 2: Z1's S-loading is .081 while a cross is .166), so
  // block membership and ω must follow the a-priori pattern whenever it is recoverable.
  // A Geomin range statement ("F1-F3 BY <all items>") is uninformative → dominant fallback.
  res.targetPattern = extractTargetPattern(lines, res);

  // ---- primary factor per item (a-priori pattern, else dominant loading) ----
  const patternPick = (it, cands) => {
    if (!res.targetPattern) return null;
    const hit = cands.filter((f) => res.targetPattern[f]?.has(it));
    hit.sort((a, b) => res.targetPattern[a].size - res.targetPattern[b].size); // most specific first (G lists all items)
    return hit[0] || null;
  };
  for (const it of res.items) {
    const pat = patternPick(it, res.factorOrder);
    if (pat) { res.primaryFactor[it] = pat; continue; }
    let best = null, bestF = null;
    for (const f of res.factorOrder) { const v = res.loadings[f]?.[it]?.est; if (v != null && (best == null || Math.abs(v) > Math.abs(best))) { best = v; bestF = f; } }
    res.primaryFactor[it] = bestF;
  }

  // ---- detect a bifactor general factor (the ONE rule, shared with ewc.js — see detectGeneralFactor) ----
  res.generalFactor = detectGeneralFactor({
    factors: res.factorOrder, items: res.items,
    loading: (f, it) => res.loadings[f]?.[it]?.est ?? null,
    corr: res.factorCorr.map((c) => c.est),
  });
  res.isBifactor = !!res.generalFactor;

  // ---- composite reliability (McDonald's ω) ----
  const omegaOver = (items, f) => {
    let sumL = 0, sumD = 0;
    for (const it of items) { const l = res.loadings[f]?.[it]?.est; const d = res.uniqueness[it]; if (l == null || d == null) return null; sumL += l; sumD += d; }
    return items.length ? (sumL * sumL) / (sumL * sumL + sumD) : null;
  };
  res.specificFactor = {};
  if (res.generalFactor) {
    const g = res.generalFactor, specifics = res.factorOrder.filter((f) => f !== g);
    res.omega[g] = omegaOver(res.items, g);                       // ω over all items for the general factor
    for (const it of res.items) {                                 // a-priori subscale if recoverable, else dominant
      const pat = patternPick(it, specifics);
      if (pat) { res.specificFactor[it] = pat; continue; }
      let best = null, bf = null;
      for (const f of specifics) { const v = res.loadings[f]?.[it]?.est; if (v != null && (best == null || Math.abs(v) > Math.abs(best))) { best = v; bf = f; } }
      res.specificFactor[it] = bf;
    }
    for (const f of specifics) res.omega[f] = omegaOver(res.items.filter((it) => res.specificFactor[it] === f), f);
  } else {
    for (const f of res.factorOrder) res.omega[f] = omegaOver(res.items.filter((it) => res.primaryFactor[it] === f), f);
  }

  return res;
}

/** Recover the a-priori target pattern (factor → Set of MAIN items) from the echoed input.
 *  Reads the first MODEL: block inside INPUT INSTRUCTIONS; a BY statement's mains are the items
 *  listed without "~0" (flags/labels in parentheses and * / @value suffixes are stripped).
 *  Handles factor lists and numeric ranges before BY ("G F1-F3 BY ..."). Returns null when no
 *  informative pattern exists — e.g. a Geomin range statement listing every item as a main for
 *  every factor. Names are uppercased to match the STDYX sections. */
function extractTargetPattern(lines, res) {
  const start = lines.findIndex((l) => /^\s*INPUT INSTRUCTIONS\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^\s*(INPUT READING TERMINATED|\*\*\* WARNING|\*\*\* ERROR)/.test(l));
  if (end < 0) end = Math.min(lines.length, start + 600);
  const block = lines.slice(start + 1, end);
  const mi = block.findIndex((l) => /^\s*MODEL:?\s*$/i.test(l));
  if (mi < 0) return null;
  let stop = block.findIndex((l, i) => i > mi && /^\s*(MODEL\s+[\w]+:|OUTPUT:|SAVEDATA:|MODEL\s+CONSTRAINT:|PLOT:|DEFINE:)/i.test(l));
  if (stop < 0) stop = block.length;
  const model = block.slice(mi + 1, stop).join(' ');
  const itemSet = new Set(res.items);
  const pattern = {};
  for (const st of model.split(';')) {
    const m = st.match(/^\s*([A-Za-z_][\w\s-]*?)\s+BY\s+(.+)$/i);
    if (!m) continue;
    // expand the factor list (ids and numeric ranges) before BY
    const fids = [];
    for (const tok of m[1].trim().split(/\s+/)) {
      const r = tok.match(/^([A-Za-z_]\w*?)(\d+)\s*-\s*([A-Za-z_]\w*?)(\d+)$/);
      if (r && r[1].toUpperCase() === r[3].toUpperCase()) {
        for (let k = Number(r[2]); k <= Number(r[4]); k++) fids.push(`${r[1].toUpperCase()}${k}`);
      } else if (/^[A-Za-z_]\w*$/.test(tok)) fids.push(tok.toUpperCase());
    }
    if (!fids.length || !fids.every((f) => res.factorOrder.includes(f))) continue;
    // mains: items without ~0 (strip parenthesized flags first, then * / @value suffixes)
    const rhs = m[2].replace(/\([^)]*\)/g, ' ');
    for (const tok of rhs.trim().split(/\s+/)) {
      if (/~0$/.test(tok)) continue;
      const nm = tok.match(/^([A-Za-z_]\w*)/);
      if (!nm) continue;
      const item = nm[1].toUpperCase();
      if (!itemSet.has(item)) continue;
      for (const f of fids) { (pattern[f] = pattern[f] || new Set()).add(item); }
    }
  }
  const covered = Object.keys(pattern);
  if (covered.length < 2) return null;
  // uninformative when every covered factor lists every item as a main (Geomin range statement)
  if (covered.every((f) => pattern[f].size === res.items.length)) return null;
  return pattern;
}

/** Convenience for tests / debugging. */
export function summarizeFit(p) {
  const f = p.fit;
  return `chi2=${f.chi2} df=${f.df} p=${f.p} CFI=${f.cfi} TLI=${f.tli} RMSEA=${f.rmsea}[${f.rmseaLo},${f.rmseaHi}] SRMR=${f.srmr} N=${p.nObs}`;
}

/** The ONE bifactor rule — used by parseOut (standardized estimates) and by ewc.js on the SVALUES block
 *  (unstandardized start values), so the Results table and the ESEM-within-CFA card never disagree.
 *  A true bifactor model has one factor loading on ALL items while the others load on subsets, and
 *  orthogonal factors. A factor NAMED G/GF with an estimate on every item is the general factor even
 *  when some of its loadings are small — bifactor solutions legitimately have G-λ < .2 (Morin's
 *  published Table 2 has .116; his Data-1 bifactor-ESEM has .12–.19) — so the ≥ .2 magnitude rule is
 *  kept only for factors with other names. `loading(f, item)` → number | null; `corr` → the factor
 *  correlation estimates (empty = orthogonal). Returns the general factor's name, or null. */
export function detectGeneralFactor({ factors, items, loading, corr = [] }) {
  if (!factors || factors.length < 2 || !items || items.length < 4) return null;
  const hasAll = (f) => items.every((it) => loading(f, it) != null);
  const loadsAll = (f) => items.every((it) => { const v = loading(f, it); return v != null && Math.abs(v) >= 0.2; });
  const orthogonal = corr.length === 0 || corr.every((c) => c != null && Math.abs(c) < 0.05);
  let g = factors.find((f) => /^GF?$/i.test(f) && hasAll(f));
  if (!g) g = factors.find((f) => f === 'G' && loadsAll(f));
  if (!g && orthogonal) g = factors.find((f) => loadsAll(f)) || null;
  if (!g) return null;
  const others = factors.filter((f) => f !== g);
  return others.length && others.every((f) => !loadsAll(f)) ? g : null;
}
