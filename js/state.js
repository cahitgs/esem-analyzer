// state.js — the ModelSpec (single source of truth) + helpers + validation.
// Mplus factor names are always F1..Fk (valid identifiers, contiguous so the
// "F1-Fk BY ..." range syntax holds). The user's factor labels are cosmetic
// (used only in APA output), never in the generated syntax.

// Morin's recommended OUTPUT request (Hoyle Handbook ch. 27, technical supplement T3) — the ONE default
// for every generated model: measurement models, invariance chains and ESEM-within-CFA alike. SVALUES
// is part of it, so any rotated solution can later be frozen into an ESEM-within-CFA model.
export const DEFAULT_OUTPUT_LINE = 'SAMPSTAT STANDARDIZED MODINDICES CINTERVAL RESIDUAL SVALUES TECH1 TECH3 TECH4';

export function createModelSpec(data) {
  const items = (data?.varNames || []).filter((v) => !looksLikeId(data, v)).slice(0, 6); // sensible default selection (ID-like columns skipped)
  const spec = {
    data: data || { fileName: null, delimiter: 'whitespace', hasHeader: false, nCols: 0, nRows: 0, varNames: [], categorical: [], missingCode: null },
    items,
    factors: [],            // [{ id:'F1', label:'F1' }]
    target: {},             // target[item][factorId] = true(main) | false(cross→~0)
    rotation: { type: 'GEOMIN', oblique: true, epsilon: 0.5 },
    estimator: 'MLR',
    modelTypes: { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: false },
    bifactor: { gLabel: 'G' },
    groups: { enabled: false, variable: null, codes: [], invariance: { sequence: ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'] } },
    // Longitudinal (within-person, 2-wave) invariance: single group, two ESEM/CFA blocks sharing one
    // factor pattern. waves[0]=Time 1 columns drive the Λ grid (= spec.items); waves[1]=Time 2 columns
    // are positionally matched (waves[1][k] is the same indicator as waves[0][k], measured again).
    longitudinal: {
      enabled: false,
      waveLabels: ['Time 1', 'Time 2'],
      waves: [[], []],
      correlatedUniqueness: true, // emit "T1items PWITH T2items" (same indicator's residual across waves)
      invariance: { sequence: ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'] },
    },
    output: { line: DEFAULT_OUTPUT_LINE },
    // Convergence aids (Morin, Hoyle Handbook ch. 27): loosened convergence criterion (his T32
    // remedy) + per-item residual-variance positivity constraints (his footnote-5 Heywood remedy).
    aids: { convergence: false, convergenceValue: 0.005, positiveResiduals: [] },
  };
  setFactorCount(spec, 2);
  return spec;
}

export function factorIds(spec) { return spec.factors.map((f) => f.id); }

/** True when a column looks like a case identifier: unique consecutive integers over the rows (1…N or alike).
 *  Such a column must never be an indicator — it has no common variance and its group means differ wildly,
 *  so the scalar invariance step cannot even converge. Without data, the column name decides. */
export function looksLikeId(data, name) {
  const m = data?._matrix;
  const idx = (data?.varNames || []).indexOf(name);
  if (!m?.length || idx < 0) return /^(id|no|sira|sıra|kimlik|case|subject|participant|resp(ondent)?)$/i.test(name || '');
  const seen = new Set();
  let min = Infinity, max = -Infinity, n = 0;
  for (const row of m) {
    const v = row[idx];
    if (v == null || v === '' || v === '*') continue;
    const x = Number(String(v).replace(',', '.'));
    if (Number.isNaN(x) || !Number.isInteger(x) || seen.has(x)) return false;
    seen.add(x); n++;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return n >= 20 && max - min + 1 === n;
}

/** Resize factors to k, preserving existing labels, and (re)seed the target matrix block-diagonally. */
export function setFactorCount(spec, k) {
  k = Math.max(1, Math.min(k, Math.max(1, spec.items.length - 1)));
  const old = spec.factors;
  spec.factors = Array.from({ length: k }, (_, i) => old[i] || { id: `F${i + 1}`, label: `F${i + 1}` });
  spec.factors.forEach((f, i) => { f.id = `F${i + 1}`; });
  seedTargetIfEmpty(spec);
  // drop target entries for factors that no longer exist
  const ids = new Set(factorIds(spec));
  for (const it of spec.items) {
    spec.target[it] = spec.target[it] || {};
    for (const fid of Object.keys(spec.target[it])) if (!ids.has(fid)) delete spec.target[it][fid];
    for (const fid of ids) if (!(fid in spec.target[it])) spec.target[it][fid] = false;
  }
  return spec;
}

/** Block-diagonal seed: split items evenly across factors as their main loadings. */
function seedTargetIfEmpty(spec) {
  const anyMain = spec.items.some((it) => spec.target[it] && Object.values(spec.target[it]).some(Boolean));
  if (anyMain) return;
  const ids = factorIds(spec);
  const per = Math.ceil(spec.items.length / ids.length);
  spec.items.forEach((it, idx) => {
    spec.target[it] = {};
    const fIdx = Math.min(ids.length - 1, Math.floor(idx / per));
    ids.forEach((fid, j) => { spec.target[it][fid] = j === fIdx; });
  });
}

export function setItems(spec, items) {
  spec.items = items.slice();
  // prune & extend target rows
  for (const it of items) if (!spec.target[it]) spec.target[it] = {};
  for (const it of Object.keys(spec.target)) if (!items.includes(it)) delete spec.target[it];
  // if the new selection invalidated factor count, clamp
  setFactorCount(spec, Math.min(spec.factors.length, Math.max(1, items.length - 1)));
  // re-seed cleanly when the item set changed substantially
  if (!items.some((it) => Object.values(spec.target[it]).some(Boolean))) { spec.target = {}; items.forEach((it)=>spec.target[it]={}); seedTargetIfEmpty(spec); }
  return spec;
}

/** Assign a wave's indicator columns. Wave 0 (Time 1) drives the shared Λ pattern / factors / target. */
export function setWaveItems(spec, waveIdx, cols) {
  spec.longitudinal.waves[waveIdx] = cols.slice();
  if (waveIdx === 0) setItems(spec, cols.slice()); // T1 columns ARE the shared item set / Λ grid
  return spec;
}

/** The Time-2 indicator positionally matching a Time-1 item (used by the CFA longitudinal builder). */
export function waveCounterpart(spec, t1item) {
  const i = spec.longitudinal.waves[0].indexOf(t1item);
  return i < 0 ? null : spec.longitudinal.waves[1][i];
}

export function toggleTarget(spec, item, factorId) {
  spec.target[item] = spec.target[item] || {};
  spec.target[item][factorId] = !spec.target[item][factorId];
  return spec;
}

export function mainItemsForFactor(spec, factorId) {
  return spec.items.filter((it) => spec.target[it]?.[factorId]);
}

/** Thresholds per item: categories − 1, counted from the parsed data matrix (distinct non-missing
 *  values — exactly what Mplus will see). `spec.data.nCats` overrides; 5-point Likert fallback. */
export function thresholdCounts(spec) {
  const counts = {};
  const idxOf = {};
  (spec.data.varNames || []).forEach((v, i) => { idxOf[v] = i; });
  const miss = spec.data.missingCode != null && spec.data.missingCode !== '' ? Number(spec.data.missingCode) : null;
  for (const it of spec.items) {
    const explicit = spec.data.nCats?.[it];
    if (explicit >= 2) { counts[it] = explicit - 1; continue; }
    const idx = idxOf[it];
    const m = spec.data._matrix;
    if (idx != null && m?.length) {
      const seen = new Set();
      for (const row of m) {
        const v = row[idx];
        if (v == null || v === '' || v === '*') continue;
        const n = Number(String(v).replace(',', '.'));
        if (Number.isNaN(n) || (miss != null && n === miss)) continue;
        seen.add(n);
      }
      counts[it] = Math.max(1, seen.size - 1);
    } else counts[it] = 4;
  }
  return counts;
}

/** Morin's thresholds identification for the categorical multi-group chains (Hoyle ch. 27, T15/T42): one
 *  referent item per factor — plus one for the general factor of the bifactor chain — whose SECOND
 *  threshold is equated across groups from configural on; that is what identifies the latent means in the
 *  non-reference groups. A referent therefore needs at least three response categories (two thresholds):
 *  binary items can never be referents. Referents are distinct items — a specific factor takes its first
 *  eligible main item that is not taken yet, the G factor the first eligible item that is no S referent
 *  (Morin's X2). Returns { refs: Set<item>, byFactor: { F#: item | null }, gRef, missing: ['F2', 'G', …] },
 *  `missing` naming the factors for which no eligible referent exists. */
export function thresholdReferents(spec, counts, { general = false } = {}) {
  const taken = new Set(), byFactor = {}, missing = [];
  const eligible = (it) => (counts[it] || 0) >= 2 && !taken.has(it);
  for (const f of spec.factors) {
    const pick = mainItemsForFactor(spec, f.id).find(eligible) || null;
    byFactor[f.id] = pick;
    if (pick) taken.add(pick); else missing.push(f.id);
  }
  let gRef = null;
  if (general) {
    gRef = spec.items.find(eligible) || null;
    if (gRef) taken.add(gRef); else missing.push('G');
  }
  return { refs: taken, byFactor, gRef, missing };
}

/** Validate identification & sanity. Returns { errors:[], warnings:[] }. */
export function validateSpec(spec) {
  const errors = [], warnings = [];
  const m = spec.factors.length, n = spec.items.length;
  if (n < 3) errors.push(`Select at least 3 items (you have ${n}).`);
  if (m < 1) errors.push('Define at least one factor.');
  if (m >= n) errors.push(`Too many factors: ${m} factors for ${n} items is not identified.`);

  for (const f of spec.factors) {
    const mains = mainItemsForFactor(spec, f.id).length;
    if (mains === 0) errors.push(`${f.label} has no target (main) loadings — mark at least one cell.`);
    else if (mains < 2) warnings.push(`${f.label} has only ${mains} target item; factors are usually defined by ≥ 3.`);
  }

  if (spec.rotation.type === 'TARGET') {
    // oblique target rotation needs ≥ m(m−1) targeted zeros for rotational identification
    const needed = spec.rotation.oblique ? m * (m - 1) : (m * (m - 1)) / 2;
    let zeros = 0;
    for (const it of spec.items) for (const f of spec.factors) if (spec.target[it]?.[f.id] === false) zeros++;
    if (zeros < needed) warnings.push(`Target rotation usually needs ≥ ${needed} fixed (~0) cross-loadings for ${m} factors; you have ${zeros}.`);
  }

  for (const it of spec.items) if (looksLikeId(spec.data, it)) warnings.push(`${it} looks like a case identifier (unique consecutive integers) — remove it from the items. As an indicator it has no common variance, and the scalar invariance step will not converge.`);

  if (spec.estimator === 'WLSMV' && spec.data.categorical.length === 0) warnings.push('WLSMV is selected but no items are flagged categorical.');

  if (spec.groups.enabled) {
    if (!spec.groups.variable) errors.push('Choose a grouping variable for invariance testing.');
    else if (spec.items.includes(spec.groups.variable)) errors.push(`${spec.groups.variable} is both an item and the grouping variable — remove it from the items.`);
    if ((spec.groups.codes?.length || 0) < 2) errors.push('The grouping variable needs at least two groups.');
    if ((spec.groups.invariance.sequence?.length || 0) === 0) errors.push('Select at least one invariance step (start with Configural).');
    const catItems = spec.items.filter((it) => spec.data.categorical.includes(it));
    if (catItems.length && catItems.length < spec.items.length) {
      warnings.push(`Only ${catItems.length} of ${spec.items.length} items are flagged categorical — the invariance sequence assumes one scale type. Flag all items categorical for the thresholds-based WLSMV chain, or none for the intercepts-based chain.`);
    } else if (catItems.length === spec.items.length && spec.items.length > 0) {
      warnings.push('Categorical invariance: Δχ² comes from Mplus DIFFTEST — run the generated models in order, in the same folder, so each step finds the previous step\'s Inv_diff_*.dat (and BifactorInv_diff_*.dat) file.');
      // Morin's thresholds identification needs one referent item with ≥ 3 categories per factor (and one
      // more for the G factor of the bifactor chain); without it the configural/metric models are not identified.
      const { missing } = thresholdReferents(spec, thresholdCounts(spec), { general: !!spec.modelTypes.bifactorEsem });
      if (missing.length) {
        const names = missing.map((id) => (id === 'G' ? 'the general factor' : (spec.factors.find((f) => f.id === id)?.label || id)));
        errors.push(`Categorical invariance needs, for each factor${spec.modelTypes.bifactorEsem ? ' and for the general factor' : ''}, one referent item with at least three response categories — its second threshold is equated across groups to identify the latent means (Morin's rule). None is available for ${names.join(', ')}. Add such an item${missing.includes('G') ? ' that is not already a specific factor\'s referent (or uncheck bifactor-ESEM)' : ''}, or treat the items as continuous.`);
      }
    }
    if (spec.modelTypes.bifactorCfa) warnings.push('Bifactor-CFA is not generated across groups — multi-group sequences cover first-order ESEM and (when checked) bifactor-ESEM.');
  }

  if (spec.aids?.positiveResiduals?.length && (spec.groups.enabled || spec.longitudinal?.enabled)) {
    warnings.push('Residual-variance constraints (res > 0) apply to single-group measurement models only — invariance sequences are generated without them.');
  }
  if (spec.aids?.positiveResiduals?.some((it) => spec.data.categorical.includes(it))) {
    warnings.push('Residual-variance constraints are skipped for categorical items — their residual variance is not a free parameter under the default (DELTA) parameterization.');
  }

  if (spec.longitudinal?.enabled) {
    const [w1, w2] = spec.longitudinal.waves;
    if (spec.groups.enabled) errors.push('Run either multi-group or longitudinal invariance, not both at once.');
    if ((w1?.length || 0) < 2 || (w2?.length || 0) < 2) errors.push('Assign at least two indicators to each time point.');
    else if (w1.length !== w2.length) errors.push(`Each wave needs the same number of indicators (Time 1 has ${w1.length}, Time 2 has ${w2.length}).`);
    const overlap = (w1 || []).filter((x) => (w2 || []).includes(x));
    if (overlap.length) errors.push(`Time 1 and Time 2 must use different columns (shared: ${overlap.join(', ')}).`);
    // The longitudinal builders are the intercept/uniqueness chain for continuous indicators; categorical
    // items would need thresholds + THETA (Morin's T42–T59 chain), which is not generated — refuse rather
    // than emit syntax Mplus rejects.
    const catLong = [...(w1 || []), ...(w2 || [])].filter((v) => spec.data.categorical.includes(v));
    if (catLong.length) errors.push(`Longitudinal invariance is generated for continuous indicators only; ${catLong.length} selected column${catLong.length > 1 ? 's are' : ' is'} flagged categorical (${catLong.slice(0, 4).join(', ')}${catLong.length > 4 ? ', …' : ''}). Unflag them on the Data step, or test invariance across groups, where the thresholds-based WLSMV chain is available.`);
    if ((spec.longitudinal.invariance.sequence?.length || 0) === 0) errors.push('Select at least one invariance step (start with Configural).');
    if (spec.modelTypes.bifactorCfa) warnings.push('Bifactor-CFA is not generated across time — longitudinal sequences cover CFA, ESEM, and bifactor-ESEM.');
    // (factor-count and ≥2-target-per-factor checks above already apply: spec.items === Time-1 columns.)
  }
  return { errors, warnings };
}
