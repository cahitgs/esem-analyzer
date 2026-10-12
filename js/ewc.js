// ewc.js — ESEM-within-CFA (and bifactor-EWC) generation. Pure (no DOM); Node-testable.
//
// Morin's workflow (Hoyle Handbook ch. 27 technical supplement, T62–T67):
//   1. Run the final ESEM / bifactor-ESEM with SVALUES in the OUTPUT.
//   2. Mplus prints a "(CFA) MODEL COMMAND WITH FINAL ROTATED ESTIMATES USED AS
//      STARTING VALUES" block — every loading / correlation / intercept / uniqueness
//      with its UNSTANDARDISED final estimate as a start value (`*value`).
//   3. Convert that rotated solution into a CFA by replacing the rotational constraints
//      with REFERENT constraints: pick one referent indicator per factor (ideally a pure
//      item — high main loading, low cross-loadings) and fix ALL of its cross-loadings
//      (loadings on the OTHER factors) to their ESEM value (`@value`). Fix every factor
//      variance to 1 (`@1`). For bifactor, also pick a referent for the G-factor and fix
//      all factor correlations to 0 (`@0`).
//   m factors ⇒ m(m−1) fixed cross-loadings — exactly enough to replace rotation, so the
//   EWC reproduces the ESEM fit while being a normal CFA you can embed in SEM / MIMIC / DIF.
//
// Two identification forms (Morin):
//   • basic (default)      — referent CROSS-loadings fixed, factor variances @1. For embedding
//     the factors as exogenous constructs (MIMIC / DIF / predictive paths onto outcomes).
//   • higherOrder variant  — the referent's MAIN loading is ALSO fixed and factor variances
//     are free with a start value of 1 (*1 instead of @1). Required when the factors become
//     ENDOGENOUS — e.g. under a higher-order factor or predicted by covariates — because an
//     endogenous factor's (residual) variance must stay a free parameter, so scale-setting
//     moves from the variance to the referent's main loading. Same npar/df/fit as the ESEM.
//
// This module parses that SVALUES block (parseSvalues), echoes back the original
// DATA/VARIABLE/ANALYSIS header from the .out (minus ROTATION), suggests referents, and
// emits the complete, runnable EWC .inp (buildEwcInp).

import { detectGeneralFactor } from './out-parser.js';
import { DEFAULT_OUTPUT_LINE } from './state.js';

const STMT = /;?\s*$/;

/** Parse the SVALUES "MODEL COMMAND ... STARTING VALUES" block + the echoed input header.
 *  Returns { found, factors[], items[], loadings{f:{item:raw}}, withs[{a,b,raw}],
 *  intercepts{item:raw}, uniq{item:raw}, varFixed[f], header[], generalFactor, isBifactor }.
 *  Raw values are kept as STRINGS so the emitted .inp is byte-identical to Mplus' estimates.
 *  opts.generalFactor (optional): the Results table's verdict for this same .out (parseOut().generalFactor,
 *  any letter case; null = "not bifactor") — when given it is used as is, so card and table always agree. */
