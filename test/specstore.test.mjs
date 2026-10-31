// specstore.test.mjs — saving and restoring a model specification (js/spec-store.js): the sketch survives a
// return to the Data step, a reload (localStorage) and a .json round trip, and unknown columns are dropped.
// Run: node test/specstore.test.mjs
import { createModelSpec, setItems, setFactorCount, setWaveItems, toggleTarget, validateSpec } from '../js/state.js';
import { serializeSpec, applySavedSpec, specSignature, storageKey, SPEC_FORMAT } from '../js/spec-store.js';
import { requestedModels, buildInp } from '../js/syntax-generator.js';

let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };
const seq = (pre, n, suf = '') => Array.from({ length: n }, (_, i) => `${pre}${i + 1}${suf}`);
const mkData = (names, extra = {}) => ({ fileName: 'study.csv', delimiter: 'comma', hasHeader: true, nCols: names.length, nRows: 500, varNames: names, categorical: [], missingCode: null, ...extra });

console.log('— serialize / apply round trip —');
{
  const names = ['id', ...seq('m', 18), 'sex', 'age'];
  const spec = createModelSpec(mkData(names));
  setItems(spec, seq('m', 18)); setFactorCount(spec, 6);
  const ids = spec.factors.map((f) => f.id);
  for (const it of seq('m', 18)) spec.target[it] = {};
  seq('m', 18).forEach((it, i) => { spec.target[it][ids[Math.floor(i / 3)]] = true; });
  spec.factors[0].label = 'Vigor'; spec.factors[5].label = 'Absorption';
  spec.rotation = { type: 'TARGET', oblique: true, epsilon: null };
  spec.estimator = 'WLSMV';
  spec.modelTypes = { cfa: false, esem: true, bifactorCfa: true, bifactorEsem: true };
  spec.groups.enabled = true; spec.groups.variable = 'sex'; spec.groups.codes = [{ code: 1, label: 'women' }, { code: 2, label: 'men' }];
  spec.groups.invariance.sequence = ['configural', 'metric', 'scalar'];
  spec.aids = { convergence: true, convergenceValue: 0.005, positiveResiduals: ['m3', 'm7'] };
  const saved = JSON.parse(JSON.stringify(serializeSpec(spec)));
  ok('serialized: format, file, columns, no data matrix', saved.format === SPEC_FORMAT && saved.file === 'study.csv' && saved.columns.length === 21 && !('_matrix' in saved) && saved.app === 'ESEM Analyzer', Object.keys(saved));
  const fresh = createModelSpec(mkData(names));
  const r = applySavedSpec(fresh, saved);
  ok('applied: items, factor count, labels', r.ok && fresh.items.join() === seq('m', 18).join() && fresh.factors.length === 6 && fresh.factors[0].label === 'Vigor' && fresh.factors[5].label === 'Absorption', [r, fresh.items.length, fresh.factors.map((f) => f.label)]);
  ok('applied: the target pattern', fresh.target.m1.F1 === true && fresh.target.m18.F6 === true && !fresh.target.m1.F2, fresh.target.m1);
  ok('applied: rotation, estimator, model types, groups, aids', fresh.rotation.type === 'TARGET' && fresh.estimator === 'WLSMV' && fresh.modelTypes.bifactorCfa === true && fresh.modelTypes.cfa === false && fresh.groups.enabled && fresh.groups.variable === 'sex' && fresh.groups.codes.length === 2 && fresh.groups.invariance.sequence.join() === 'configural,metric,scalar' && fresh.aids.convergence === true && fresh.aids.positiveResiduals.join() === 'm3,m7', [fresh.rotation, fresh.estimator, fresh.groups, fresh.aids]);
  ok('applied spec generates the same syntax as the original', buildInp(fresh, 'esem') === buildInp(spec, 'esem') && requestedModels(fresh).map((m) => m.key).join() === requestedModels(spec).map((m) => m.key).join());
  ok('nothing dropped, validation unchanged', r.dropped.length === 0 && validateSpec(fresh).errors.join() === validateSpec(spec).errors.join(), r.dropped);
  // the same sketch on a file that lacks two items and the grouping variable
  const narrow = createModelSpec(mkData(['id', ...seq('m', 16), 'age']));
  const r2 = applySavedSpec(narrow, saved);
  ok('unknown columns dropped (m17, m18, sex, residual aid stays within known items), grouping switched off', r2.ok && narrow.items.length === 16 && r2.dropped.join() === 'm17,m18,sex' && narrow.groups.enabled === false && narrow.groups.variable === null && narrow.aids.positiveResiduals.join() === 'm3,m7', [r2, narrow.groups]);
  ok('factor count clamped to the kept items', narrow.factors.length === 6 && narrow.target.m16.F6 === true, [narrow.factors.length, narrow.target.m16]);
  ok('a foreign or malformed file is refused', applySavedSpec(createModelSpec(mkData(names)), { format: 99, items: ['m1'] }).ok === false && applySavedSpec(createModelSpec(mkData(names)), null).ok === false && applySavedSpec(createModelSpec(mkData(names)), { format: SPEC_FORMAT, items: ['zz1', 'zz2'] }).ok === false);
  // withData: the saved flags reach the data; without it the data's flags win
  const d3 = mkData(names, { categorical: ['m1'], missingCode: '-9' });
  const s3 = createModelSpec(d3);
  const savedCat = { ...saved, categorical: seq('m', 18), missingCode: '999' };
  applySavedSpec(s3, savedCat);
  ok('without withData the data keeps its own categorical flags and missing code', d3.categorical.join() === 'm1' && d3.missingCode === '-9');
  applySavedSpec(s3, savedCat, { withData: true });
  ok('withData applies the saved flags as one choice for every column (ordinal, WLSMV) and the missing code', d3.ordinal === true && d3.categorical.length === names.length && s3.estimator === 'WLSMV' && d3.missingCode === '999', [d3.categorical.length, d3.missingCode, s3.estimator]);
}

