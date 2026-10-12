// longitudinal.test.mjs — longitudinal (2-wave) invariance: generator tokens, real Mplus fixtures,
// and comparison logic. Run: node test/longitudinal.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createModelSpec, setWaveItems, setFactorCount, validateSpec } from '../js/state.js';
import { buildInp, requestedModels, maxLineLength } from '../js/syntax-generator.js';
import { parseOut } from '../js/out-parser.js';
import { invarianceDecision, renderInvarianceTable } from '../js/apa-render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
let pass = 0, fail = 0;
const approx = (a, b, tol = 0.01) => a != null && Math.abs(a - b) <= tol;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

// ---- a 2-wave, 2-factor longitudinal spec (mirrors Morin's ESEM.dat: X1-X6 @T1, Y1-Y6 @T2) ----
const T1 = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
const T2 = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];
function makeSpec() {
  const spec = createModelSpec({
    fileName: 'ESEM.dat', mplusFile: 'ESEM.dat',
    delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 4500,
    varNames: [...T1, ...T2, 'GV'], categorical: [], missingCode: null,
  });
  spec.longitudinal.enabled = true;
  setWaveItems(spec, 0, T1);
  setWaveItems(spec, 1, T2);
  setFactorCount(spec, 2);
  spec.modelTypes = { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: false };
  return spec;
}

console.log('\n— requestedModels (longitudinal, ESEM + CFA) —');
const spec = makeSpec();
const models = requestedModels(spec);
check('12 models (6 ESEM + 6 CFA)', models.length === 12, models.length);
check('keys are linv:<mt>:<step>', models.every((m) => /^linv:(esem|cfa):/.test(m.key)), models[0]?.key);
check('files LongInv_*', models.every((m) => /^LongInv_(esem|cfa)_\d_/.test(m.file)), models[0]?.file);

console.log('\n— ESEM generator tokens —');
const gen = (mt, step) => buildInp(spec, `linv:${mt}:${step}`);
const ec = gen('esem', 'configural'), em = gen('esem', 'metric'), es = gen('esem', 'scalar'),
  et = gen('esem', 'strict'), ev = gen('esem', 'varcov'), el = gen('esem', 'latentmean');
check('configural has (*t1) and (*t2)', /\(\*t1\);/.test(ec) && /\(\*t2\);/.test(ec), null);
check('configural has cross-wave WITH (one per indicator)', /X1 WITH Y1;/.test(ec) && /X6 WITH Y6;/.test(ec), null);
check('every line ≤ 90 even for many indicators', maxLineLength(ec) <= 90, maxLineLength(ec));
check('configural has NO loading-equality flag', !/\(\*t1 1\)/.test(ec), null);
check('metric equates loadings (*t1 1)/(*t2 1)', /\(\*t1 1\);/.test(em) && /\(\*t2 1\);/.test(em), null);
check('scalar shares intercept labels both waves', /\[X1 X2 X3 X4 X5 X6\] \(i1-i6\);/.test(es) && /\[Y1 Y2 Y3 Y4 Y5 Y6\] \(i1-i6\);/.test(es), null);
check('scalar fixes T1 means, frees T2 means', /\[F1-F2@0\];/.test(es) && /\[F3-F4\];/.test(es), null);
check('scalar has NO residual labels', !/\(u1-u6\)/.test(es), null);
check('strict shares residual labels both waves', /X1 X2 X3 X4 X5 X6 \(u1-u6\);/.test(et) && /Y1 Y2 Y3 Y4 Y5 Y6 \(u1-u6\);/.test(et), null);
check('varcov refixes T2 var + equates cov', /F3-F4@1;/.test(ev) && /F1 WITH F2 \(lcov1\);/.test(ev) && /F3 WITH F4 \(lcov1\);/.test(ev), null);
check('latentmean refixes T2 means @0', /\[F3-F4@0\];/.test(el), null);
check('every ESEM model ≤ 90 chars/line', [ec, em, es, et, ev, el].every((s) => maxLineLength(s) <= 90), [ec, em, es, et, ev, el].map(maxLineLength));

