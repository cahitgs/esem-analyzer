// catinv.test.mjs — categorical (WLSMV/THETA) multi-group invariance + DIFFTEST chain.
// The generator was cross-validated against De Beer & Morin's (B)ESEM syntax generator
// (statstools.app/b_esem) categorical mode: identical npar/df/χ² AND identical DIFFTEST Δχ²
// at every step in real Mplus 8.3 runs. Fixtures mg_cat_*.out are OUR generated syntax run on
// a 5-category ordinal cut of the teaching-kit data (12 items × 3 factors, okul groups, N=800).
// Run: node test/catinv.test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildInp, requestedModels, maxLineLength, INV_SEQUENCE, isCategoricalInvariance, diffTestName } from '../js/syntax-generator.js';
import { createModelSpec, setItems, setFactorCount, validateSpec, thresholdCounts, thresholdReferents } from '../js/state.js';
import { buildWordHtml } from '../js/docx-export.js';
import { parseOut } from '../js/out-parser.js';
import { renderInvarianceTable } from '../js/apa-render.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };

// ---- spec: 12 five-category items × 3 factors, okul groups (the verification shape) ----
const items = ['duy1_t1', 'duy2_t1', 'duy3_t1', 'duy4_t1', 'psi1_t1', 'psi2_t1', 'psi3_t1', 'psi4_t1', 'sos1_t1', 'sos2_t1', 'sos3_t1', 'sos4_t1'];
// tiny matrix exercising the count-from-data path: every item shows values 1..5
const matrix = Array.from({ length: 5 }, (_, r) => [...items.map(() => String(r + 1)), String((r % 2) + 1)]);
const spec = createModelSpec({
  fileName: 'iyiolus-ord.dat', mplusFile: 'iyiolus-ord.dat', delimiter: 'whitespace', hasHeader: false,
  nCols: 13, nRows: 800, varNames: [...items, 'okul'], categorical: [...items], missingCode: null, _matrix: matrix,
});
setItems(spec, items);
setFactorCount(spec, 3);
items.forEach((it, idx) => { spec.target[it] = { F1: false, F2: false, F3: false, [`F${Math.floor(idx / 4) + 1}`]: true }; });
spec.estimator = 'WLSMV';
spec.rotation = { type: 'TARGET', oblique: true, epsilon: null };
spec.modelTypes = { cfa: false, esem: true, bifactorCfa: false, bifactorEsem: true };
spec.groups = { enabled: true, variable: 'okul', codes: [{ code: 1, label: 'okulA' }, { code: 2, label: 'okulB' }], invariance: { sequence: [...INV_SEQUENCE] } };

// ---- wiring ----
ok('isCategoricalInvariance: all items flagged → true', isCategoricalInvariance(spec) === true);
const models = requestedModels(spec);
ok('bifactor sequence generated for categorical too → 12 models (6 inv + 6 binv)', models.length === 12 && models.slice(0, 6).every((m) => m.key.startsWith('inv:')) && models.slice(6).every((m) => m.key.startsWith('binv:')), models.map((m) => m.key));
const warns = validateSpec(spec).warnings.join(' | ');
ok('validateSpec: DIFFTEST run-in-order warning', /DIFFTEST/.test(warns), warns);
ok('validateSpec: no "bifactor not generated" warning any more', !/not generated/.test(warns), warns);
{
  const mixed = { ...spec, data: { ...spec.data, categorical: items.slice(0, 6) } };
  ok('validateSpec: mixed categorical/continuous warning', /one scale type/.test(validateSpec(mixed).warnings.join(' ')));
  ok('isCategoricalInvariance: mixed → false (continuous template)', isCategoricalInvariance(mixed) === false);
}

