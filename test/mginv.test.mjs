// mginv.test.mjs — multi-group bifactor-ESEM invariance (binv:) generator + real-Mplus fixtures.
// The generator was cross-validated against De Beer & Morin's (B)ESEM syntax generator
// (statstools.app/b_esem): identical npar/df/χ² at every step in real Mplus 8.3 runs.
// Fixtures mg_besem_*.out are OUR generated syntax run on the teaching-kit data
// (12 items × 3 factors, okul groups, N=800). Run: node test/mginv.test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildInp, requestedModels, maxLineLength, INV_SEQUENCE } from '../js/syntax-generator.js';
import { createModelSpec, setItems, setFactorCount } from '../js/state.js';
import { parseOut } from '../js/out-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };

// ---- spec: 15 items × 3 factors, gender groups (the example-dataset shape) ----
const items = Array.from({ length: 15 }, (_, i) => `i${i + 1}`);
const spec = createModelSpec({
  fileName: 'data.dat', delimiter: 'whitespace', hasHeader: false, nCols: 16, nRows: 600,
  varNames: [...items, 'gender'], categorical: [], missingCode: null,
});
setItems(spec, items);
setFactorCount(spec, 3);
items.forEach((it, idx) => { spec.target[it] = { F1: false, F2: false, F3: false, [`F${Math.floor(idx / 5) + 1}`]: true }; });
spec.modelTypes = { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: true };
spec.groups = { enabled: true, variable: 'gender', codes: [{ code: 1, label: 'men' }, { code: 2, label: 'women' }], invariance: { sequence: [...INV_SEQUENCE] } };

// ---- requestedModels wiring ----
const models = requestedModels(spec);
ok('groups on + cfa, esem, besem checked → 3 total-sample models + 6 cinv + 6 inv + 6 binv = 21', models.length === 21 && models.slice(0, 3).map((m) => m.key).join() === 'cfa,esem,bifactorEsem' && models.filter((m) => m.key.startsWith('cinv:')).length === 6, models.map((m) => m.key));
ok('binv files named BifactorInv_N_step', models.filter((m) => m.key.startsWith('binv:')).every((m, i) => m.file === `BifactorInv_${i + 1}_${INV_SEQUENCE[i]}.inp`), models.map((m) => m.file));
const specNoB = { ...spec, modelTypes: { ...spec.modelTypes, bifactorEsem: false } };
ok('besem unchecked → cfa + esem + 6 cinv + 6 inv = 14 models', requestedModels(specNoB).length === 14, requestedModels(specNoB).length);

// ---- configural ----
const conf = buildInp(spec, 'binv:configural');
ok('configural: TARGET(ORTHOGONAL) rotation', /ROTATION=TARGET\(ORTHOGONAL\);/.test(conf));
ok('configural: ITERATIONS = 100000', /ITERATIONS = 100000;/.test(conf));
ok('configural: G BY all items in one ESEM set', /G BY i1 i2 i3 i4 i5 i6 i7 i8 i9 i10 i11 i12 i13 i14 i15 \(\*1\);/.test(conf));
ok('configural: per-factor target block with ~0', /F2 BY i1~0 i2~0 i3~0 i4~0 i5~0 i6 i7 i8 i9 i10 i11~0/.test(conf));
ok('configural: variances fixed incl G', conf.includes('G@1; F1-F3@1;'));
ok('configural: means fixed incl G', conf.includes('[G@0]; [F1-F3@0];'));
ok('configural: group section repeats the BY blocks', (conf.match(/G BY /g) || []).length === 2, (conf.match(/G BY /g) || []).length);
ok('configural: all lines ≤ 90 chars', maxLineLength(conf) <= 90, maxLineLength(conf));

// ---- metric: loadings equal by omission, variances freed ----
const met = buildInp(spec, 'binv:metric');
ok('metric: group block has NO BY lines', (met.match(/G BY /g) || []).length === 1);
ok('metric: group frees all variances incl G', /MODEL women:[\s\S]*G\*; F1\*; F2\*; F3\*;/.test(met));
ok('metric: group means stay fixed', /MODEL women:[\s\S]*\[G@0\]; \[F1-F3@0\];/.test(met));

// ---- scalar: i# labels, group means freed ----
const sca = buildInp(spec, 'binv:scalar');
ok('scalar: intercept labels i1-i15 present', /\(i1-i\d+\)/.test(sca));
ok('scalar: group means freed incl G', /MODEL women:[\s\S]*\[G\*\]; \[F1\*\]; \[F2\*\]; \[F3\*\];/.test(sca));