console.log('\n— CFA generator tokens —');
const cc = gen('cfa', 'configural'), cm = gen('cfa', 'metric'), cs = gen('cfa', 'scalar'), cl = gen('cfa', 'latentmean');
check('CFA configural defines F1..F4 in order', /F1 BY X1\* X2 X3;/.test(cc) && /F2 BY X4\* X5 X6;/.test(cc) && /F3 BY Y1\* Y2 Y3;/.test(cc) && /F4 BY Y4\* Y5 Y6;/.test(cc), null);
check('CFA configural has no loading labels', !/\(L1_1\)/.test(cc), null);
check('CFA metric labels loadings per statement', /F1 BY X1\* \(L1_1\);/.test(cm) && /F1 BY X2 \(L1_2\);/.test(cm), null);
check('CFA metric shares T1/T2 loading labels', /F3 BY Y1\* \(L1_1\);/.test(cm) && /F3 BY Y2 \(L1_2\);/.test(cm), null);
check('CFA metric frees T2 factor variance (no F3-F4@1)', /F1-F2@1;/.test(cm) && !/F3-F4@1;/.test(cm), null);
check('CFA varcov refixes T2 variance', /F3-F4@1;/.test(gen('cfa', 'varcov')), null);
check('CFA latentmean refixes T2 means @0', /\[F3-F4@0\];/.test(cl), null);
check('every CFA model ≤ 90 chars/line', [cc, cm, cs, cl].every((s) => maxLineLength(s) <= 90), null);