// ---- configural: Millsap identification ----
const conf = buildInp(spec, 'inv:configural');
ok('configural: THETA parameterization', /PARAMETERIZATION = THETA;/.test(conf));
ok('configural: CATEGORICAL ARE ALL', /CATEGORICAL ARE ALL;/.test(conf));
ok('configural: WLSMV estimator', /ESTIMATOR IS WLSMV;/.test(conf));
ok('configural: partial thresholds — $1 of every item labelled', /\[duy2_t1\$1\] \(t5\);/.test(conf));
ok('configural: referent $2 labelled (duy1/psi1/sos1)', /\[duy1_t1\$2\] \(t2\);/.test(conf) && /\[psi1_t1\$2\] \(t18\);/.test(conf) && /\[sos1_t1\$2\] \(t34\);/.test(conf));
ok('configural: non-referent $2 unlabelled', /\[duy2_t1\$2\];/.test(conf));
ok('configural: group means FREE from the start', /MODEL okulB:[\s\S]*\[F1\*\]; \[F2\*\]; \[F3\*\];/.test(conf));
ok('configural: G1 uniquenesses @1, G2 free', /duy1_t1@1;/.test(conf) && /MODEL okulB:[\s\S]*duy1_t1\*;/.test(conf));
ok('configural: saves DIFFTEST derivatives', /SAVEDATA:\nDIFFTEST = Inv_diff_configural.dat;/.test(conf));
ok('configural: does NOT read a DIFFTEST file', !/ANALYSIS:[\s\S]*?DIFFTEST =[\s\S]*?MODEL:/.test(conf));
ok('configural: all lines ≤ 90 chars', maxLineLength(conf) <= 90, maxLineLength(conf));

// ---- chain + per-step constraints ----
const met = buildInp(spec, 'inv:metric');
ok('metric: reads configural derivatives', /DIFFTEST = Inv_diff_configural.dat;\nMODEL:/.test(met.replace(/ANALYSIS:[\s\S]*?(DIFFTEST)/, '$1')) || (/DIFFTEST = Inv_diff_configural.dat;/.test(met.split('MODEL:')[0])));
ok('metric: saves own derivatives', /DIFFTEST = Inv_diff_metric.dat;/.test(met.split('SAVEDATA:')[1] || ''));
ok('metric: group block has NO BY lines', (met.match(/F1 BY /g) || []).length === 1);
ok('metric: group variances freed', /MODEL okulB:[\s\S]*F1\*; F2\*; F3\*;/.test(met));
ok('metric: thresholds still partial', /\[duy2_t1\$2\];/.test(met));

const sca = buildInp(spec, 'inv:scalar');
ok('scalar: ALL thresholds labelled (t48 present)', /\(t48\);/.test(sca) && !/\[duy2_t1\$2\];/.test(sca));
ok('scalar: G2 uniquenesses still free', /MODEL okulB:[\s\S]*duy1_t1\*;/.test(sca));

const str = buildInp(spec, 'inv:strict');
ok('strict: G2 uniquenesses refixed @1', /MODEL okulB:[\s\S]*duy1_t1@1;/.test(str) && !/MODEL okulB:[\s\S]*duy1_t1\*;/.test(str));

const vc = buildInp(spec, 'inv:varcov');
ok('varcov: cov labels in BOTH groups (3 pairs × 2)', (vc.match(/\(cov\d+\);/g) || []).length === 6, (vc.match(/\(cov\d+\);/g) || []).length);
ok('varcov: G2 variances refixed @1', /MODEL okulB:[\s\S]*F1-F3@1;/.test(vc));

const lm = buildInp(spec, 'inv:latentmean');
ok('latentmean: G2 means refixed @0', /MODEL okulB:[\s\S]*\[F1-F3@0\];/.test(lm));
ok('latentmean: LAST step saves no derivatives', !/SAVEDATA:/.test(lm));
ok('latentmean: reads varcov derivatives', /DIFFTEST = Inv_diff_varcov.dat;/.test(lm));
ok('diffTestName helper', diffTestName('metric') === 'Inv_diff_metric.dat');
for (const s of INV_SEQUENCE) ok(`${s}: all lines ≤ 90 chars`, maxLineLength(buildInp(spec, `inv:${s}`)) <= 90);

