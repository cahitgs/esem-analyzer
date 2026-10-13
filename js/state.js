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

// ---- Time-1 / Time-2 column pairing ----
// A wave pair differs in ONE token: x1_t1 → x1_t2 ("1→2" at the end), w1x1 → w2x1 ("1→2" after one character),
// X1 → Y1 ("X→Y"), A_pre → A_post ("pre→post"), x1 → x1_2 (an inserted "_2"). The token is ANCHORED (start offset
// and end offset), so the same text at another position — duy1_t1 → duy2_t1, the item number — is a different key.
// Candidates are the keys that map every Time-1 name to its own free column, minus the keys on the axis along which
// the Time-1 names differ among themselves (the item numbers of one scale, the scale names of a one-item-per-scale
// selection — never the wave axis). A STRONG key — a known wave word (pre→post, ön→son, bl→fu1), a number stepping
// n→n+1 behind a wave marker (t1→t2, W1_→W2_), a marker, number or wave word inserted into a bare name (x1 → x1_t2,
// x1 → x1_2, x1 → x1_post) — beats every weak one (a bare number, the next letter, an unknown word): the most
// wave-like first, then the token closest to the end. Among weak keys only, the token closest to the end of the
// name wins first (the wave is written last), then the more wave-like token, then the key pairing more columns of
// the file (an item number pairs a handful, a wave token nearly every item). Two different answers left tied →
// nothing is guessed and the layout fallback takes over.
const classOf = (ch) => (ch == null ? null : /\d/.test(ch) ? 'd' : /\p{L}/u.test(ch) ? 'l' : 'o');
const isUpper = (ch) => ch != null && /\p{Lu}/u.test(ch);
const isLower = (ch) => ch != null && /\p{Ll}/u.test(ch);
// token boundary between two adjacent characters: a class change, or a camelCase step (preSE → pre | SE)
const boundary = (x, y) => x == null || y == null || classOf(x) !== classOf(y) || (isLower(x) && isUpper(y));
const uniform = (m) => m.length > 0 && [...m].every((ch) => classOf(ch) === classOf(m[0]));
const KEY_SEP = '\u0001';
// wave words by stage (first → second → third measurement); a pair of known words ranks by its stages
const WAVE_STAGES = [
  ['pre', 'baseline', 'base', 'bl', 'before', 'first', 'initial', 'start', 'ön', 'on', 'önce', 'once', 'ilk'],
  ['mid', 'middle', 'post', 'after', 'second', 'son', 'sonra', 'ikinci'],
  ['fu', 'fup', 'follow', 'followup', 'later', 'delayed', 'retention', 'izlem', 'third', 'final', 'end', 'üçüncü', 'ucuncu'],
];
const WAVE_STAGE = new Map(WAVE_STAGES.flatMap((ws, i) => ws.map((w, j) => [w, i + j / 100])));
// letters that mark a wave number (t1, W1_, time1, wave1, fu1); an item or scale number has none of them before it
const WAVE_MARKERS = new Set(['t', 'w', 'tp', 'wv', 'time', 'wave', 'occ', 'visit', 'round', 'phase', 'zaman', 'dalga', 'olcum', 'ölçüm', 'fu', 'fup', 'followup', 'yr', 'year', 'mo', 'month', 'wk', 'week', 'day', 'session', 'ses']);
/** { stage, n } for a known wave word with an optional number (post, fu1), else null. */
const wordInfo = (tok) => { const m = (tok || '').toLowerCase().match(/^(\p{L}+)(\d*)$/u); return m && WAVE_STAGE.has(m[1]) ? { stage: WAVE_STAGE.get(m[1]), n: m[2] ? Number(m[2]) : 0 } : null; };
/** Two glued letter runs that differ only in a leading or trailing wave word (predep → postdep, deppre → deppost):
 *  where the word sits and its length in `ma`, else null. */
