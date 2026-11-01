// mplus91.test.mjs — Mplus 9.1.1 outputs parse like the 8.3 outputs of the same inputs. Run: node test/mplus91.test.mjs
// The v91_* fixtures are real Mplus 9.1.1 runs of the inputs echoed in the 8.3 fixtures, on the same data.
// Mplus 9.1 added a "STANDARDIZED SOLUTION" section (the rotated loadings side by side, as in TYPE=EFA) right
// after R-SQUARE, moved QUALITY OF NUMERICAL RESULTS before the standardized results, prints partial correlations
// in RESIDUAL OUTPUT, adds a "MODEL:" line to the SVALUES block, and where 8.3 said "THE ROBUST CHI-SQUARE COULD
// NOT BE COMPUTED" it now says "THE CHI-SQUARE STATISTIC IS NEGATIVE" or simply leaves the chi-square block out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut } from '../js/out-parser.js';
import { parseSvalues } from '../js/ewc.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}
const fx = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
const near = (a, b, tol = 0.0015) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol);

/** Leaves that differ between two parses (numbers within tol; version and date strings ignored). */
function diffs(x, y, path = 'p', out = []) {
  if (typeof x === 'number' || typeof y === 'number') { if (!near(x, y)) out.push(`${path}: ${x} vs ${y}`); return out; }
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    if (typeof x === 'string' && /VERSION|\d\d\/\d\d\/\d{4}/.test(x)) return out;
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (k === 'modIndices') continue; // Mplus 9.1.1 prints a slightly different set of modification indices
    if (!(k in x) || !(k in y)) { out.push(`${path}.${k}: ${k in x ? 'missing in 9.1.1 parse' : 'only in 9.1.1 parse'}`); continue; }
    diffs(x[k], y[k], `${path}.${k}`, out);
  }
  return out;
}

function sameParse(label, a, b) {
  const fitKeys = Object.keys(a.fit);
  check(`${label}: fit (${fitKeys.length} values)`, fitKeys.every((k) => near(a.fit[k], b.fit[k])) && Object.keys(b.fit).length === fitKeys.length, [a.fit, b.fit]);
  check(`${label}: factors and items`, JSON.stringify(a.factorOrder) === JSON.stringify(b.factorOrder) && JSON.stringify(a.items) === JSON.stringify(b.items), [b.factorOrder, b.items]);
  const load = a.factorOrder.every((f) => a.items.every((it) => near(a.loadings[f]?.[it]?.est, b.loadings[f]?.[it]?.est) && near(a.loadings[f]?.[it]?.se, b.loadings[f]?.[it]?.se)));
  check(`${label}: standardized loadings (est, SE)`, load, b.loadings);
  check(`${label}: R-square and uniqueness`, a.items.every((it) => near(a.rSquare[it], b.rSquare[it]) && near(a.uniqueness[it], b.uniqueness[it])), [b.rSquare, b.uniqueness]);
  const d = diffs(a, b);
  check(`${label}: whole parse identical (${d.length} differing leaves)`, d.length === 0, d.slice(0, 6));
}

// ---- 1. single-group ESEM (target rotation): the new STANDARDIZED SOLUTION section after R-SQUARE ----
{
  const t91 = fx('v91_esem_target_data1.out');
  const a = parseOut(fx('esem_target_data1.out')), b = parseOut(t91);
  check('ESEM 9.1.1 fixture is a 9.1.1 run with the side-by-side section', /^Mplus VERSION 9\.1\.1/.test(t91) && /^STANDARDIZED SOLUTION\s*$/m.test(t91) && /TARGET ROTATED LOADINGS/.test(t91), t91.slice(0, 20));
  sameParse('ESEM target (Ch27 Data 1)', a, b);
  check('ESEM: R-square not overwritten by the side-by-side rows', a.items.every((it) => near(a.rSquare[it], b.rSquare[it])), b.rSquare);
  const sd = diffs(parseSvalues(fx('esem_target_data1.out')), parseSvalues(t91), 'svalues');
  check(`ESEM: SVALUES block (with the new "MODEL:" line) parses identically (${sd.length} differing leaves)`, sd.length === 0, sd.slice(0, 4));
}