export function parseSvalues(text, opts = {}) {
  const lines = String(text).split(/\r\n|\r|\n/);
  const hIdx = lines.findIndex((l) => /MODEL COMMAND WITH FINAL.*ESTIMATES USED AS STARTING VALUES/i.test(l));
  if (hIdx < 0) return { found: false };

  const loadings = {}, intercepts = {}, uniq = {}, withs = [], varFixed = [];
  const factors = [], items = [];
  const bare = []; // "name op value" lines (factor variance OR uniqueness — classify after)

  for (let i = hIdx + 1; i < lines.length; i++) {
    // Mplus echoes a parameter's label inside SVALUES ("z2*0.20786 (res1);" when the model
    // carried a residual-positivity constraint) — strip it, or the end-anchored uniqueness
    // regex below misses the line and the EWC model silently loses that start value.
    const L = lines[i].trim().replace(/\s*\([^()]*\)(?=\s*;?\s*$)/, '');
    if (!L) continue;
    if (/^(TECHNICAL|STARTING VALUES|Beginning Time|QUALITY|R-SQUARE|DIAGRAM|MUTHEN|\*\*\*)/i.test(L)) break;
    let m;
    if ((m = L.match(/^(\S+)\s+BY\s+(\S+)\s*([*@])\s*(-?\d*\.?\d+)/i))) {
      const f = m[1], it = m[2];
      if (!loadings[f]) { loadings[f] = {}; factors.push(f); }
      loadings[f][it] = m[4];
      if (!items.includes(it)) items.push(it);
      continue;
    }
    if ((m = L.match(/^(\S+)\s+WITH\s+(\S+)\s*([*@])\s*(-?\d*\.?\d+)/i))) {
      withs.push({ a: m[1], b: m[2], raw: m[4] });
      continue;
    }
    if ((m = L.match(/^\[\s*(\S+?)\s*([*@])\s*(-?\d*\.?\d+)\s*\]/))) {
      intercepts[m[1]] = m[3];
      continue;
    }
    if ((m = L.match(/^(\S+?)\s*([*@])\s*(-?\d*\.?\d+)\s*;?\s*$/))) {
      bare.push({ name: m[1], op: m[2], raw: m[3] });
      continue;
    }
  }
  // Classify bare "name op value" lines: known factor → variance fix; otherwise → uniqueness.
  const isFactor = new Set(factors);
  for (const b of bare) {
    if (isFactor.has(b.name)) varFixed.push(b.name);
    else uniq[b.name] = b.raw;
  }

  // Bifactor? ONE rule, shared with the Results table (out-parser.detectGeneralFactor): a factor named
  // G/GF with an estimate on every item counts even when some G-loadings are small (Morin's Data-1
  // bifactor-ESEM has G-λ of .12–.19). The caller may hand over the table's verdict instead.
  const num = (s) => (s == null ? null : parseFloat(s));
  const detect = () => detectGeneralFactor({ factors, items, loading: (f, it) => num(loadings[f]?.[it]), corr: withs.map((w) => num(w.raw)) });
  let generalFactor = null;
  if (Object.prototype.hasOwnProperty.call(opts, 'generalFactor')) {
    const want = opts.generalFactor == null ? null : String(opts.generalFactor).toLowerCase();
    generalFactor = want == null ? null : factors.find((f) => f.toLowerCase() === want) || detect();
  } else {
    generalFactor = detect();
  }

  const header = parseInputHeader(lines);
  return { found: true, factors, items, loadings, withs, intercepts, uniq, varFixed, header, generalFactor, isBifactor: !!generalFactor };
}

/** Pull the echoed DATA / VARIABLE / ANALYSIS / DEFINE commands from the .out's
 *  "INPUT INSTRUCTIONS" section, dropping TITLE / MODEL / OUTPUT and any ROTATION line.
 *  Returns an array of de-indented command lines ready to splice into the EWC .inp. */
function parseInputHeader(lines) {
  const start = lines.findIndex((l) => /^INPUT INSTRUCTIONS\s*$/.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^INPUT READING TERMINATED/i.test(l));
  if (end < 0) end = Math.min(lines.length, start + 120);
  const KEEP = /^(DATA|VARIABLE|DEFINE|ANALYSIS)\b/i;
  const DROP = /^(TITLE|MODEL|OUTPUT|SAVEDATA|PLOT|MONTECARLO)\b/i;
  const CMD = /^(TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL|OUTPUT|SAVEDATA|PLOT|MONTECARLO)\b/i;
  const out = [];
  let keep = false;
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i].replace(/^ {0,2}/, ''); // Mplus echoes with a 2-space indent
    const t = raw.trim();
    if (!t) continue;
    if (CMD.test(t)) keep = KEEP.test(t) && !DROP.test(t);
    if (!keep) continue;
    if (/ROTATION\s*=/i.test(t)) continue;       // EWC is not rotated
    out.push(raw.replace(/\s+$/, ''));
  }
  return out;
}

/** For each factor pick the purest referent: the item that loads most strongly on this
 *  factor (relative to its cross-loadings). Returns { factorName: itemName }.
 *  For a bifactor model, the G-factor's referent is the item with the strongest G loading
 *  net of its specific loadings, chosen among items not already used by a specific factor. */
export function suggestReferents(model) {
  const { factors, items, loadings, generalFactor } = model;
  const num = (s) => (s == null ? null : parseFloat(s));
  const L = (f, it) => { const v = num(loadings[f]?.[it]); return v == null ? 0 : v; };
  const specifics = factors.filter((f) => f !== generalFactor);

  // Each item's dominant specific factor (bifactor) or dominant factor (plain ESEM).
  const dominant = {};
  for (const it of items) {
    let bf = null, best = -1;
    for (const f of specifics) { const a = Math.abs(L(f, it)); if (a > best) { best = a; bf = f; } }
    dominant[it] = bf;
  }
  const purity = (f, it) => Math.abs(L(f, it)) - factors.filter((o) => o !== f).reduce((s, o) => s + Math.abs(L(o, it)), 0);

  const referents = {};
  const used = new Set();
  for (const f of specifics) {
    const cands = items.filter((it) => dominant[it] === f);
    const pool = cands.length ? cands : items;
    let pick = null, best = -Infinity;
    for (const it of pool) { const p = purity(f, it); if (p > best && !used.has(it)) { best = p; pick = it; } }
    if (pick == null) pick = pool[0];
    referents[f] = pick; used.add(pick);
  }
  if (generalFactor) {
    let pick = null, best = -Infinity;
    for (const it of items) {
      if (used.has(it)) continue;
      const p = Math.abs(L(generalFactor, it)) - specifics.reduce((s, o) => s + Math.abs(L(o, it)), 0);
      if (p > best) { best = p; pick = it; }
    }
    referents[generalFactor] = pick ?? items[0];
  }
  return referents;
}