// ---- bifactor-ESEM categorical chain (Morin T15/T42: one more second threshold, the G referent) ----
console.log('\n— bifactor-ESEM categorical (WLSMV/THETA) chain —');
const bconf = buildInp(spec, 'binv:configural');
ok('bconf: orthogonal TARGET + THETA + WLSMV + 100000 iterations', /ROTATION=TARGET\(ORTHOGONAL\);/.test(bconf) && /PARAMETERIZATION = THETA;/.test(bconf) && /ESTIMATOR IS WLSMV;/.test(bconf) && /ITERATIONS = 100000;/.test(bconf));
ok('bconf: G block on all items + 3 target blocks, in BOTH groups', (bconf.match(/^G BY /gm) || []).length === 2 && (bconf.match(/^F[123] BY /gm) || []).length === 6, [(bconf.match(/^G BY /gm) || []).length, (bconf.match(/^F[123] BY /gm) || []).length]);
ok('bconf: S referents $2 labelled (duy1 t2 / psi1 t18 / sos1 t34)', /\[duy1_t1\$2\] \(t2\);/.test(bconf) && /\[psi1_t1\$2\] \(t18\);/.test(bconf) && /\[sos1_t1\$2\] \(t34\);/.test(bconf));
ok('bconf: G referent = next item (duy2) → its $2 labelled (t6)', /\[duy2_t1\$2\] \(t6\);/.test(bconf));
ok('bconf: other $2 thresholds unlabelled (duy3)', /\[duy3_t1\$2\];/.test(bconf));
ok('bconf: group 1 uniq @1, group 2 uniq free + means free incl. G', /duy1_t1@1;/.test(bconf) && /MODEL okulB:[\s\S]*duy1_t1\*;/.test(bconf) && /MODEL okulB:[\s\S]*\[G\*\]; \[F1\*\]; \[F2\*\]; \[F3\*\];/.test(bconf));
ok('bconf: saves BifactorInv_diff_configural.dat (own chain), reads nothing', /SAVEDATA:\nDIFFTEST = BifactorInv_diff_configural.dat;/.test(bconf) && !/DIFFTEST = /.test(bconf.split('MODEL:')[0]));
const bmet = buildInp(spec, 'binv:metric');
ok('bmet: reads BifactorInv_diff_configural.dat; group block has no BY; G*; F1*; …', /DIFFTEST = BifactorInv_diff_configural.dat;/.test(bmet.split('MODEL:')[0]) && (bmet.match(/^G BY /gm) || []).length === 1 && /MODEL okulB:[\s\S]*G\*; F1\*; F2\*; F3\*;/.test(bmet));
ok('bmet: thresholds still partial (duy3 $2 unlabelled)', /\[duy3_t1\$2\];/.test(bmet));
const bsca = buildInp(spec, 'binv:scalar');
ok('bsca: all 48 thresholds labelled', /\(t48\);/.test(bsca) && !/\[duy3_t1\$2\];/.test(bsca));
const bstr = buildInp(spec, 'binv:strict');
ok('bstr: group 2 uniquenesses refixed @1', /MODEL okulB:[\s\S]*duy1_t1@1;/.test(bstr) && !/MODEL okulB:[\s\S]*duy1_t1\*;/.test(bstr));
const bvc = buildInp(spec, 'binv:varcov');
ok('bvc: 6 covariance labels (G pairs included) × 2 groups; group 2 variances refixed', (bvc.match(/\(cov\d+\);/g) || []).length === 12 && /MODEL okulB:[\s\S]*G@1; F1-F3@1;/.test(bvc), (bvc.match(/\(cov\d+\);/g) || []).length);
const blm = buildInp(spec, 'binv:latentmean');
ok('blm: group 2 means refixed @0; no SAVEDATA; reads varcov derivatives', /MODEL okulB:[\s\S]*\[G@0\]; \[F1-F3@0\];/.test(blm) && !/SAVEDATA:/.test(blm) && /DIFFTEST = BifactorInv_diff_varcov.dat;/.test(blm));
ok('bifactor chain never touches the ESEM chain\'s Inv_diff files', ![bconf, bmet, bsca, bstr, bvc, blm].some((t) => /[^r]Inv_diff_/.test(t)));
ok('diffTestName prefix', diffTestName('metric', 'BifactorInv') === 'BifactorInv_diff_metric.dat' && diffTestName('metric') === 'Inv_diff_metric.dat');
for (const s of INV_SEQUENCE) ok(`binv:${s}: all lines ≤ 90 chars`, maxLineLength(buildInp(spec, `binv:${s}`)) <= 90, maxLineLength(buildInp(spec, `binv:${s}`)));