function splitWaveWords(ma, mb) {
  const la = ma.toLowerCase(), lb = mb.toLowerCase();
  const words = [...WAVE_STAGE.keys()];
  for (const at of ['start', 'end']) {
    const cut = (str, w) => (at === 'start' ? str.slice(w.length) : str.slice(0, str.length - w.length));
    for (const x of words.filter((w) => (at === 'start' ? la.startsWith(w) : la.endsWith(w)))) {
      for (const y of words.filter((w) => (at === 'start' ? lb.startsWith(w) : lb.endsWith(w)))) {
        if (x !== y && cut(la, x) && cut(la, x) === cut(lb, y)) return { at, len: x.length };
      }
    }
  }
  return null;
}

/** The one-token difference between two names: { ma, mb, keys } (keys anchored at the start, S<p>, and at the
 *  end, E<s>), or null when the names differ in more than one place or the difference cuts through a digit/letter
 *  run (V10 → V20 is "10→20", never "1→2"). An inserted part is slid onto token boundaries (trust1 → t2_trust1 is
 *  "t2_" at the start, not "2_t" after the t) or widened into a substitution (x1_on → x1_son is "on→son"); a glued
 *  wave word is split off (predep1 → postdep1 is "pre→post"). */
export function nameSubstitution(a, b) {
  if (a === b || !a || !b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const mid = () => [a.slice(p, a.length - s), b.slice(p, b.length - s)];
  let [ma, mb] = mid();
  if (!ma || !mb) {
    const long = ma ? a : b;
    const fits = (q, m) => boundary(long[q - 1], m[0]) && boundary(m[m.length - 1], long[q + m.length]);
    let q = p, m = ma || mb;
    if (!fits(q, m)) {
      let ql = q, ml = m;
      while (ql > 0 && ml[ml.length - 1] === long[ql - 1] && !fits(ql, ml)) { ql--; ml = long[ql] + ml.slice(0, -1); }
      let qr = q, mr = m;
      while (qr + mr.length < long.length && mr[0] === long[qr + mr.length] && !fits(qr, mr)) { mr = mr.slice(1) + long[qr + mr.length]; qr++; }
      if (fits(ql, ml)) [q, m] = [ql, ml]; else if (fits(qr, mr)) [q, m] = [qr, mr];
    }
    if (fits(q, m)) { p = q; s = long.length - q - m.length; [ma, mb] = ma ? [m, ''] : ['', m]; }
    else {
      // no slide puts the inserted part on token boundaries: widen the difference into a substitution on both sides
      while (s > 0 && ((a.length - s - 1 >= p && !boundary(a[a.length - s - 1], a[a.length - s])) || (b.length - s - 1 >= p && !boundary(b[b.length - s - 1], b[b.length - s])))) s--;
      while (p > 0 && ((p < a.length - s && !boundary(a[p - 1], a[p])) || (p < b.length - s && !boundary(b[p - 1], b[p])))) p--;
      [ma, mb] = mid();
      if (!ma || !mb) return null;
    }
  }
  if (ma && mb) {
    while (p > 0 && (!boundary(a[p - 1], ma[0]) || !boundary(a[p - 1], mb[0]))) { p--; [ma, mb] = mid(); }
    while (s > 0 && (!boundary(ma[ma.length - 1], a[a.length - s]) || !boundary(mb[mb.length - 1], a[a.length - s]))) { s--; [ma, mb] = mid(); }
    const pa = ma.match(/^(\p{L}+)(\d*)$/u), pb = mb.match(/^(\p{L}+)(\d*)$/u);
    if (pa && pb) {
      if (pa[2] && pb[2] && pa[1] !== pb[1] && pa[2] !== pb[2]) return null; // x1 → y2 changes two things
      if (!pa[2] && !pb[2]) {
        const cut = splitWaveWords(ma, mb);
        if (cut) { if (cut.at === 'start') s += ma.length - cut.len; else p += ma.length - cut.len; [ma, mb] = mid(); }
      }
    } else if (!uniform(ma) || !uniform(mb) || classOf(ma[0]) !== classOf(mb[0])) return null;
  }
  return { ma, mb, keys: [`S${p}${KEY_SEP}${ma}${KEY_SEP}${mb}`, `E${s}${KEY_SEP}${ma}${KEY_SEP}${mb}`] };
}

/** How wave-like a substitution is (lower = more; below 1 = strong): known wave words in order (pre→post 0,
 *  pre→fu 0.1), a number n→n+1 behind a wave marker 0.5 (bare 1), an inserted marker/word/number 0.6–0.9, a later
 *  number 1.2+, a removed part 2.4+, the next letter 3, backward steps 4+, known words backwards 5.5, anything
 *  else (dep→anx) 5. `before` = the letters right before the token in the Time-1 name. */
function waveRank(ma, mb, before = '') {
  if (ma && mb) {
    const wa = wordInfo(ma), wb = wordInfo(mb);
    if (wa && wb) {
      const sa = Math.floor(wa.stage), sb = Math.floor(wb.stage);
      if (sb > sa) return (sb - sa - 1) / 10;
      if (wb.stage > wa.stage || (wb.stage === wa.stage && wb.n > wa.n)) return 0.05;
      return 5.5;
    }
    if (/^\d+$/.test(ma) && /^\d+$/.test(mb)) { const d = Number(mb) - Number(ma); return d === 1 ? (WAVE_MARKERS.has(before) ? 0.5 : 1) : d > 1 ? 1.2 + Math.min(d, 500) / 1000 : 4 + Math.min(-d, 500) / 1000; }
    if (ma.length === 1 && mb.length === 1 && classOf(ma) === 'l') { const d = mb.toLowerCase().charCodeAt(0) - ma.toLowerCase().charCodeAt(0); return d === 1 ? 3 : d > 1 ? 3.2 : 4.7; }
    return 5;
  }
  const m = (ma || mb).replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
  const base = mb ? 0 : 1.8; // Time 2 gaining a marker is the usual direction
  const word = (m.match(/^\p{L}+/u) || [''])[0].toLowerCase(), num = /\d/.test(m);
  if (num && WAVE_MARKERS.has(word)) return base + 0.6;
  if (wordInfo(m)) return base + 0.8;
  if (num && !word) return base + 0.9;
  return base + 1;
}
/** The number a token carries (x1_2 vs x1_3, fu1 vs fu2), else the stage of a known word, else 0 — a late tie-break. */
function tokenNumber(ma, mb) {
  const tok = mb || ma;
  const n = tok.match(/\d+/);
  if (n) return Number(n[0]);
  const w = wordInfo(tok.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''));
  return w ? w.stage : 0;
}

