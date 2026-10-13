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
ok('groups on + besem checked → 3 total-sample models + 6 inv + 6 binv = 15', models.length === 15 && models.slice(0, 3).map((m) => m.key).join() === 'cfa,esem,bifactorEsem', models.map((m) => m.key));
ok('binv files named BifactorInv_N_step', models.filter((m) => m.key.startsWith('binv:')).every((m, i) => m.file === `BifactorInv_${i + 1}_${INV_SEQUENCE[i]}.inp`), models.map((m) => m.file));
const specNoB = { ...spec, modelTypes: { ...spec.modelTypes, bifactorEsem: false } };
ok('besem unchecked → cfa + esem + 6 inv = 8 models', requestedModels(specNoB).length === 8, requestedModels(specNoB).length);

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

console.log(`\nmginv.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
