// aids.test.mjs — convergence aids (Morin, Hoyle ch. 27): CONVERGENCE line + residual positivity.
// Run: node test/aids.test.mjs
import { createModelSpec, setWaveItems, setFactorCount, validateSpec, DEFAULT_OUTPUT_LINE, setItems, setOrdinal, setPartial, setSkipped } from '../js/state.js';
import { buildInp, maxLineLength, INV_SEQUENCE } from '../js/syntax-generator.js';

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

const T1 = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
const T2 = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'];
function makeSpec() {
  const spec = createModelSpec({
    fileName: 'ESEM.dat', mplusFile: 'ESEM.dat',
    delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 4500,
    varNames: [...T1, ...T2, 'GV'], categorical: [], missingCode: null,
  });
  setFactorCount(spec, 2);
  return spec;
}
function makeGroupSpec() {
  const spec = makeSpec();
  spec.groups.enabled = true; spec.groups.variable = 'GV';
  spec.groups.codes = [{ code: '1', label: 'g1' }, { code: '2', label: 'g2' }];
  return spec;
}
function makeLongSpec() {
  const spec = makeSpec();
  spec.longitudinal.enabled = true;
  setWaveItems(spec, 0, T1);
  setWaveItems(spec, 1, T2);
  spec.modelTypes = { cfa: false, esem: false, bifactorCfa: false, bifactorEsem: true };
  return spec;
}

console.log('\n— defaults: no aids emitted —');
{
  const noKey = makeSpec();
  delete noKey.aids; // pre-aids spec shape must keep working
  const off = makeSpec(); // aids present, everything off (createModelSpec default)
  for (const [tag, s] of [['no aids key', noKey], ['aids off', off]]) {
    const inp = buildInp(s, 'cfa') + buildInp(s, 'esem') + buildInp(s, 'bifactorEsem');
    check(`${tag}: no CONVERGENCE and no (res`, !inp.includes('CONVERGENCE') && !inp.includes('(res'), null);
  }
  check('DEFAULT_OUTPUT_LINE is Morin\'s recommended request (T3)', DEFAULT_OUTPUT_LINE === 'SAMPSTAT STANDARDIZED MODINDICES CINTERVAL RESIDUAL SVALUES TECH1 TECH3 TECH4', DEFAULT_OUTPUT_LINE);
  for (const key of ['cfa', 'esem', 'bifactorCfa', 'bifactorEsem']) {
    check(`${key}: OUTPUT is the one default line`, buildInp(off, key).endsWith(`OUTPUT:\n${DEFAULT_OUTPUT_LINE};\n`), buildInp(off, key).split('OUTPUT:')[1]);
  }
  const edited = makeSpec(); edited.output.line = 'SAMPSTAT STANDARDIZED';
  check('user line without SVALUES → ESEM re-inserts it, CFA does not', /SVALUES/.test(buildInp(edited, 'esem')) && !/SVALUES/.test(buildInp(edited, 'cfa')), null);
}