/** Time-2 counterparts of the Time-1 columns by NAME, in Time-1 order, or null when the names carry no convincing
 *  wave pairing (then the layout decides). Time-1 columns and ID-like columns are never candidates. */
export function pairWavesByName(data, t1) {
  if (!t1 || t1.length < 2) return null;
  const names = data?.varNames || [];
  const used = new Set(t1);
  const all = names.filter((v) => !looksLikeId(data, v));
  const free = all.filter((v) => !used.has(v));
  const maps = t1.map((n1) => {
    const m = new Map(); // key → the single free column carrying it (two columns → ambiguous → null)
    for (const c of free) { const d = nameSubstitution(n1, c); if (d) for (const k of d.keys) m.set(k, m.has(k) ? null : c); }
    return m;
  });
  const shared = [...maps[0].keys()].filter((k) => maps.every((m) => m.get(k)));
  if (!shared.length) return null;
  // the axis along which the Time-1 names differ among themselves cannot be the wave axis
  const axisOf = (k, ma, mb) => `${k.split(KEY_SEP)[0]}:${classOf((ma || mb)[0])}:${ma && mb ? 's' : ma ? 'd' : 'i'}`; // anchor, token class, substitution/deletion/insertion
  const axis = new Set();
  for (const x of t1) for (const y of t1) { if (x === y) continue; const d = nameSubstitution(x, y); if (d) for (const k of d.keys) axis.add(axisOf(k, d.ma, d.mb)); }
  // coverage over the whole file, computed once for the shared keys
  const want = new Set(shared);
  const partnered = new Map();
  for (const c of all) for (const d of all) {
    if (c === d) continue;
    const sub = nameSubstitution(c, d);
    if (sub) for (const k of sub.keys) if (want.has(k)) { if (!partnered.has(k)) partnered.set(k, new Set()); partnered.get(k).add(c); }
  }
  const lastT1 = Math.max(-1, ...t1.map((v) => names.indexOf(v)));
  const cands = [];
  for (const k of shared) {
    const cols = maps.map((m) => m.get(k));
    if (new Set(cols).size !== cols.length) continue;
    const [anchor, ma, mb] = k.split(KEY_SEP);
    if (axis.has(axisOf(k, ma, mb))) continue;
    const offset = Number(anchor.slice(1));
    const pos = anchor[0] === 'S' ? offset : t1[0].length - offset - ma.length;
    const before = (t1[0].slice(0, pos).match(/\p{L}+$/u) || [''])[0].toLowerCase();
    cands.push({ k, cols, rank: waveRank(ma, mb, before), coverage: partnered.get(k)?.size || 0, end: anchor[0] === 'E' ? 0 : 1, offset, num: tokenNumber(ma, mb), layout: cols.every((col) => names.indexOf(col) > lastT1) ? 0 : 1 });
  }
  if (!cands.length) return null;
  const strong = cands.filter((c) => c.rank < 1);
  const pool = strong.length ? strong : cands;
  const order = strong.length ? ['rank', 'end', 'offset', '-coverage', 'num', 'layout'] : ['end', 'offset', 'rank', '-coverage', 'num', 'layout'];
  const field = (f) => f.replace(/^-/, '');
  pool.sort((x, y) => { for (const f of order) { const d = f[0] === '-' ? y[field(f)] - x[field(f)] : x[f] - y[f]; if (d) return d; } return x.k.localeCompare(y.k); });
  const best = pool[0];
  const rival = pool.find((c) => c.cols.join(KEY_SEP) !== best.cols.join(KEY_SEP));
  if (rival && order.every((f) => rival[field(f)] === best[field(f)])) return null;
  return best.cols;
}