// ---- varcov: covariances equated incl. G pairs, group variances refixed ----
const vc = buildInp(spec, 'binv:varcov');
ok('varcov: 6 cov labels for 4 factors (G+3)', (vc.match(/\(cov\d+\);/g) || []).length === 12, (vc.match(/\(cov\d+\);/g) || []).length); // 6 pairs × 2 groups
ok('varcov: G WITH F1 labelled', /G WITH F1 \(cov1\);/.test(vc));
ok('varcov: group refixes variances', /MODEL women:[\s\S]*G@1; F1-F3@1;/.test(vc));

// ---- latent means: group means refixed ----
const lm = buildInp(spec, 'binv:latentmean');
ok('latentmean: group means refixed @0', /MODEL women:[\s\S]*\[G@0\]; \[F1-F3@0\];/.test(lm));

// ---- real Mplus fixtures (teaching-kit data; identical to De Beer & Morin's generator) ----
const EXPECT = [
  ['mg_besem_1_configural.out', 75.34, 48], ['mg_besem_2_metric.out', 98.50, 80],
  ['mg_besem_3_scalar.out', 101.51, 88], ['mg_besem_4_strict.out', 114.36, 100],
  ['mg_besem_5_varcov.out', 127.31, 110], ['mg_besem_6_latentmean.out', 187.66, 114],
];
for (const [file, chi2, df] of EXPECT) {
  const p = parseOut(fx(file));
  ok(`${file}: χ²(${df})=${chi2} parsed + 2 groups + bifactor title`,
    Math.abs(p.fit.chi2 - chi2) < 0.01 && p.fit.df === df && (p.nGroups || 1) > 1 && /bifactor-ESEM/i.test(p.title || ''),
    { chi2: p.fit.chi2, df: p.fit.df, n: p.nGroups, t: p.title });
}