console.log('\n— H1ITERATIONS / H1CONVERGENCE (Morin T32: with missing data, ML family only) —');
{
  const s = makeSpec(); s.aids.convergence = true;
  check('no missing code → no H1 lines', !/H1CONVERGENCE|H1ITERATIONS/.test(buildInp(s, 'esem')), null);
  s.data.missingCode = '-999';
  const e = buildInp(s, 'esem');
  check('missing + aids → H1CONVERGENCE = .005; (no ITERATIONS → no H1ITERATIONS)', /H1CONVERGENCE = \.005;/.test(e) && !/H1ITERATIONS/.test(e), e.match(/H1\w+ = [^;]+;/g));
  check('MISSING ARE ALL (-999) still emitted', /MISSING ARE ALL \(-999\);/.test(e), null);
  const g = makeGroupSpec(); g.aids.convergence = true; g.data.missingCode = '-999';
  const gm = buildInp(g, 'inv:metric');
  check('inv:metric → H1ITERATIONS matches ITERATIONS (10000) + H1CONVERGENCE', /ITERATIONS = 10000;[\s\S]*H1ITERATIONS = 10000;/.test(gm) && /H1CONVERGENCE = \.005;/.test(gm), gm.match(/H1\w+ = [^;]+;/g));
  check('order: CONVERGENCE, then H1ITERATIONS, then H1CONVERGENCE', (() => { const i = gm.indexOf('CONVERGENCE = .005;'), j = gm.indexOf('H1ITERATIONS'), k = gm.indexOf('H1CONVERGENCE'); return i >= 0 && i < j && j < k; })(), null);
  const l = makeLongSpec(); l.aids.convergence = true; l.data.missingCode = '-999';
  check('linv:besem → H1ITERATIONS = 100000', /H1ITERATIONS = 100000;/.test(buildInp(l, 'linv:besem:metric')), null);
  s.estimator = 'WLSMV';
  check('WLSMV → no H1 lines (ML family only)', !/H1CONVERGENCE|H1ITERATIONS/.test(buildInp(s, 'esem')), null);
  s.estimator = 'MLR'; s.aids.convergence = false;
  check('aids off → no H1 lines even with missing data', !/H1CONVERGENCE/.test(buildInp(s, 'esem')), null);
  s.aids.convergence = true;
  check('every H1 build ≤ 90 chars/line', [e, gm, buildInp(l, 'linv:besem:metric')].every((b) => maxLineLength(b) <= 90), null);
}

console.log('\n— CONVERGENCE line —');
{
  const s = makeSpec(); s.aids.convergence = true;
  check('cfa has CONVERGENCE = .005;', buildInp(s, 'cfa').includes('CONVERGENCE = .005;'), null);
  check('esem has CONVERGENCE = .005;', buildInp(s, 'esem').includes('CONVERGENCE = .005;'), null);
  const g = makeGroupSpec(); g.aids.convergence = true;
  check('inv:metric has CONVERGENCE = .005;', buildInp(g, 'inv:metric').includes('CONVERGENCE = .005;'), null);
  const l = makeLongSpec(); l.aids.convergence = true;
  check('linv:besem:configural has CONVERGENCE = .005;', buildInp(l, 'linv:besem:configural').includes('CONVERGENCE = .005;'), null);
  s.aids.convergenceValue = 0.001;
  check('convergenceValue 0.001 → CONVERGENCE = .001;', buildInp(s, 'esem').includes('CONVERGENCE = .001;'), null);
}

console.log('\n— residual positivity constraints —');
{
  const s = makeSpec();
  s.rotation.type = 'TARGET';
  s.aids.positiveResiduals = ['X2'];
  const inp = buildInp(s, 'esem'); // → buildESEMTarget
  const at = (t) => inp.indexOf(t);
  check('target esem has "X2 (res1);"', inp.includes('X2 (res1);'), inp);
  check('target esem has MODEL CONSTRAINT + res1 > 0', inp.includes('MODEL CONSTRAINT:') && inp.includes('res1 > 0;'), null);
  check('labels/constraint appear before OUTPUT:', at('X2 (res1);') < at('OUTPUT:') && at('MODEL CONSTRAINT:') < at('OUTPUT:') && at('res1 > 0;') < at('OUTPUT:'), [at('X2 (res1);'), at('MODEL CONSTRAINT:'), at('res1 > 0;'), at('OUTPUT:')]);
  s.aids.positiveResiduals = ['X4', 'X2']; // selection order must NOT matter — spec.items order wins
  const two = buildInp(s, 'esem');
  check('two items → res1/res2 in spec.items order', two.includes('X2 (res1);') && two.includes('X4 (res2);'), null);
  check('cfa emits them too', buildInp(s, 'cfa').includes('X2 (res1);') && buildInp(s, 'cfa').includes('res2 > 0;'), null);
  check('bifactorEsem (target) emits them', buildInp(s, 'bifactorEsem').includes('X2 (res1);') && buildInp(s, 'bifactorEsem').includes('res1 > 0;'), null);
  s.rotation.type = 'GEOMIN';
  const bg = buildInp(s, 'bifactorEsem'); // BI-GEOMIN path
  check('bifactorEsem (BI-GEOMIN) emits them', bg.includes('X2 (res1);') && bg.includes('MODEL CONSTRAINT:'), null);
  s.aids.positiveResiduals = ['NOPE', 'X2'];
  const ign = buildInp(s, 'esem');
  check('item not in spec.items silently ignored', ign.includes('X2 (res1);') && !ign.includes('NOPE') && !ign.includes('res2'), null);
}

