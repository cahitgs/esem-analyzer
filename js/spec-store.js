// spec-store.js — save and restore a model specification (everything but the data matrix). The Model step
// keeps the sketch across a return to the Data step, remembers it per data file in localStorage, and
// exports / imports it as a .json file, so an 18-item / 6-factor sketch survives a closed tab or moves to
// another file with the same columns. Pure: no DOM, node-testable.
import { setItems, setFactorCount } from './state.js';

export const SPEC_FORMAT = 1;

/** The columns of a data file, in order — the identity of a sketch. */
export const specSignature = (data) => (data?.varNames || []).join('\u0001');

const clone = (x) => JSON.parse(JSON.stringify(x));

/** A plain object describing the spec (JSON-safe); the data matrix is never included. */
export function serializeSpec(spec) {
  const d = spec.data || {};
  return {
    app: 'ESEM Analyzer', format: SPEC_FORMAT, savedAt: new Date().toISOString(),
    file: d.fileName || null, columns: (d.varNames || []).slice(), categorical: (d.categorical || []).slice(), missingCode: d.missingCode ?? null,
    items: spec.items.slice(), factors: spec.factors.map((f) => ({ ...f })), target: clone(spec.target),
    rotation: { ...spec.rotation }, estimator: spec.estimator, modelTypes: { ...spec.modelTypes }, bifactor: { ...spec.bifactor },
    groups: clone(spec.groups), longitudinal: clone(spec.longitudinal), output: { ...spec.output }, aids: clone(spec.aids),
    recode: clone(spec.recode || {}),
  };
}

/** Apply a saved description onto `spec` (a fresh spec built from the current data). Columns the data does not
 *  have are dropped and reported. With `withData`, the saved categorical flags and missing code are applied to the
 *  data as well (a .json loaded on purpose); otherwise the data's own flags win. */
export function applySavedSpec(spec, saved, { withData = false } = {}) {
  const dropped = [];
  if (!saved || typeof saved !== 'object' || saved.format !== SPEC_FORMAT || !Array.isArray(saved.items)) return { ok: false, dropped };
  const names = new Set(spec.data?.varNames || []);
  const keep = (list) => (Array.isArray(list) ? list : []).filter((v) => { if (names.has(v)) return true; if (!dropped.includes(v)) dropped.push(v); return false; });
  const items = keep(saved.items);
  if (items.length < 2) return { ok: false, dropped };
  setItems(spec, items);
  const nf = Math.min(Math.max(1, (saved.factors || []).length || 1), Math.max(1, items.length - 1));
  setFactorCount(spec, nf);
  spec.factors.forEach((f, i) => { const s = saved.factors?.[i]; if (s && typeof s.label === 'string' && s.label.trim()) f.label = s.label; });
  const ids = new Set(spec.factors.map((f) => f.id));
  // the saved target pattern, restricted to the kept items and the existing factors
  spec.target = {};
  for (const it of items) {
    spec.target[it] = {};
    const row = saved.target?.[it] || {};
    for (const [fid, v] of Object.entries(row)) if (ids.has(fid)) spec.target[it][fid] = !!v;
  }
  if (saved.rotation && typeof saved.rotation === 'object') spec.rotation = { ...spec.rotation, ...saved.rotation };
  if (typeof saved.estimator === 'string') spec.estimator = saved.estimator;
  if (saved.modelTypes && typeof saved.modelTypes === 'object') spec.modelTypes = { ...spec.modelTypes, ...saved.modelTypes };
  if (saved.bifactor && typeof saved.bifactor === 'object') spec.bifactor = { ...spec.bifactor, ...saved.bifactor };
  if (saved.output && typeof saved.output.line === 'string' && saved.output.line.trim()) spec.output = { ...spec.output, line: saved.output.line };
  if (saved.aids && typeof saved.aids === 'object') {
    spec.aids = { ...spec.aids, ...clone(saved.aids) };
    spec.aids.positiveResiduals = keep(spec.aids.positiveResiduals);
  }
  if (saved.groups && typeof saved.groups === 'object') {
    const g = clone(saved.groups);
    if (g.variable && !names.has(g.variable)) { dropped.push(g.variable); g.variable = null; g.enabled = false; g.codes = []; }
    spec.groups = { ...spec.groups, ...g, invariance: { ...spec.groups.invariance, ...(g.invariance || {}) } };
  }
  if (saved.longitudinal && typeof saved.longitudinal === 'object') {
    const L = clone(saved.longitudinal);
    L.waves = [keep(L.waves?.[0]), keep(L.waves?.[1])];
    spec.longitudinal = { ...spec.longitudinal, ...L, invariance: { ...spec.longitudinal.invariance, ...(L.invariance || {}) } };
    if (spec.longitudinal.enabled && spec.longitudinal.waves[0].length >= 2) setItems(spec, spec.longitudinal.waves[0].slice()); // Time-1 columns are the item set
  }
  spec.recode = {};
  if (saved.recode && typeof saved.recode === 'object') for (const [col, m] of Object.entries(saved.recode)) if (names.has(col) && m && typeof m === 'object') spec.recode[col] = { ...m };
  if (withData && spec.data) {
    // the indicators are all continuous or all ordinal (one choice for every item): a saved list that flags some
    // columns, or a saved WLSMV estimator, means ordinal for all of them
    const ordinal = keep(saved.categorical).length > 0 || saved.estimator === 'WLSMV';
    spec.data.ordinal = ordinal;
    spec.data.categorical = ordinal ? (spec.data.varNames || []).slice() : [];
    if (saved.missingCode !== undefined) spec.data.missingCode = saved.missingCode;
  }
  if (spec.data?.ordinal && spec.estimator !== 'WLSMV') spec.estimator = 'WLSMV'; // the data's decision wins over an older estimator
  return { ok: true, dropped };
}

// ---- localStorage (per data file: name + column signature) ----
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const storageKey = (data) => `esem-analyzer.spec.${hash(`${data?.fileName || ''}|${specSignature(data)}`)}`;

export function saveSpecLocal(spec) {
  try { localStorage.setItem(storageKey(spec.data), JSON.stringify(serializeSpec(spec))); return true; } catch { return false; }
}
export function loadSpecLocal(data) {
  try { const raw = localStorage.getItem(storageKey(data)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function forgetSpecLocal(data) {
  try { localStorage.removeItem(storageKey(data)); } catch { /* ignore */ }
}