// ---- 2. multigroup bifactor-ESEM (MLR): side-by-side blocks per group follow the per-group R-SQUARE ----
{
  const t91 = fx('v91_mg_besem_1_configural.out');
  const a = parseOut(fx('mg_besem_1_configural.out')), b = parseOut(t91);
  check('MG bifactor-ESEM 9.1.1 fixture: 2 groups, side-by-side section per group', b.nGroups === 2 && (t91.match(/TARGET ROTATED LOADINGS .* FOR /g) || []).length >= 2, b.nGroups);
  sameParse('MG bifactor-ESEM configural', a, b);
  check('MG bifactor-ESEM: R² of SOS1_T1 stays 0.730 (a side-by-side row would have made it 0.695)', near(b.rSquare.SOS1_T1, 0.730, 0.0005), b.rSquare.SOS1_T1);
}

// ---- 3. categorical (WLSMV / THETA / DIFFTEST) metric step ----
{
  const t91 = fx('v91_mg_cat_2_metric.out');
  const a = parseOut(fx('mg_cat_2_metric.out')), b = parseOut(t91);
  check('Categorical metric 9.1.1 fixture: WLSMV, 2 groups', b.estimator === 'WLSMV' && b.nGroups === 2, [b.estimator, b.nGroups]);
  sameParse('Categorical ESEM metric (WLSMV, THETA)', a, b);
  check('Categorical metric: DIFFTEST Δχ²(27) = 29.937, p = .317 in both versions', b.diffTest && near(b.diffTest.chi2, 29.937) && b.diffTest.df === 27 && near(b.diffTest.p, 0.317) && near(a.diffTest.chi2, b.diffTest.chi2), [a.diffTest, b.diffTest]);
}

// ---- 4. converged model without a chi-square: 9.1.1 prints no "could not be computed" line at all ----
{
  const t91 = fx('v91_mg_besem_nochisq_configural.out');
  const a = parseOut(fx('mg_besem_nochisq_configural.out')), b = parseOut(t91);
  check('No-χ² 9.1.1 fixture: converged, no chi-square block, no 8.3 phrase', b.converged && !/Chi-Square Test of Model Fit/.test(t91) && !/CHI-SQUARE COULD NOT BE COMPUTED/.test(t91), b.converged);
  check('No-χ²: chiSquareComputed = false and the note is present', b.chiSquareComputed === false && b.fit.chi2 == null && b.warnings.some((w) => /could not be computed/.test(w)), b.warnings);
  check('No-χ²: the note appears once', b.warnings.filter((w) => /χ² and fit indices could not be computed/.test(w)).length === 1, b.warnings);
  sameParse('No-χ² bifactor-ESEM configural', a, b);
}

// ---- 5. "THE CHI-SQUARE STATISTIC IS NEGATIVE" (9.1.1 wording for a Heywood-case metric step) ----
{
  const t91 = fx('v91_BifactorInv_2_metric.out');
  const b = parseOut(t91);
  check('Negative-χ² 9.1.1 fixture: the new wording, no 8.3 phrase', /THE CHI-SQUARE STATISTIC IS NEGATIVE/.test(t91) && !/CHI-SQUARE COULD NOT BE COMPUTED/.test(t91), null);
  check('Negative-χ²: converged, SEs not computed, χ² not computed', b.converged && b.seComputed === false && b.chiSquareComputed === false && b.fit.chi2 == null, [b.converged, b.seComputed, b.chiSquareComputed, b.fit]);
  check('Negative-χ²: both notes present', b.warnings.some((w) => /Standard errors could not be computed/.test(w)) && b.warnings.some((w) => /χ² and fit indices could not be computed/.test(w)), b.warnings);
  check('Negative-χ²: loadings still read (G + 3 specific factors, 12 items, 2 groups)', JSON.stringify(b.factorOrder) === '["G","F1","F2","F3"]' && b.items.length === 12 && b.nGroups === 2, [b.factorOrder, b.items.length, b.nGroups]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