console.log('\n— flag wrapping (3 factors, long names — Mplus ignores a flag alone on a wrapped line) —');
// Mplus 8.3 silently ignores an ESEM set flag "(*t1 1)" that starts its own continuation line:
// the metric model then fits the configural model with NO warning, and the varcov step dies with
// FATAL error 1020 (found end-to-end testing Morin Ch27 Data 2, 3 factors × 12 "_t1/_t2" names).
const L1 = ['x1_t1', 'x2_t1', 'x3_t1', 'x4_t1', 'y1_t1', 'y2_t1', 'y3_t1', 'y4_t1', 'z1_t1', 'z2_t1', 'z3_t1', 'z4_t1'];
const L2 = ['x1_t2', 'x2_t2', 'x3_t2', 'x4_t2', 'y1_t2', 'y2_t2', 'y3_t2', 'y4_t2', 'z1_t2', 'z2_t2', 'z3_t2', 'z4_t2'];
function makeLongNameSpec() {
  const s = createModelSpec({
    fileName: 'data2.dat', mplusFile: 'data2.dat', delimiter: 'whitespace', hasHeader: false,
    nCols: 24, nRows: 10000, varNames: [...L1, ...L2], categorical: [], missingCode: null,
  });
  s.longitudinal.enabled = true;
  setWaveItems(s, 0, L1);
  setWaveItems(s, 1, L2);
  s.factors = [1, 2, 3].map((i) => ({ id: `F${i}`, label: `F${i}` }));
  s.target = {};
  L1.forEach((it, idx) => { s.target[it] = { F1: idx < 4, F2: idx >= 4 && idx < 8, F3: idx >= 8 }; });
  return s;
}
const noLoneFlag = (inp) => !inp.split('\n').some((l) => /^\s*\([^()]*\);?\s*$/.test(l));
{
  const s = makeLongNameSpec();
  const lm = buildInp(s, 'linv:esem:metric'), lc = buildInp(s, 'linv:esem:configural'), lv = buildInp(s, 'linv:esem:varcov');
  check('3f long-name metric: no flag starts a line', noLoneFlag(lm), lm.split('\n').filter((l) => /^\s*\(/.test(l)));
  check('3f long-name metric: (*t1 1) shares a line with a variable', /\w+ \(\*t1 1\);/.test(lm), null);
  check('3f long-name configural/varcov: no lone flags', noLoneFlag(lc) && noLoneFlag(lv), null);
  check('3f long-name models stay ≤ 90 chars/line', [lm, lc, lv].every((x) => maxLineLength(x) <= 90), null);
  // plain ESEM with many long items — same hazard on the "(*1)" flag
  s.longitudinal.enabled = false;
  const eg = buildInp(s, 'esem');
  check('plain ESEM long-name: no lone (*1) flag', noLoneFlag(eg), eg.split('\n').filter((l) => /^\s*\(/.test(l)));
}

console.log('\n— bifactor-ESEM longitudinal generator (Morin Ch27 T28–T41) —');
{
  const s = makeLongNameSpec();
  s.modelTypes = { cfa: false, esem: false, bifactorCfa: false, bifactorEsem: true };
  const models = requestedModels(s);
  check('besem: 6 models with linv:besem keys', models.length === 6 && models.every((m) => /^linv:besem:/.test(m.key)), models.map((m) => m.key));
  check('besem: files LongInv_besem_*', models.every((m) => /^LongInv_besem_\d_/.test(m.file)), models[0]?.file);
  const bc = buildInp(s, 'linv:besem:configural'), bm = buildInp(s, 'linv:besem:metric'),
    bv = buildInp(s, 'linv:besem:varcov'), bl = buildInp(s, 'linv:besem:latentmean');
  check('besem uses TARGET(ORTHOGONAL) + high iterations', /ROTATION=TARGET\(ORTHOGONAL\);/.test(bc) && /ITERATIONS = 100000;/.test(bc), null);
  check('besem configural: G blocks on all items (*t1)/(*t2)', /G1 BY x1_t1 .*/.test(bc) && /\w+ \(\*t1\);/.test(bc) && /\w+ \(\*t2\);/.test(bc), null);
  check('besem metric: all blocks equated (*t1 1)/(*t2 1)', (bm.match(/\(\*t1 1\);/g) || []).length === 4 && (bm.match(/\(\*t2 1\);/g) || []).length === 4, null);
  check('besem varcov: T2 vars refixed incl. G2', /F4-F6@1;/.test(bv) && /G2@1;/.test(bv), null);
  check('besem varcov: full covariance equality incl. G pairs', /G1 WITH F1 \(lcov1\);/.test(bv) && /G2 WITH F4 \(lcov1\);/.test(bv) && /F2 WITH F3 \(lcov6\);/.test(bv) && /F5 WITH F6 \(lcov6\);/.test(bv), null);
  check('besem latentmean: T2 means refixed incl. [G2@0]', /\[F4-F6@0\];/.test(bl) && /\[G2@0\];/.test(bl), null);
  check('besem: no lone flags, ≤90 chars', [bc, bm, bv, bl].every((x) => noLoneFlag(x) && maxLineLength(x) <= 90), null);
}

console.log('\n— real Mplus fixtures: bifactor-ESEM sequence (clean invariant 2-wave data) —');
const BSTEPS = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const besemFx = Object.fromEntries(BSTEPS.map((s) => [s, parseOut(fx(`long_besem_${s}.out`))]));
check('besem fixtures: invModel=besem', BSTEPS.every((s) => besemFx[s].invModel === 'besem'), besemFx.configural.invModel);
// the "(bifactor-ESEM)" hyphen must not break the step-name capture (needs the " - " separator)
check('besem invStep clean (no "ESEM) -" prefix)', besemFx.configural.invStep === 'Configural' && besemFx.metric.invStep === 'Metric (loadings)', [besemFx.configural.invStep, besemFx.metric.invStep]);
check('besem fixtures: invKind=longitudinal', besemFx.configural.invKind === 'longitudinal', besemFx.configural.invKind);
check('besem configural χ²(164) = 178.426', approx(besemFx.configural.fit.chi2, 178.426) && besemFx.configural.fit.df === 164, [besemFx.configural.fit.chi2, besemFx.configural.fit.df]);
check('besem metric χ²(196) = 204.087 (npar 128)', approx(besemFx.metric.fit.chi2, 204.087) && besemFx.metric.nFreeParams === 128, [besemFx.metric.fit.chi2, besemFx.metric.nFreeParams]);
check('besem latentmean χ²(230) = 240.105', approx(besemFx.latentmean.fit.chi2, 240.105, 0.1), besemFx.latentmean.fit.chi2);
const besemDf = BSTEPS.map((s) => besemFx[s].fit.df);
check('besem df strictly increasing', besemDf.every((d, i) => i === 0 || d > besemDf[i - 1]), besemDf);
check('besem all converged', BSTEPS.every((s) => besemFx[s].converged), null);
// Satorra–Bentler in the invariance table must be POSITIVE for a more-constrained model that fits
// worse (metric vs configural raw Δχ² = +25.66) — guards the mc/mu ordering in renderInvarianceTable.
{
  const html = renderInvarianceTable(
    [{ label: besemFx.configural.invStep, parsed: besemFx.configural }, { label: besemFx.metric.invStep, parsed: besemFx.metric }],
    { longitudinal: true },
  );
  check('invariance table Δχ²(s) positive (25.67)', html.includes('25.67') && !html.includes('−25.67') && !html.includes('-25.67'), html.match(/-?−?25\.\d\d/g));
}

console.log('\n— real Mplus fixtures: ESEM sequence —');
const STEPS = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const esemFx = Object.fromEntries(STEPS.map((s) => [s, parseOut(fx(`long_esem_${s}.out`))]));
check('ESEM configural invKind=longitudinal', esemFx.configural.invKind === 'longitudinal', esemFx.configural.invKind);
check('ESEM configural invModel=esem', esemFx.configural.invModel === 'esem', esemFx.configural.invModel);
check('ESEM scalar invStep="Scalar (intercepts)"', esemFx.scalar.invStep === 'Scalar (intercepts)', esemFx.scalar.invStep);
check('ESEM single-group (nGroups=1)', esemFx.configural.nGroups === 1, esemFx.configural.nGroups);
check('ESEM N = 4500', esemFx.configural.nObs === 4500, esemFx.configural.nObs);
// reproduces Morin's published M1/M2/M5 exactly
check('ESEM configural χ² = 62.879 (= Morin M1)', approx(esemFx.configural.fit.chi2, 62.879), esemFx.configural.fit.chi2);
check('ESEM metric χ² = 70.629 (= Morin M2)', approx(esemFx.metric.fit.chi2, 70.629), esemFx.metric.fit.chi2);
check('ESEM scalar χ² = 477.52 (= Morin M5)', approx(esemFx.scalar.fit.chi2, 477.52, 0.1), esemFx.scalar.fit.chi2);
check('ESEM configural npar = 56 (= Morin M1)', esemFx.configural.nFreeParams === 56, esemFx.configural.nFreeParams);
check('ESEM metric npar = 48 (= Morin M2)', esemFx.metric.nFreeParams === 48, esemFx.metric.nFreeParams);
check('ESEM scalar npar = 44 (= Morin M5)', esemFx.scalar.nFreeParams === 44, esemFx.scalar.nFreeParams);
const esemDf = STEPS.map((s) => esemFx[s].fit.df);
check('ESEM df strictly increasing', esemDf.every((d, i) => i === 0 || d > esemDf[i - 1]), esemDf);

console.log('\n— real Mplus fixtures: CFA sequence —');
const cfaFx = Object.fromEntries(STEPS.map((s) => [s, parseOut(fx(`long_cfa_${s}.out`))]));
check('CFA configural invModel=cfa', cfaFx.configural.invModel === 'cfa', cfaFx.configural.invModel);
check('CFA metric invStep="Metric (loadings)"', cfaFx.metric.invStep === 'Metric (loadings)', cfaFx.metric.invStep);
const cfaDf = STEPS.map((s) => cfaFx[s].fit.df);
check('CFA df strictly increasing', cfaDf.every((d, i) => i === 0 || d > cfaDf[i - 1]), cfaDf);
check('CFA configural npar = 48', cfaFx.configural.nFreeParams === 48, cfaFx.configural.nFreeParams);

console.log('\n— comparison logic over the sequence —');
// metric vs configural should be supported (loadings invariant here); scalar typically not (means shift).
const decMetric = invarianceDecision(esemFx.configural.fit, esemFx.metric.fit);
check('ESEM metric step yields a verdict', decMetric.ok === true || decMetric.ok === false, decMetric);
check('ESEM metric supported (ΔCFI≈0)', decMetric.ok === true, decMetric);

console.log('\n— validation —');
const bad = makeSpec();
setWaveItems(bad, 1, ['Y1', 'Y2', 'Y3']); // unequal wave sizes (T1 has 6, T2 has 3)
check('unequal wave sizes flagged', validateSpec(bad).errors.some((e) => /same number of indicators/i.test(e)), validateSpec(bad).errors);
const overlap = makeSpec();
setWaveItems(overlap, 1, ['X1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6']); // X1 shared across waves
check('overlapping wave columns flagged', validateSpec(overlap).errors.some((e) => /different columns/i.test(e)), validateSpec(overlap).errors);
const both = makeSpec();
both.groups.enabled = true; both.groups.variable = 'GV'; both.groups.codes = [{ code: '1', label: 'a' }, { code: '2', label: 'b' }];
check('multigroup + longitudinal mutually exclusive', validateSpec(both).errors.some((e) => /either multi-group or longitudinal/i.test(e)), validateSpec(both).errors);
const catLong = makeSpec();
catLong.data.categorical = ['X1', 'Y2']; // one column per wave flagged categorical
check('categorical wave columns → error (intercept chain is continuous-only)', validateSpec(catLong).errors.some((e) => /continuous indicators only/i.test(e) && /X1, Y2/.test(e)), validateSpec(catLong).errors);
const catOutside = makeSpec(); catOutside.data = { ...catOutside.data, categorical: ['GV'] };
check('categorical column outside the waves is fine', validateSpec(catOutside).errors.length === 0, validateSpec(catOutside).errors);

console.log(`\nlongitudinal.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