console.log('\n— categorical items are excluded (DELTA parameterization) —');
{
  // Mplus: "Variances for categorical outcomes can only be specified using PARAMETERIZATION=THETA"
  const s = makeSpec();
  s.data.categorical = ['X2'];
  s.aids.positiveResiduals = ['X2', 'X3'];
  const inp = buildInp(s, 'esem');
  check('categorical X2 skipped, X3 gets res1', !inp.includes('X2 (res') && inp.includes('X3 (res1);'), inp.match(/\w+ \(res\d\);/g));
  check('validateSpec warns about the skipped categorical item', validateSpec(s).warnings.some((w) => /ordinal|categorical/i.test(w) && /residual/i.test(w)), validateSpec(s).warnings);
  s.aids.positiveResiduals = ['X2'];
  const only = buildInp(s, 'esem');
  check('only-categorical selection → no res label, no MODEL CONSTRAINT', !only.includes('(res') && !only.includes('MODEL CONSTRAINT'), null);
}

console.log('\n— invariance sequences: Morin’s rules for the residual constraint (2 Nov 2026) —');
{
  const g = makeGroupSpec(); g.aids.positiveResiduals = ['X2']; g.aids.convergence = true;
  const pos = g.items.indexOf('X2') + 1;
  const gm = buildInp(g, 'inv:metric'), gs = buildInp(g, 'inv:strict'), gv = buildInp(g, 'inv:varcov');
  check('MLR before strict: a label of its own in every group, each constrained', gm.includes(`X2 (r${pos}g1);`) && gm.includes(`X2 (r${pos}g2);`) && gm.includes(`r${pos}g1 > 0;`) && gm.includes(`r${pos}g2 > 0;`) && !gm.includes('(res1)') && gm.indexOf('MODEL CONSTRAINT:') > gm.indexOf('MODEL g2:') && gm.indexOf('MODEL CONSTRAINT:') < gm.indexOf('OUTPUT:'), gm);
  check('MLR from strict on: the equality label, constrained once', !gs.includes(`(r${pos}g`) && gs.includes(`u${pos} > 0;`) && (gs.match(/ > 0;/g) || []).length === 1 && gv.includes(`u${pos} > 0;`) && (gv.match(/ > 0;/g) || []).length === 1, gs);
  const ls = buildInp(g, 'inv:strict');
  const gp = makeGroupSpec(); gp.aids.positiveResiduals = ['X2']; setPartial(gp, 'groups', 'esem', 'strict', ['X2']);
  const gsp = buildInp(gp, 'inv:strict@p');
  check('MLR partial strict with the item freed: back to a label per group', gsp.includes(`X2 (r${pos}g1);`) && gsp.includes(`X2 (r${pos}g2);`) && !gsp.includes(`u${pos} > 0;`), gsp);
  const items = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
  const matrix = Array.from({ length: 10 }, (_, r) => [...items.map(() => String((r % 5) + 1)), String(r < 5 ? 1 : 2)]);
  const cat = createModelSpec({ fileName: 'ord.dat', mplusFile: 'ord.dat', delimiter: 'whitespace', hasHeader: false, nCols: 7, nRows: 800, varNames: [...items, 'GV'], categorical: [...items], missingCode: null, _matrix: matrix });
  setItems(cat, items); setFactorCount(cat, 2); items.forEach((it, i) => { cat.target[it] = { F1: i < 3, F2: i >= 3 }; }); setOrdinal(cat, true);
  cat.groups = { enabled: true, variable: 'GV', codes: [{ code: 1, label: 'g1' }, { code: 2, label: 'g2' }], invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  cat.aids.positiveResiduals = ['X2'];
  const cm = buildInp(cat, 'inv:metric'), cs = buildInp(cat, 'inv:scalar'), ct = buildInp(cat, 'inv:strict');
  check('WLSMV before strict: the group-2 residual (free from the configural step) gets the label, group 1 stays fixed at 1', cm.includes(`X2* (r${pos}g2);`) && cm.includes(`r${pos}g2 > 0;`) && !cm.includes(`r${pos}g1`) && (cm.match(/ > 0;/g) || []).length === 1, cm);
  check('WLSMV strong: the free group-2 residual only', cs.includes(`X2* (r${pos}g2);`) && !cs.includes(`r${pos}g1`) && cs.includes(`r${pos}g2 > 0;`) && (cs.match(/ > 0;/g) || []).length === 1 && cs.indexOf('MODEL CONSTRAINT:') < cs.indexOf('OUTPUT:'), cs);
  check('WLSMV from strict on: cannot be done', !ct.includes('MODEL CONSTRAINT') && !ct.includes(`(r${pos}`), ct);
  const cv = buildInp(cat, 'inv:varcov');
  check('WLSMV: a constrained model saves no DIFFTEST derivatives and the step after it reads none (Mplus cannot combine DIFFTEST with MODEL CONSTRAINT); the handshake resumes from strict', !cs.includes('SAVEDATA:') && !cs.split('MODEL:')[0].includes('DIFFTEST') && !ct.split('MODEL:')[0].includes('DIFFTEST') && /SAVEDATA:\nDIFFTEST = Inv_diff_strict.dat;/.test(ct) && /DIFFTEST = Inv_diff_strict.dat;/.test(cv.split('MODEL:')[0]), [cs.includes('SAVEDATA:'), ct.split('MODEL:')[0].includes('DIFFTEST'), cv.split('MODEL:')[0]]);
  const l = makeLongSpec(); l.aids.positiveResiduals = ['X2']; l.aids.convergence = true;
  const w1 = l.longitudinal.waves[0], w2 = l.longitudinal.waves[1], p2 = w1.indexOf('X2') + 1, y2 = w2[p2 - 1];
  const lm = buildInp(l, 'linv:besem:metric'), lst = buildInp(l, 'linv:besem:strict');
  check('MLR across time before strict: a label per wave', lm.includes(`X2 (r${p2}t1);`) && lm.includes(`${y2} (r${p2}t2);`) && lm.includes(`r${p2}t1 > 0;`) && lm.includes(`r${p2}t2 > 0;`), lm);
  check('MLR across time from strict on: the equality label', lst.includes(`u${p2} > 0;`) && !lst.includes(`(r${p2}t`) && (lst.match(/ > 0;/g) || []).length === 1, lst);
  const lc = createModelSpec({ fileName: 'ord2.dat', mplusFile: 'ord2.dat', delimiter: 'whitespace', hasHeader: false, nCols: 12, nRows: 800, varNames: [...items, ...items.map((it) => it.replace('X', 'Y'))], categorical: [...items, ...items.map((it) => it.replace('X', 'Y'))], missingCode: null, _matrix: Array.from({ length: 10 }, (_, r) => [...items.map(() => String((r % 5) + 1)), ...items.map(() => String(((r + 1) % 5) + 1))]) });
  setItems(lc, items); setFactorCount(lc, 2); items.forEach((it, i) => { lc.target[it] = { F1: i < 3, F2: i >= 3 }; }); setOrdinal(lc, true);
  lc.modelTypes = { cfa: false, esem: false, bifactorCfa: false, bifactorEsem: true };
  lc.longitudinal = { enabled: true, waveLabels: ['Time 1', 'Time 2'], waves: [items, items.map((it) => it.replace('X', 'Y'))], correlatedUniqueness: true, invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  lc.aids.positiveResiduals = ['X2'];
  const lcm = buildInp(lc, 'linv:besem:metric'), lcs = buildInp(lc, 'linv:besem:scalar'), lct = buildInp(lc, 'linv:besem:strict');
  check('WLSMV across time: the Time-2 residual before the strict step, nothing from strict on', lcs.includes('Y2* (r2t2);') && lcs.includes('r2t2 > 0;') && lcm.includes('Y2* (r2t2);') && !lcm.includes('r2t1') && !lct.includes('MODEL CONSTRAINT') && !lct.includes('(r2t'), lcs);
  check('WLSMV across time: no DIFFTEST around the constrained models, the handshake resumes from strict', !lcs.includes('SAVEDATA:') && !lct.split('MODEL:')[0].includes('DIFFTEST') && /SAVEDATA:\nDIFFTEST = LongInv_besem_diff_strict.dat;/.test(lct), [lcs.includes('SAVEDATA:'), lct.split('MODEL:')[0].includes('DIFFTEST')]);
  const s = makeSpec(); s.aids = { convergence: true, convergenceValue: 0.005, positiveResiduals: ['X1', 'X2', 'X3'] };
  const builds = [buildInp(s, 'cfa'), buildInp(s, 'esem'), buildInp(s, 'bifactorCfa'), buildInp(s, 'bifactorEsem'), gm, gs, cs, lm, lst, lcs];
  check('every aids-on build ≤ 90 chars/line', builds.every((b) => maxLineLength(b) <= 90), builds.map(maxLineLength));
}

console.log('\n— the residual constraint in the sequences: three groups, two items, branches, every family —');
{
  const g3 = makeGroupSpec(); g3.groups.codes.push({ code: '3', label: 'g3' }); g3.aids.positiveResiduals = ['X2'];
  const m3 = buildInp(g3, 'inv:metric'), s3 = buildInp(g3, 'inv:strict');
  check('three groups: a label per group before strict, each constrained', ['g1', 'g2', 'g3'].every((t) => m3.includes(`X2 (r2${t});`) && m3.includes(`r2${t} > 0;`)) && (m3.match(/ > 0;/g) || []).length === 3, m3);
  check('three groups: one equality label from strict on', s3.includes('u2 > 0;') && (s3.match(/ > 0;/g) || []).length === 1 && !s3.includes('(r2g'), s3);
  const g2 = makeGroupSpec(); g2.aids.positiveResiduals = ['X5', 'X2'];
  const m2 = buildInp(g2, 'inv:metric'), s2 = buildInp(g2, 'inv:strict');
  check('two items: four labels before strict, two equality labels from strict on', ['r2g1', 'r2g2', 'r5g1', 'r5g2'].every((l) => m2.includes(`(${l});`) && m2.includes(`${l} > 0;`)) && s2.includes('u2 > 0;') && s2.includes('u5 > 0;') && (s2.match(/ > 0;/g) || []).length === 2, [m2, s2]);
  const gx = makeGroupSpec(); gx.aids.positiveResiduals = ['X2']; setPartial(gx, 'groups', 'esem', 'strict', ['X3']);
  const sx = buildInp(gx, 'inv:strict@p');
  check('partial strict that frees another item: the selected item keeps its equality label, the freed one has none', sx.includes('u2 > 0;') && !sx.includes('(r2g') && !/\bu3\b/.test(sx), sx);
  const gk = makeGroupSpec(); gk.aids.positiveResiduals = ['X2']; setSkipped(gk, 'groups', 'esem', 'strict', true);
  const vk = buildInp(gk, 'inv:varcov@p'), lk = buildInp(gk, 'inv:latentmean@p');
  check('skipped strict: the later steps keep a label per group (no equality label exists)', [vk, lk].every((b) => b.includes('X2 (r2g1);') && b.includes('X2 (r2g2);') && b.includes('r2g1 > 0;') && b.includes('r2g2 > 0;') && !/\bu2\b/.test(b)), [vk, lk]);
  const ga = makeGroupSpec(); ga.modelTypes = { cfa: true, esem: true, bifactorCfa: true, bifactorEsem: true }; ga.aids.positiveResiduals = [...T1];
  const fam = ['inv:metric', 'cinv:metric', 'binv:metric', 'bcinv:metric'].map((k) => buildInp(ga, k));
  check('all items selected, every family: one label per item and group, no unlabelled residual statement, 12 constraints', fam.every((b) => T1.every((it, i) => b.includes(`${it} (r${i + 1}g1);`) && b.includes(`${it} (r${i + 1}g2);`)) && (b.match(/ > 0;/g) || []).length === 12 && !/^X\d( X\d)*;$/m.test(b)), fam.map((b) => (b.match(/ > 0;/g) || []).length));
  const fs = ['cinv:strict', 'bcinv:strict', 'binv:strict'].map((k) => buildInp(ga, k));
  check('all items selected, from strict on: u1-u6, six constraints', fs.every((b) => b.includes('(u1-u6);') && (b.match(/ > 0;/g) || []).length === 6 && !b.includes('(r1g')), fs.map((b) => (b.match(/ > 0;/g) || []).length));
  const lf = makeLongSpec(); lf.modelTypes = { cfa: true, esem: true, bifactorCfa: true, bifactorEsem: true }; lf.aids.positiveResiduals = ['X2'];
  const lm = ['linv:esem:metric', 'linv:cfa:metric', 'linv:bcfa:metric'].map((k) => buildInp(lf, k)), ls = ['linv:esem:strict', 'linv:cfa:strict', 'linv:bcfa:strict'].map((k) => buildInp(lf, k));
  check('across time, every family: a label per wave before strict, the equality label from strict on', lm.every((b) => b.includes('X2 (r2t1);') && b.includes('Y2 (r2t2);') && b.includes('r2t1 > 0;') && b.includes('r2t2 > 0;')) && ls.every((b) => b.includes('u2 > 0;') && (b.match(/ > 0;/g) || []).length === 1), [lm, ls]);
  check('every build ≤ 90 chars/line', [m3, s3, m2, s2, sx, vk, lk, ...fam, ...fs, ...lm, ...ls].every((b) => maxLineLength(b) <= 90), null);
  // WLSMV partial strong branch with the aid: the constrained partial model saves no derivatives; the branch handshake
  // resumes at the strict step with the branch's own file names
  const items = T1;
  const matrix = Array.from({ length: 10 }, (_, r) => [...items.map(() => String((r % 5) + 1)), String(r < 5 ? 1 : 2)]);
  const cb = createModelSpec({ fileName: 'ord.dat', mplusFile: 'ord.dat', delimiter: 'whitespace', hasHeader: false, nCols: 7, nRows: 800, varNames: [...items, 'GV'], categorical: [...items], missingCode: null, _matrix: matrix });
  setItems(cb, items); setFactorCount(cb, 2); items.forEach((it, i) => { cb.target[it] = { F1: i < 3, F2: i >= 3 }; }); setOrdinal(cb, true);
  cb.groups = { enabled: true, variable: 'GV', codes: [{ code: 1, label: 'g1' }, { code: 2, label: 'g2' }], invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  cb.aids.positiveResiduals = ['X2']; setPartial(cb, 'groups', 'esem', 'scalar', ['X5']);
  const bs = buildInp(cb, 'inv:scalar@p'), bt = buildInp(cb, 'inv:strict@p'), bv = buildInp(cb, 'inv:varcov@p');
  check('WLSMV partial strong with the aid: constrained, no DIFFTEST in or out', bs.includes('X2* (r2g2);') && bs.includes('r2g2 > 0;') && !bs.includes('DIFFTEST') && bs.includes('[partial strong: X5]'), bs);
  check('WLSMV branch after it: strict reads none and saves Inv_diff_strictp.dat, var/cov reads it; no constraint from strict on', !bt.split('MODEL:')[0].includes('DIFFTEST') && /SAVEDATA:\nDIFFTEST = Inv_diff_strictp.dat;/.test(bt) && bv.split('MODEL:')[0].includes('DIFFTEST = Inv_diff_strictp.dat;') && !bt.includes('MODEL CONSTRAINT') && !bv.includes('MODEL CONSTRAINT'), [bt, bv]);
}

console.log(`\naids.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