// ---- real Mplus fixtures (identical to De Beer & Morin's categorical generator, 6/6) ----
const EXPECT = [
  ['mg_cat_1_configural.out', 89.177, 66, null],
  ['mg_cat_2_metric.out', 109.419, 93, { d: 29.937, ddf: 27 }],
  ['mg_cat_3_scalar.out', 156.324, 126, { d: 47.140, ddf: 33 }],
  ['mg_cat_4_strict.out', 167.262, 138, { d: 12.338, ddf: 12 }],
  ['mg_cat_5_varcov.out', 156.587, 144, { d: 5.347, ddf: 6 }],
  ['mg_cat_6_latentmean.out', 404.691, 147, { d: 76.426, ddf: 3 }],
];
const parsedFx = [];
for (const [file, chi2, df, diff] of EXPECT) {
  const p = parseOut(fx(file));
  parsedFx.push({ label: file.replace(/^mg_cat_\d_|\.out$/g, ''), parsed: p });
  const okDiff = diff == null ? p.diffTest == null
    : p.diffTest && Math.abs(p.diffTest.chi2 - diff.d) < 0.01 && p.diffTest.df === diff.ddf && p.diffTest.p != null;
  ok(`${file}: χ²(${df})=${chi2} + WLSMV + DIFFTEST ${diff ? `Δχ²(${diff.ddf})=${diff.d}` : 'absent'}`,
    Math.abs(p.fit.chi2 - chi2) < 0.01 && p.fit.df === df && p.estimator === 'WLSMV' && (p.nGroups || 1) > 1 && okDiff,
    { chi2: p.fit.chi2, df: p.fit.df, est: p.estimator, diff: p.diffTest });
}

// ---- real Mplus 8.3 fixtures: the bifactor-ESEM categorical chain (same spec; ordinal data rebuilt from
// iyiolus.dat with z-cuts at ±0.5/±1.5). The free-parameter counts pin the identification: 180 → 148
// (−42 equated loadings, +4 group-2 variances, +6 group-2 covariances that the orthogonal rotation frees
// once loadings are equal) → 116 (−32 thresholds: 48 minus the 16 equated from configural on) → 104
// (−12 uniquenesses) → 94 (−4 variances, −6 covariances) → 90 (−4 latent means).
console.log('\n— bifactor-ESEM categorical chain: real Mplus fixtures —');
const BEXPECT = [
  ['mg_bcat_1_configural.out', 55.833, 48, 180, null],
  ['mg_bcat_2_metric.out', 83.374, 80, 148, { d: 33.250, ddf: 32 }],
  ['mg_bcat_3_scalar.out', 120.563, 112, 116, { d: 38.960, ddf: 32 }],
  ['mg_bcat_4_strict.out', 131.278, 124, 104, { d: 11.272, ddf: 12 }],
  ['mg_bcat_5_varcov.out', 134.668, 134, 94, { d: 9.429, ddf: 10 }],
  ['mg_bcat_6_latentmean.out', 367.735, 138, 90, { d: 87.509, ddf: 4 }],
];
for (const [file, chi2, df, npar, diff] of BEXPECT) {
  const p = parseOut(fx(file));
  const okDiff = diff == null ? p.diffTest == null
    : p.diffTest && Math.abs(p.diffTest.chi2 - diff.d) < 0.01 && p.diffTest.df === diff.ddf && p.diffTest.p != null;
  ok(`${file}: χ²(${df})=${chi2}, ${npar} free parameters, bifactor title, WLSMV, DIFFTEST ${diff ? `Δχ²(${diff.ddf})=${diff.d}` : 'absent'}`,
    Math.abs(p.fit.chi2 - chi2) < 0.01 && p.fit.df === df && p.nFreeParams === npar && /bifactor-ESEM/i.test(p.title || '') && p.estimator === 'WLSMV' && (p.nGroups || 1) === 2 && okDiff,
    { chi2: p.fit.chi2, df: p.fit.df, npar: p.nFreeParams, title: p.title, est: p.estimator, diff: p.diffTest });
}