console.log('\n— CFA and bifactor-CFA multi-group chains (cinv:/bcinv:) —');
{
  const four = { ...spec, modelTypes: { cfa: true, esem: true, bifactorCfa: true, bifactorEsem: true } };
  const ms = requestedModels(four);
  ok('all four checked → 4 total-sample models + 4 chains × 6 = 28', ms.length === 28 && ['cinv', 'inv', 'bcinv', 'binv'].every((p) => ms.filter((m) => m.key.startsWith(p + ':')).length === 6), ms.map((m) => m.key));
  ok('chains follow the model order: CFA, ESEM, bifactor-CFA, bifactor-ESEM', ms.slice(4).map((m) => m.key.split(':')[0]).join() === ['cinv', 'inv', 'bcinv', 'binv'].flatMap((p) => Array(6).fill(p)).join());
  ok('files CfaInv_N_step / BifactorCfaInv_N_step', ms.filter((m) => m.key.startsWith('cinv:')).every((m, i) => m.file === `CfaInv_${i + 1}_${INV_SEQUENCE[i]}.inp`) && ms.filter((m) => m.key.startsWith('bcinv:')).every((m, i) => m.file === `BifactorCfaInv_${i + 1}_${INV_SEQUENCE[i]}.inp`), ms.map((m) => m.file));
  ok('labels name the model when several chains exist (ESEM included); modelType set', ms.filter((m) => m.step).every((m) => /^(CFA|ESEM|Bifactor-CFA|Bifactor-ESEM) · /.test(m.label) && ['cfa', 'esem', 'bcfa', 'besem'].includes(m.modelType)), ms.filter((m) => m.step).map((m) => m.label));
  const esemOnly = requestedModels({ ...spec, modelTypes: { cfa: false, esem: true, bifactorCfa: false, bifactorEsem: false } });
  ok('ESEM alone keeps the bare step labels', esemOnly.length === 7 && esemOnly.slice(1).every((m) => m.key.startsWith('inv:') && !/ · /.test(m.label)), esemOnly.map((m) => m.label));
  const none = requestedModels({ ...spec, modelTypes: { cfa: false, esem: false, bifactorCfa: false, bifactorEsem: false } });
  ok('nothing checked → the ESEM chain alone', none.length === 6 && none.every((m) => m.key.startsWith('inv:')), none.map((m) => m.key));
  const cc = buildInp(spec, 'cinv:configural'), cm = buildInp(spec, 'cinv:metric'), cs = buildInp(spec, 'cinv:scalar'), cv = buildInp(spec, 'cinv:varcov'), cl = buildInp(spec, 'cinv:latentmean');
  ok('CFA configural: BY lines repeated per group (loadings free), variances @1, means @0, no rotation', (cc.match(/F1 BY i1\* i2 i3 i4 i5;/g) || []).length === 2 && (cc.match(/F1-F3@1;/g) || []).length === 2 && (cc.match(/\[F1-F3@0\];/g) || []).length === 2 && !/ROTATION|\(\*1\)/.test(cc) && /MG invariance \(CFA\) - Configural/.test(cc), cc);
  ok('CFA metric: BY omitted in the group, variances freed', (cm.match(/F1 BY i1\*/g) || []).length === 1 && /MODEL women:\nF1\*; F2\*; F3\*;/.test(cm), cm);
  ok('CFA scalar: labelled intercepts in both sections, group means freed', (cs.match(/\(i1-i15\)/g) || []).length === 2 && /\[F1\*\]; \[F2\*\]; \[F3\*\];/.test(cs), cs);
  ok('CFA varcov: covariances equated, group variances refixed', (cv.match(/F1 WITH F2 \(cov1\);/g) || []).length === 2 && /F2 WITH F3 \(cov3\);/.test(cv) && /MODEL women:\nF1-F3@1;/.test(cv), cv);
  const clg = cl.split('MODEL women:')[1] || '';
  ok('CFA latent means: group means refixed with variances and covariances held', /F1-F3@1;/.test(clg) && /\[F1-F3@0\];/.test(clg) && /\(cov1\)/.test(clg) && /\(i1-i15\)/.test(clg) && /\(u1-u15\)/.test(clg), clg);
  for (const s of INV_SEQUENCE) ok(`cinv:${s}: all lines ≤ 90 chars`, maxLineLength(buildInp(spec, `cinv:${s}`)) <= 90);
  const bc = buildInp(spec, 'bcinv:configural'), bm = buildInp(spec, 'bcinv:metric'), bv = buildInp(spec, 'bcinv:varcov'), bl = buildInp(spec, 'bcinv:latentmean');
  ok('bifactor-CFA configural: G on every item + specific factors, all orthogonal, in both sections', (bc.match(/G BY i1\* i2 /g) || []).length === 2 && (bc.match(/G WITH F1@0 F2@0 F3@0;/g) || []).length === 2 && (bc.match(/F1 WITH F2@0 F3@0;/g) || []).length === 2 && /G@1; F1-F3@1;/.test(bc) && /\[G@0\]; \[F1-F3@0\];/.test(bc) && /MG invariance \(bifactor-CFA\) - Configural/.test(bc), bc);
  ok('bifactor-CFA metric: G and specific variances freed in the group, BY omitted', /MODEL women:\nG\*; F1\*; F2\*; F3\*;/.test(bm) && (bm.match(/G BY/g) || []).length === 1, bm);
  ok('bifactor-CFA varcov: no covariance labels (orthogonal), variances refixed, means free', !/\(cov/.test(bv) && /MODEL women:\nG@1; F1-F3@1;\n\[G\*\]; \[F1\*\]; \[F2\*\]; \[F3\*\];/.test(bv), bv);
  ok('bifactor-CFA latent means: G and specific means refixed', /MODEL women:\nG@1; F1-F3@1;\n\[G@0\]; \[F1-F3@0\];/.test(bl), bl);
  for (const s of INV_SEQUENCE) ok(`bcinv:${s}: all lines ≤ 90 chars`, maxLineLength(buildInp(spec, `bcinv:${s}`)) <= 90);
  // real Mplus 8.3 runs of these chains on the simulated 12-item / 3-factor / 2-group data
  const c1 = parseOut(fx('mg_cfa_configural.out')), c2 = parseOut(fx('mg_cfa_metric.out'));
  ok('fixture: CFA chain titles → multigroup / cfa / step, 2 groups', c1.invKind === 'multigroup' && c1.invModel === 'cfa' && c1.invStep === 'Configural' && c2.invStep === 'Metric (loadings)' && c1.nGroups === 2, [c1.invKind, c1.invModel, c1.invStep, c2.invStep, c1.nGroups]);
  ok('fixture: CFA df 102 → 111 (+p−k = 9 loading constraints)', c1.fit.df === 102 && c2.fit.df === 111, [c1.fit.df, c2.fit.df]);
  const b1 = parseOut(fx('mg_bcfa_configural.out')), b3 = parseOut(fx('mg_bcfa_scalar.out'));
  ok('fixture: bifactor-CFA chain titles → multigroup / bcfa', b1.invModel === 'bcfa' && b1.invStep === 'Configural' && b3.invStep === 'Scalar (intercepts)', [b1.invModel, b1.invStep, b3.invStep]);
  ok('fixture: bifactor-CFA df 84 → 112 (metric +20 = 2p−(k+1), scalar +8 = p−(k+1))', b1.fit.df === 84 && b3.fit.df === 112, [b1.fit.df, b3.fit.df]);
}

console.log(`\nmginv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