console.log('\n— time mode and signatures —');
{
  const names = ['id', ...seq('x', 6, '_t1'), ...seq('x', 6, '_t2')];
  const spec = createModelSpec(mkData(names));
  spec.longitudinal.enabled = true; setWaveItems(spec, 0, seq('x', 6, '_t1')); setWaveItems(spec, 1, seq('x', 6, '_t2')); setFactorCount(spec, 2);
  spec.longitudinal.waveLabels = ['Baseline', 'Follow-up']; spec.longitudinal.correlatedUniqueness = false;
  const saved = JSON.parse(JSON.stringify(serializeSpec(spec)));
  const fresh = createModelSpec(mkData(names));
  const r = applySavedSpec(fresh, saved);
  ok('longitudinal waves, labels and the CU switch restored; items = Time 1', r.ok && fresh.longitudinal.enabled && fresh.longitudinal.waves[0].join() === seq('x', 6, '_t1').join() && fresh.longitudinal.waves[1].join() === seq('x', 6, '_t2').join() && fresh.longitudinal.waveLabels[1] === 'Follow-up' && fresh.longitudinal.correlatedUniqueness === false && fresh.items.join() === seq('x', 6, '_t1').join(), [fresh.longitudinal, fresh.items]);
  ok('restored longitudinal spec builds the same chain', buildInp(fresh, 'linv:esem:metric') === buildInp(spec, 'linv:esem:metric'));
  ok('signature = the column list; the storage key changes with the file name or the columns', specSignature(mkData(names)) === names.join('\u0001') && storageKey(mkData(names)) === storageKey(mkData(names)) && storageKey(mkData(names)) !== storageKey(mkData(names, { fileName: 'other.csv' })) && storageKey(mkData(names)) !== storageKey(mkData([...names, 'z'])) && /^esem-analyzer\.spec\.[0-9a-z]+$/.test(storageKey(mkData(names))), storageKey(mkData(names)));
}

console.log(`\nspecstore.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