/** Keys every aligned (Time-1, Time-2) pair shares, over the pairs that exist (a Time 2 one column short still
 *  carries its pairing); [] when the pairs do not agree. */
export function carriedKeys(w1, w2) {
  const n = Math.min(w1?.length || 0, w2?.length || 0);
  let common = null;
  for (let i = 0; i < n; i++) {
    const d = nameSubstitution(w1[i], w2[i]);
    if (!d) return [];
    common = common ? common.filter((k) => d.keys.includes(k)) : d.keys.slice();
    if (!common.length) return [];
  }
  return common || [];
}
/** True when the waves have the same length and every pair carries one and the same token substitution. */
export function consistentWavePairs(w1, w2) { return !!w1?.length && w1.length === w2?.length && carriedKeys(w1, w2).length > 0; }

/** The free column carrying one of `keys` for each Time-1 name (one-to-one), or null; with { partial: true } the
 *  columns that have one, so a new Time-1 column without a counterpart stays unpaired instead of re-pairing all. */
export function mapByKey(data, t1, keys, { partial = false } = {}) {
  const want = new Set(Array.isArray(keys) ? keys : [keys]);
  const used = new Set(t1);
  const free = (data?.varNames || []).filter((v) => !used.has(v) && !looksLikeId(data, v));
  const cols = t1.map((n1) => { const hits = free.filter((c) => nameSubstitution(n1, c)?.keys.some((k) => want.has(k))); return hits.length === 1 ? hits[0] : null; });
  const found = cols.filter(Boolean);
  if (new Set(found).size !== found.length) return null;
  if (found.length === cols.length) return cols;
  return partial && found.length ? found : null;
}


/** Best guess for the Time-2 columns of a Time-1 selection: by name (pairWavesByName); else, for names that carry
 *  no wave token (V1…Vn of a headerless file), the block of free columns right after the last Time-1 column, else
 *  the block right before the first one, else the first free columns. ID-like columns are skipped everywhere —
 *  taking "the first unused column" used to put an id column at the head of Time 2 and shift every pair by one. */