// ---- threshold referents: eligibility (binary items have no second threshold) and distinctness ----
console.log('\n— threshold referents —');
{
  const bin = { ...spec, data: { ...spec.data, nCats: { duy1_t1: 2, duy2_t1: 2 } } }; // first two items binary
  const c = buildInp(bin, 'inv:configural');
  ok('binary duy1 → F1 referent moves to duy3 ($2 = t4); duy1/duy2 keep a single labelled $1', /\[duy3_t1\$2\] \(t4\);/.test(c) && /\[duy1_t1\$1\] \(t1\); \[duy2_t1\$1\] \(t2\);/.test(c) && !/duy1_t1\$2|duy2_t1\$2/.test(c), c.split('\n').filter((l) => /\$/.test(l)).slice(0, 2));
  const b = buildInp(bin, 'binv:configural');
  ok('binary duy1/duy2 → S referent duy3 (t4), G referent duy4 (t8), psi2 $2 unlabelled', /\[duy3_t1\$2\] \(t4\);/.test(b) && /\[duy4_t1\$2\] \(t8\);/.test(b) && /\[psi2_t1\$2\];/.test(b));
  ok('still identified → no validation error', validateSpec(bin).errors.length === 0, validateSpec(bin).errors);
  const r = thresholdReferents(bin, thresholdCounts(bin), { general: true });
  ok('thresholdReferents: F1→duy3, F2→psi1, G→duy4, nothing missing', r.byFactor.F1 === 'duy3_t1' && r.byFactor.F2 === 'psi1_t1' && r.gRef === 'duy4_t1' && r.missing.length === 0, r);
  const allBin = { ...spec, data: { ...spec.data, nCats: Object.fromEntries(['duy1_t1', 'duy2_t1', 'duy3_t1', 'duy4_t1'].map((it) => [it, 2])) } };
  ok('a factor with only binary items → validateSpec error naming it', validateSpec(allBin).errors.some((e) => /three response categories/.test(e) && /F1/.test(e)), validateSpec(allBin).errors);
  const gOnly = { ...spec, data: { ...spec.data, nCats: Object.fromEntries(['duy2_t1', 'duy3_t1', 'duy4_t1', 'psi2_t1', 'psi3_t1', 'psi4_t1', 'sos2_t1', 'sos3_t1', 'sos4_t1'].map((it) => [it, 2])) } };
  ok('only the G referent missing (bifactor-ESEM checked) → error names the general factor', validateSpec(gOnly).errors.some((e) => /general factor/.test(e)), validateSpec(gOnly).errors);
  ok('…and no error once bifactor-ESEM is unchecked', validateSpec({ ...gOnly, modelTypes: { ...spec.modelTypes, bifactorEsem: false } }).errors.length === 0);
  const shared = JSON.parse(JSON.stringify(spec)); shared.target.duy1_t1.F2 = true; // duy1 is a main item of F1 AND F2
  const sc = buildInp(shared, 'inv:configural');
  ok('shared main item → distinct referents (F2 takes psi1, not duy1 twice)', /\[duy1_t1\$2\] \(t2\);/.test(sc) && /\[psi1_t1\$2\] \(t18\);/.test(sc));
}