// OUTPUT: the same default line as every other generated model (DEFAULT_OUTPUT_LINE, state.js).

/** Build the complete ESEM-within-CFA .inp from a parsed SVALUES model.
 *  opts: { referents?, title?, output?, header?, variant? }. Returns the .inp text.
 *  variant: 'basic' (default) or 'higherOrder' — see the identification notes above. */
export function buildEwcInp(model, opts = {}) {
  const { factors, items, loadings, withs, intercepts, uniq, generalFactor, isBifactor } = model;
  const higherOrder = opts.variant === 'higherOrder';
  const referents = opts.referents || suggestReferents(model);
  // Invert: which factor (if any) does this item act as referent for?
  const referentOf = {};
  for (const f of Object.keys(referents)) referentOf[referents[f]] = f;

  const title = opts.title
    || (isBifactor ? 'Bifactor-ESEM-within-CFA' : higherOrder ? 'ESEM-within-CFA (higher-order form)' : 'ESEM-within-CFA');
  const header = opts.header || model.header || [];
  const out = [`TITLE: ${title};`, ...header, 'MODEL:'];

  // Factor loadings — referent cross-loadings fixed (@); in the higher-order form the
  // referent's MAIN loading is fixed too (it takes over scale-setting from the variance).
  for (const f of factors) {
    for (const it of items) {
      if (loadings[f]?.[it] == null) continue;
      const refFactor = referentOf[it];               // it is the referent for refFactor
      const fixCross = refFactor != null && refFactor !== f; // this is a referent's cross-loading
      const fixMain = higherOrder && refFactor === f;        // higher-order: main loading fixed too
      const op = fixCross || fixMain ? '@' : '*';
      const tag = fixCross ? ` ! ${it} = referent for ${refFactor}`
        : fixMain ? ` ! referent main loading (sets ${f}'s scale)` : '';
      out.push(`  ${f} BY ${it}${op}${loadings[f][it]};${tag}`);
    }
    out.push('');
  }

  // Factor correlations — fixed to 0 for bifactor (orthogonal), free start values otherwise.
  if (withs.length) {
    for (const w of withs) out.push(isBifactor ? `  ${w.a} WITH ${w.b}@0;` : `  ${w.a} WITH ${w.b}*${w.raw};`);
    out.push('');
  }

  // Item intercepts (free start values).
  for (const it of items) if (intercepts[it] != null) out.push(`  [ ${it}*${intercepts[it]} ];`);
  out.push('');
  // Item uniquenesses (free start values).
  for (const it of items) if (uniq[it] != null) out.push(`  ${it}*${uniq[it]};`);

  // Factor variances: fixed @1 in the basic form; FREE (*1) in the higher-order form, where
  // the fixed referent main loadings set each factor's scale instead.
  if (higherOrder) {
    out.push('  ! Variances free (*1): the factors can be endogenous. To add a higher-order');
    out.push(`  ! factor:  HF BY ${factors[0]}* ${factors.slice(1).join(' ')};  HF@1;  (and remove the WITH lines)`);
  }
  out.push('  ' + factors.map((f) => `${f}${higherOrder ? '*1' : '@1'};`).join(' '));
  // OUTPUT on its own line so the options stay under Mplus' 90-char input limit.
  out.push('OUTPUT:', `${opts.output || DEFAULT_OUTPUT_LINE};`);
  return out.join('\n') + '\n';
}

/** Count the referent-fixed cross-loadings — should equal m(m−1) for an identified EWC. */
export function fixedCrossCount(model, referents) {
  const refs = referents || suggestReferents(model);
  let n = 0;
  for (const f of model.factors) for (const it of model.items) {
    if (model.loadings[f]?.[it] == null) continue;
    const rf = Object.keys(refs).find((k) => refs[k] === it);
    if (rf && rf !== f) n++;
  }
  return n;
}