export function guessWaveCounterparts(data, t1) {
  const byName = pairWavesByName(data, t1);
  if (byName) return byName;
  const names = data?.varNames || [];
  const used = new Set(t1);
  const ok = (v) => !used.has(v) && !looksLikeId(data, v);
  const idx = t1.map((v) => names.indexOf(v)).filter((i) => i >= 0);
  const after = names.slice(Math.max(-1, ...idx) + 1).filter(ok);
  if (after.length >= t1.length) return after.slice(0, t1.length);
  const before = names.slice(0, idx.length ? Math.min(...idx) : 0).filter(ok);
  if (before.length >= t1.length) return before.slice(-t1.length);
  return names.filter(ok).slice(0, t1.length);
}

/** Order for a Time-2 chip selection: the pairing the previous Time 2 carried (a wave-3 choice stays wave 3), else
 *  the by-name pairing, else column order — so toggling a chip cannot shift the pairs of a named file. */
export function orderWave2(data, w1, selected, prevW2 = []) {
  const set = new Set(selected);
  const fits = (cols) => { const sub = cols ? cols.filter((c) => set.has(c)) : []; return sub.length === set.size ? sub : null; }; // a subset keeps the carried order
  const carried = carriedKeys(w1, prevW2);
  return (carried.length && fits(mapByKey(data, w1, carried))) || fits(pairWavesByName(data, w1)) || (data?.varNames || []).filter((v) => set.has(v));
}

/** Assign a wave's indicator columns. Wave 0 (Time 1) drives the shared Λ pattern / factors / target. */
export function setWaveItems(spec, waveIdx, cols) {
  spec.longitudinal.waves[waveIdx] = cols.slice();
  if (waveIdx === 0) setItems(spec, cols.slice()); // T1 columns ARE the shared item set / Λ grid
  return spec;
}

/** A Time-1 change (wave picker or Items card): Time 2 follows with the pairing it carried before (a wave-3 choice
 *  stays wave 3; a new column without a counterpart under it stays unpaired, which the indicator-count check then
 *  reports), else the by-name guess; positional (V1…Vn) files keep their Time 2. */
export function setTime1(spec, cols) {
  const L = spec.longitudinal;
  const prevKeys = carriedKeys(L.waves[0], L.waves[1]);
  setWaveItems(spec, 0, cols);
  const follow = (prevKeys.length && mapByKey(spec.data, L.waves[0], prevKeys, { partial: true })) || pairWavesByName(spec.data, L.waves[0]);
  if (follow) setWaveItems(spec, 1, follow);
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
    // the pairing is positional (waves[1][k] re-measures waves[0][k]); catch an id column or a shifted pairing
    for (const it of w2 || []) if (looksLikeId(spec.data, it)) warnings.push(`${it} looks like a case identifier — remove it from Time 2; with it in the list every Time-1/Time-2 pair is shifted.`);
    // only when the names DO carry a wave pairing and the user's pairs do not share one substitution (x1_t1 ↔ x1_t3
    // for every k is fine; m1_t1 ↔ id, m2_t1 ↔ m1_t2 is the shifted pairing that silently ruins the whole sequence)
    const byName = (w1?.length && w2?.length === w1.length && !consistentWavePairs(w1, w2)) ? pairWavesByName(spec.data, w1) : null;
    if (byName) {
      const k = Math.max(0, w2.findIndex((c, idx) => c !== byName[idx])); // first pair that is not the by-name counterpart
      warnings.push(`Time 2 does not pair with Time 1 one-to-one by name (${w1[k]} ↔ ${w2[k]}, expected ${byName[k]}) — expected order ${byName.slice(0, 3).join(', ')}${byName.length > 3 ? ', …' : ''}. Check the Time-2 columns.`);
    }
    // (factor-count and ≥2-target-per-factor checks above already apply: spec.items === Time-1 columns.)
  }
  return { errors, warnings };
}