// ---- partial sequences, three groups, shared OUTPUT line, renderer + Word export over both chains ----
console.log('\n— partial sequence / 3 groups / OUTPUT / renderers —');
{
  const part = { ...spec, groups: { ...spec.groups, invariance: { sequence: ['configural', 'scalar', 'latentmean'] } } };
  const ps = buildInp(part, 'binv:scalar'), pl = buildInp(part, 'binv:latentmean');
  ok('partial sequence: scalar reads the configural derivatives and saves its own', /DIFFTEST = BifactorInv_diff_configural.dat;/.test(ps.split('MODEL:')[0]) && /SAVEDATA:\nDIFFTEST = BifactorInv_diff_scalar.dat;/.test(ps));
  ok('partial sequence: latentmean reads the scalar derivatives, saves none', /DIFFTEST = BifactorInv_diff_scalar.dat;/.test(pl.split('MODEL:')[0]) && !/SAVEDATA:/.test(pl));
  const three = { ...spec, groups: { ...spec.groups, codes: [{ code: 1, label: 'okulA' }, { code: 2, label: 'okulB' }, { code: 3, label: 'okulC' }] } };
  const tc = buildInp(three, 'binv:configural');
  ok('three groups: two group sections, each with the bifactor block and free uniquenesses', (tc.match(/^MODEL okul[BC]:/gm) || []).length === 2 && (tc.match(/^G BY /gm) || []).length === 3 && (tc.match(/^duy1_t1\*;/gm) || []).length === 2);
  ok('three groups: every binv step ≤ 90 chars/line', INV_SEQUENCE.every((s) => maxLineLength(buildInp(three, `binv:${s}`)) <= 90));
  const OUT = 'OUTPUT:\nSAMPSTAT STANDARDIZED MODINDICES CINTERVAL RESIDUAL SVALUES TECH1 TECH3 TECH4;';
  ok('both categorical chains request the shared OUTPUT line', buildInp(spec, 'inv:configural').includes(OUT) && buildInp(spec, 'binv:configural').includes(OUT));
  const bfx = BEXPECT.map(([file]) => { const p = parseOut(fx(file)); return { label: p.invStep || file, parsed: p }; });
  ok('parser: every bifactor fixture carries its step name from the TITLE', bfx.map((m) => m.label).join('|') === 'Configural|Metric (loadings)|Scalar (intercepts)|Strict (residuals)|Factor var/cov|Latent means', bfx.map((m) => m.label));
  const bhtml = renderInvarianceTable(bfx);
  ok('renderer: bifactor chain rows labelled by step', />Configural</.test(bhtml) && />Metric \(loadings\)</.test(bhtml) && />Latent means</.test(bhtml));
  ok('renderer: DIFFTEST Δχ² 33.25 (32) on the metric row', /<td>33.25<\/td><td>32<\/td>/.test(bhtml));
  const both = [...parsedFx.map((m) => ({ ...m, label: m.parsed.invStep || m.label })), ...bfx];
  const word = buildWordHtml(both);
  ok('Word export: one invariance table per MG family, each labelled', (word.match(/Tests of measurement invariance/g) || []).length === 2 && /\(first-order ESEM\)/.test(word) && /\(bifactor-ESEM\)/.test(word));
  const firstTbl = word.slice(word.indexOf('(first-order ESEM)'), word.indexOf('(bifactor-ESEM)'));
  ok('Word export: the first-order table holds exactly its 6 rows (header + 6)', (firstTbl.match(/<tr>/g) || []).length === 7, (firstTbl.match(/<tr>/g) || []).length);
  ok('Word export: a single family keeps the plain title', (buildWordHtml(bfx).match(/Tests of measurement invariance(?! \()/g) || []).length === 1);
}

// ---- renderer: WLSMV guard uses DIFFTEST, not Satorra–Bentler ----
const html = renderInvarianceTable(parsedFx);
ok('table: DIFFTEST note (no SB) for WLSMV', /DIFFTEST/.test(html) && !/Satorra/.test(html));
ok('table: Δχ² header unscaled', /<th>Δχ²<\/th>/.test(html) && !/Δχ²\(s\)/.test(html));
ok('table: metric row shows DIFFTEST Δχ²=29.94 (n.s.)', /<td>29.94<\/td><td>27<\/td>/.test(html));
ok('table: latentmean Δχ²=76.43* (p<.05 star)', /<td>76.43\*<\/td><td>3<\/td>/.test(html));
{
  const broken = parsedFx.map((m, i) => (i === 2 ? { ...m, parsed: { ...m.parsed, diffTest: null } } : m));
  const h2 = renderInvarianceTable(broken);
  ok('table: broken chain → dash + run-in-order note', /Missing Δχ² values/.test(h2));
}

console.log(`\ncatinv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
