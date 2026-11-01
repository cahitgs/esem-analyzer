// partial.test.mjs — partial measurement invariance (Byrne et al., 1989; Morin, 2023): the branch a chain takes after a
// step goes beyond the fit-change guideline — the generator's partial models (Morin's T11 / T34 forms), skipped steps,
// the branch's files and DIFFTEST handshake, the parser's title tag and modification indices, the table rows (the
// failed model kept but not retained, the branch replacing the later steps), the notes, the prose and the Word export,
// the Results-page candidates and the saved .json. Run: node test/partial.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildInp, requestedModels, branchModels, invBranch, branchStart, partialKind, maxLineLength, INV_SEQUENCE, INV_META, labeledExcept } from '../js/syntax-generator.js';
import { createModelSpec, setItems, setFactorCount, setOrdinal, setPartial, setSkipped, clearBranch, partialCandidates, partialKindOf, sanitizeBranches, validateSpec, SKIPPABLE } from '../js/state.js';
import { parseOut, splitBranchTag, parseModIndices } from '../js/out-parser.js';
import { invarianceSeries, invarianceLabel, renderInvarianceTable, invarianceProseText, invarianceGuidelineNote, modIndexFor, freedText, sortInvarianceModels } from '../js/apa-render.js';
import { serializeSpec, applySavedSpec } from '../js/spec-store.js';
import { buildWordHtml } from '../js/docx-export.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };
const section = (t) => console.log(`\n— ${t} —`);
const apa2 = (x) => (x == null ? '—' : x.toFixed(2));

// ---- Morin's Data 1 shape: 12 items × 3 factors, two groups, target rotation ----
const items1 = ['X1', 'X2', 'X3', 'X4', 'Y1', 'Y2', 'Y3', 'Y4', 'Z1', 'Z2', 'Z3', 'Z4'];
function data1Spec() {
  const spec = createModelSpec({ fileName: 'Ch27-Data1.dat', mplusFile: 'Ch27-Data1.dat', delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 10000, varNames: [...items1, 'GROUP'], categorical: [], missingCode: null });
  setItems(spec, items1); setFactorCount(spec, 3);
  items1.forEach((it, i) => { spec.target[it] = { F1: i < 4, F2: i >= 4 && i < 8, F3: i >= 8 }; });
  spec.rotation = { type: 'TARGET', oblique: true, epsilon: null };
  spec.modelTypes = { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: true };
  spec.groups = { enabled: true, variable: 'GROUP', codes: [{ code: 1, label: 'G1' }, { code: 2, label: 'G2' }], invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  return spec;
}

section('rules: which steps may be partial, which may be skipped');
ok('ESEM / bifactor-ESEM: strong and strict only', partialKind('esem', 'scalar') === 'intercepts' && partialKind('besem', 'strict') === 'residuals' && partialKind('esem', 'metric') === null && partialKind('besem', 'varcov') === null && partialKind('esem', 'latentmean') === null);
ok('CFA / bifactor-CFA: every step after configural', partialKind('cfa', 'metric') === 'loadings' && partialKind('bcfa', 'varcov') === 'varcov' && partialKind('cfa', 'latentmean') === 'means' && partialKind('cfa', 'configural') === null);
ok('state.js agrees with the generator', ['cfa', 'esem', 'bcfa', 'besem'].every((mt) => INV_SEQUENCE.every((s) => partialKindOf(mt, s) === partialKind(mt, s))));
ok('skippable steps: strict and var–cov', SKIPPABLE.join() === 'strict,varcov');
ok('labels: weak / strong (Morin), thresholds form for the ordinal chains', INV_META.metric.label === 'Weak (loadings)' && INV_META.scalar.label === 'Strong (intercepts)' && INV_META.scalar.thresholds === 'Strong (thresholds)');
ok('labeledExcept: Morin\'s partial form "[Z1] (i9); [Z2*]; [Z3 Z4] (i11-i12);"', labeledExcept(items1, 'i', true, new Set([9])) === '[X1 X2 X3 X4 Y1 Y2 Y3 Y4 Z1] (i1-i9);\n[Z2*];\n[Z3 Z4] (i11-i12);', labeledExcept(items1, 'i', true, new Set([9])));
ok('labeledExcept without free positions = the labelled chunk', labeledExcept(items1, 'u', false) === 'X1 X2 X3 X4 Y1 Y2 Y3 Y4 Z1 Z2 Z3 Z4 (u1-u12);');

section('multi-group ESEM: the Z2 intercept freed at the strong step (Morin T11)');
{
  const spec = data1Spec();
  setPartial(spec, 'groups', 'esem', 'scalar', ['Z2']);
  const br = invBranch(spec, 'groups', 'esem');
  ok('branch recorded', br.active && br.partial.scalar.join() === 'Z2' && branchStart(br) === 2, br);
  const full = buildInp(spec, 'inv:scalar'), p = buildInp(spec, 'inv:scalar@p');
  ok('the full chain ignores the branch', !/\[Z2\*\]/.test(full) && /\(i1-i12\)/.test(full));
  ok('partial strong: Z2 free between the labelled runs, in the overall MODEL and in G2', (p.match(/\[X1 X2 X3 X4 Y1 Y2 Y3 Y4 Z1\] \(i1-i9\);\n\[Z2\*\];\n\[Z3 Z4\] \(i11-i12\);/g) || []).length === 2, p);
  ok('partial strong: title carries the tag', /^Longitudinal|^MG invariance - Strong \(intercepts\) \[partial strong: Z2\]$/m.test(p), p.split('\n')[1]);
  ok('partial strong: group means free, variances free (as in the full strong model)', /MODEL G2:\nF1\*; F2\*; F3\*;\n\[F1\*\]; \[F2\*\]; \[F3\*\];/.test(p));
  ok('all lines ≤ 90 chars', maxLineLength(p) <= 90);
  const strict = buildInp(spec, 'inv:strict@p'), vc = buildInp(spec, 'inv:varcov@p'), lm = buildInp(spec, 'inv:latentmean@p');
  ok('strict / var–cov / latent means are built FROM the partial strong model (Z2 stays free)', [strict, vc, lm].every((t) => (t.match(/\[Z2\*\];/g) || []).length === 2));
  ok('strict: uniquenesses equated (u1-u12), title tag carried', /\(u1-u12\)/.test(strict) && /Strict \(residuals\) \[partial strong: Z2\]/.test(strict));
  ok('var–cov: covariances equated, G2 variances refixed', /F1 WITH F2 \(cov1\);/.test(vc) && /MODEL G2:\nF1-F3@1;/.test(vc));
  ok('latent means: G2 means refixed @0', /MODEL G2:\nF1-F3@1;\nF1 WITH F2 \(cov1\);[\s\S]*\[F1-F3@0\];/.test(lm));
  const models = branchModels(spec, 'groups', 'esem');
  ok('branch models: strong@p … latent means@p with "p" files', models.map((m) => m.key).join() === 'inv:scalar@p,inv:strict@p,inv:varcov@p,inv:latentmean@p' && models.map((m) => m.file).join() === 'Inv_3p_scalar.inp,Inv_4p_strict.inp,Inv_5p_varcov.inp,Inv_6p_latentmean.inp', models.map((m) => m.file));
  ok('branch labels name the freed parameter', /partial \(Z2\)/.test(models[0].label) && /partial branch/.test(models[1].label), models.map((m) => m.label));
  const all = requestedModels(spec);
  ok('the Syntax page lists the branch after the full chain of its model', all.filter((m) => m.variant === 'p').length === 4 && all.findIndex((m) => m.key === 'inv:latentmean') < all.findIndex((m) => m.key === 'inv:scalar@p') && all.filter((m) => m.key.startsWith('binv:')).every((m) => !m.variant), all.map((m) => m.key));
  ok('no branch for the other chains', branchModels(spec, 'groups', 'besem').length === 0 && branchModels(spec, 'groups', 'cfa').length === 0);
  // two intercepts, then a partial strict on top
  setPartial(spec, 'groups', 'esem', 'scalar', ['Z2', 'Y4']);
  setPartial(spec, 'groups', 'esem', 'strict', ['X1']);
  const s2 = buildInp(spec, 'inv:strict@p');
  ok('two intercepts + one uniqueness freed: labelled runs around each, tag lists both steps', /\[Y4\*\];/.test(s2) && /\[Z2\*\];/.test(s2) && /^X1;\nX2 X3 X4 Y1 Y2 Y3 Y4 Z1 Z2 Z3 Z4 \(u2-u12\);/m.test(s2) && /\[partial strong: Z2, Y4; partial strict: X1\]/.test(s2), s2);
  ok('branch starts at the earliest partial step', branchModels(spec, 'groups', 'esem')[0].key === 'inv:scalar@p');
  setPartial(spec, 'groups', 'esem', 'scalar', []); setPartial(spec, 'groups', 'esem', 'strict', []);
  ok('empty lists clear the branch', !invBranch(spec, 'groups', 'esem').active && branchModels(spec, 'groups', 'esem').length === 0);
}

section('skipped step: latent means without the var–cov constraints (compared with strict)');
{
  const spec = data1Spec();
  setSkipped(spec, 'groups', 'esem', 'varcov', true);
  const models = branchModels(spec, 'groups', 'esem');
  ok('branch = the latent-means model only', models.map((m) => m.file).join() === 'Inv_6p_latentmean.inp', models.map((m) => m.file));
  const lm = buildInp(spec, 'inv:latentmean@p');
  ok('latent means without var–cov: G2 variances free, no covariance labels, means refixed @0, tag "without var-cov"', /MODEL G2:\nF1\*; F2\*; F3\*;\n\[F1-F3@0\];/.test(lm) && !/cov1/.test(lm) && /\[without var-cov\]/.test(lm), lm);
  ok('the full latent-means model still equates the covariances', /cov1/.test(buildInp(spec, 'inv:latentmean')));
  setSkipped(spec, 'groups', 'esem', 'metric', true);
  ok('configural / weak / strong / latent means cannot be skipped', !invBranch(spec, 'groups', 'esem').skipped.includes('metric'));
  setSkipped(spec, 'groups', 'esem', 'varcov', false);
  ok('unskipping clears the branch', !invBranch(spec, 'groups', 'esem').active);
}

section('CFA families: loadings, var–cov terms and latent means can be freed too');
{
  const spec = data1Spec();
  setPartial(spec, 'groups', 'cfa', 'metric', ['F1:X3']);
  const w = buildInp(spec, 'cinv:metric@p');
  ok('partial weak (CFA): the freed loading is written "F1 BY X3*;" in the G2 section', /MODEL G2:\nF1 BY X3\*;\nF1\*; F2\*; F3\*;/.test(w), w.split('MODEL G2:')[1]);
  setPartial(spec, 'groups', 'cfa', 'varcov', ['F1~F2', 'F3']);
  const v = buildInp(spec, 'cinv:varcov@p');
  ok('partial var–cov (CFA): F1 WITH F2 unlabelled, F3 variance free in G2, other terms equated', /F1 WITH F2;\nF1 WITH F3 \(cov2\);/.test(v) && /MODEL G2:\nF1 BY X3\*;\nF1@1; F2@1; F3\*;/.test(v), v.split('MODEL G2:')[1]);
  setPartial(spec, 'groups', 'cfa', 'latentmean', ['F2']);
  const m = buildInp(spec, 'cinv:latentmean@p');
  ok('partial latent means (CFA): F2 mean free in G2, the others refixed @0', /\[F1@0\]; \[F2\*\]; \[F3@0\];/.test(m), m.split('MODEL G2:')[1]);
  ok('partial loadings refused for ESEM', (setPartial(spec, 'groups', 'esem', 'metric', ['F1:X3']), !invBranch(spec, 'groups', 'esem').active));
  setPartial(spec, 'groups', 'besem', 'metric', ['G:X3']);
  ok('partial loadings refused for bifactor-ESEM', !invBranch(spec, 'groups', 'besem').active);
  const bspec = data1Spec(); bspec.modelTypes.bifactorCfa = true;
  setPartial(bspec, 'groups', 'bcfa', 'metric', ['G:Z2']);
  const bw = buildInp(bspec, 'bcinv:metric@p');
  ok('partial weak (bifactor-CFA): "G BY Z2*;" in the G2 section', /MODEL G2:\nG BY Z2\*;\nG\*; F1\*; F2\*; F3\*;/.test(bw), bw.split('MODEL G2:')[1]);
  ok('candidates: loadings of a bifactor-CFA list G and the specific factors', partialCandidates(bspec, 'groups', 'bcfa', 'metric').map((c) => c.id).slice(0, 2).join() === 'G:X1,G:X2' && partialCandidates(bspec, 'groups', 'bcfa', 'metric').some((c) => c.id === 'F3:Z4'));
  ok('candidates: var–cov of a bifactor-CFA lists variances only', partialCandidates(bspec, 'groups', 'bcfa', 'varcov').every((c) => c.kind === 'variance'));
  ok('candidates: var–cov of a CFA lists variances and covariances', partialCandidates(spec, 'groups', 'cfa', 'varcov').map((c) => c.id).join() === 'F1,F2,F3,F1~F2,F1~F3,F2~F3');
}

section('ordinal chain (WLSMV / THETA / DIFFTEST): thresholds freed, the branch\'s own derivative files');
{
  const items = ['duy1_t1', 'duy2_t1', 'duy3_t1', 'duy4_t1', 'psi1_t1', 'psi2_t1', 'psi3_t1', 'psi4_t1', 'sos1_t1', 'sos2_t1', 'sos3_t1', 'sos4_t1'];
  const matrix = Array.from({ length: 10 }, (_, r) => [...items.map(() => String((r % 5) + 1)), String(r < 5 ? 1 : 2)]);
  const spec = createModelSpec({ fileName: 'iyiolus-ord.dat', mplusFile: 'iyiolus-ord.dat', delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 800, varNames: [...items, 'okul'], categorical: [...items], missingCode: null, _matrix: matrix });
  setItems(spec, items); setFactorCount(spec, 3);
  items.forEach((it, idx) => { spec.target[it] = { F1: false, F2: false, F3: false, [`F${Math.floor(idx / 4) + 1}`]: true }; });
  setOrdinal(spec, true);
  spec.rotation = { type: 'TARGET', oblique: true, epsilon: null };
  spec.modelTypes = { cfa: false, esem: true, bifactorCfa: false, bifactorEsem: true };
  spec.groups = { enabled: true, variable: 'okul', codes: [{ code: 1, label: 'okulA' }, { code: 2, label: 'okulB' }], invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  const cands = partialCandidates(spec, 'groups', 'esem', 'scalar');
  ok('candidates: thresholds, referents (duy1 / psi1 / sos1) marked', cands.every((c) => c.kind === 'thresholds') && cands.filter((c) => c.referent).map((c) => c.id).join() === 'duy1_t1,psi1_t1,sos1_t1', cands.filter((c) => c.referent));
  setPartial(spec, 'groups', 'esem', 'scalar', ['duy1_t1', 'duy2_t1']);
  ok('a referent cannot be freed (dropped), the other item is kept', invBranch(spec, 'groups', 'esem').partial.scalar.join() === 'duy2_t1');
  const p = buildInp(spec, 'inv:scalar@p');
  ok('partial strong (thresholds): the freed item keeps the configural treatment, the others are fully equated', /\[duy2_t1\$1\] \(t5\); \[duy2_t1\$2\]; \[duy2_t1\$3\]; \[duy2_t1\$4\];/.test(p) && /\[duy3_t1\$1\] \(t9\);\s+\[duy3_t1\$2\] \(t10\);/.test(p), p);
  ok('partial strong: title "Strong (thresholds) [partial strong: duy2_t1]"', /MG invariance \(categorical\) - Strong \(thresholds\) \[partial strong: duy2_t1\]/.test(p));
  ok('DIFFTEST: reads the full weak step\'s file, saves its own "p" file', /DIFFTEST = Inv_diff_metric.dat;/.test(p.split('MODEL:')[0]) && /SAVEDATA:\nDIFFTEST = Inv_diff_scalarp.dat;/.test(p));
  const st = buildInp(spec, 'inv:strict@p');
  ok('strict@p reads the partial strong file and saves strictp', /DIFFTEST = Inv_diff_scalarp.dat;/.test(st.split('MODEL:')[0]) && /DIFFTEST = Inv_diff_strictp.dat;/.test(st.split('SAVEDATA:')[1]));
  ok('the full strict still reads the full strong file', /DIFFTEST = Inv_diff_scalar.dat;/.test(buildInp(spec, 'inv:strict').split('MODEL:')[0]));
  setSkipped(spec, 'groups', 'esem', 'strict', true);
  const vc = buildInp(spec, 'inv:varcov@p');
  ok('strict skipped: var–cov@p reads the partial strong file, keeps G2 uniquenesses free', /DIFFTEST = Inv_diff_scalarp.dat;/.test(vc.split('MODEL:')[0]) && /MODEL okulB:[\s\S]*duy1_t1\*; duy2_t1\*;/.test(vc) && /\[partial strong: duy2_t1; without strict\]/.test(vc), vc);
  const errs = validateSpec({ ...spec, groups: { ...spec.groups, invariance: { ...spec.groups.invariance, partial: { esem: { scalar: ['duy1_t1'], metric: ['F1:duy2_t1'] } } } } }).errors.join(' | ');
  ok('validateSpec: a freed referent and a partial ESEM weak step are errors', /referent/.test(errs) && /no partial form/.test(errs), errs);
}

section('longitudinal chains: the pair freed at both waves (Morin T34), CFA loadings, skipped var–cov');
{
  const t1 = ['x1_t1', 'x2_t1', 'x3_t1', 'x4_t1', 'y1_t1', 'y2_t1', 'y3_t1', 'y4_t1', 'z1_t1', 'z2_t1', 'z3_t1', 'z4_t1'];
  const t2 = t1.map((v) => v.replace('_t1', '_t2'));
  const spec = createModelSpec({ fileName: 'Ch27-Data2.dat', mplusFile: 'Ch27-Data2.dat', delimiter: 'whitespace', hasHeader: false, nCols: 24, nRows: 10000, varNames: [...t1, ...t2], categorical: [], missingCode: null });
  setItems(spec, t1); setFactorCount(spec, 3);
  t1.forEach((it, i) => { spec.target[it] = { F1: i < 4, F2: i >= 4 && i < 8, F3: i >= 8 }; });
  spec.rotation = { type: 'TARGET', oblique: true, epsilon: null };
  spec.modelTypes = { cfa: true, esem: true, bifactorCfa: false, bifactorEsem: true };
  spec.longitudinal = { enabled: true, waveLabels: ['Time 1', 'Time 2'], waves: [t1, t2], correlatedUniqueness: true, invariance: { sequence: [...INV_SEQUENCE], partial: {}, skipped: {} } };
  setPartial(spec, 'time', 'besem', 'scalar', ['z2_t1']);
  const p = buildInp(spec, 'linv:besem:scalar@p');
  ok('bifactor-ESEM partial strong: z2 free at both waves between the labelled runs', / z1_t1\] \(i1-i9\);\n\[z2_t1\*\];\n\[z3_t1 z4_t1\] \(i11-i12\);/.test(p) && / z1_t2\] \(i1-i9\);\n\[z2_t2\*\];\n\[z3_t2 z4_t2\] \(i11-i12\);/.test(p), p);
  const titleLines = p.split('\n').slice(1, p.split('\n').indexOf('DATA:'));
  ok('title tag on a longitudinal title names both waves of the pair', titleLines.join(' ') === 'Longitudinal invariance (bifactor-ESEM) - Strong (intercepts) [partial strong: z2_t1/z2_t2]', titleLines);
  ok('a title longer than Mplus\'s 90-character input line is wrapped at a space (Mplus would drop the end of the tag)', titleLines.length === 2 && titleLines.every((l) => l.length <= 90) && titleLines[1] === 'z2_t1/z2_t2]', titleLines);
  ok('modIndexFor is case-insensitive and takes the larger index of a pair', modIndexFor({ modIndices: { entries: [{ kind: 'MEAN', a: 'Z2_T1', mi: 183.4 }, { kind: 'MEAN', a: 'Z2_T2', mi: 617.7 }] } }, 'scalar', 'z2_t1/z2_t2') === 617.7 && modIndexFor({ modIndices: { entries: [{ kind: 'MEAN', a: 'Z2', mi: 5 }] } }, 'scalar', 'z2') === 5);
  const lm = buildInp(spec, 'linv:besem:latentmean@p');
  ok('latent means@p keeps z2 free, refixes the Time-2 means (G2 included)', (lm.match(/\[z2_t[12]\*\];/g) || []).length === 2 && /\[F4-F6@0\];\n\[G2@0\];/.test(lm));
  const bm = branchModels(spec, 'time', 'besem');
  ok('longitudinal branch files', bm.map((m) => m.file).join() === 'LongInv_besem_3p_scalar.inp,LongInv_besem_4p_strict.inp,LongInv_besem_5p_varcov.inp,LongInv_besem_6p_latentmean.inp', bm.map((m) => m.file));
  ok('candidates name the pair', partialCandidates(spec, 'time', 'besem', 'scalar').find((c) => c.id === 'z2_t1').label === 'z2_t1 / z2_t2');
  setPartial(spec, 'time', 'cfa', 'metric', ['F3:z2_t1']);
  const w = buildInp(spec, 'linv:cfa:metric@p');
  ok('CFA partial weak across time: the z2 loading unlabelled at both waves, the others labelled', /F3 BY z2_t1;\n/.test(w) && /F6 BY z2_t2;\n/.test(w) && /F3 BY z1_t1\* \(L3_1\);/.test(w) && /F6 BY z1_t2\* \(L3_1\);/.test(w), w);
  setSkipped(spec, 'time', 'esem', 'varcov', true);
  const e = buildInp(spec, 'linv:esem:latentmean@p');
  ok('ESEM latent means without var–cov across time: Time-2 variances free, no lcov labels, means refixed', !/F4-F6@1;/.test(e) && !/lcov/.test(e) && /\[F4-F6@0\];/.test(e) && /\[without var-cov\]/.test(e), e);
  ok('full-chain files unchanged by the branch', requestedModels(spec).filter((m) => !m.variant && m.key.startsWith('linv:esem')).map((m) => m.file).join() === INV_SEQUENCE.map((s, i) => `LongInv_esem_${i + 1}_${s}.inp`).join());
}

section('saved .json: the branch travels with the spec and is sanitised on restore');
{
  const spec = data1Spec();
  setPartial(spec, 'groups', 'esem', 'scalar', ['Z2']);
  setSkipped(spec, 'groups', 'esem', 'varcov', true);
  const saved = JSON.parse(JSON.stringify(serializeSpec(spec)));
  ok('serialised', saved.groups.invariance.partial.esem.scalar.join() === 'Z2' && saved.groups.invariance.skipped.esem.join() === 'varcov');
  const fresh = createModelSpec(spec.data);
  const r = applySavedSpec(fresh, saved, { withData: true });
  ok('restored', r.ok && invBranch(fresh, 'groups', 'esem').partial.scalar.join() === 'Z2' && invBranch(fresh, 'groups', 'esem').skipped.join() === 'varcov');
  saved.groups.invariance.partial.esem.scalar = ['Z2', 'Q9'];
  saved.groups.invariance.partial.esem.metric = ['F1:X3'];
  saved.groups.invariance.skipped.esem = ['configural', 'strict'];
  const fresh2 = createModelSpec(spec.data);
  applySavedSpec(fresh2, saved, { withData: true });
  const b2 = invBranch(fresh2, 'groups', 'esem');
  ok('an unknown item, an ESEM loading and an unskippable step are dropped on restore', b2.partial.scalar.join() === 'Z2' && !b2.partial.metric && b2.skipped.join() === 'strict', b2);
  const dropped = sanitizeBranches({ ...spec, groups: { ...spec.groups, invariance: { ...spec.groups.invariance, partial: { esem: { scalar: ['Z2', 'nope'] } } } } });
  ok('sanitizeBranches reports what it dropped', dropped.join() === 'nope', dropped);
  clearBranch(spec, 'groups', 'esem');
  ok('clearBranch', !invBranch(spec, 'groups', 'esem').active);
}

section('parser: the title tag and the modification indices');
{
  ok('splitBranchTag: partial step with ids', JSON.stringify(splitBranchTag('Strict (residuals) [partial strong: Z2, Y4; without var-cov]')) === JSON.stringify({ invStep: 'Strict (residuals)', invBranch: { partial: { scalar: ['Z2', 'Y4'] }, counts: {}, skipped: ['varcov'], text: 'partial strong: Z2, Y4; without var-cov' } }), splitBranchTag('Strict (residuals) [partial strong: Z2, Y4; without var-cov]'));
  ok('splitBranchTag: a count-only tag', splitBranchTag('Strong (thresholds) [partial strong: 3 freed]').invBranch.counts.scalar === 3 && splitBranchTag('Strong (thresholds) [partial strong: 3 freed]').invBranch.partial.scalar.length === 0);
  ok('splitBranchTag: no tag → no branch', splitBranchTag('Weak (loadings)').invBranch === null && splitBranchTag('Weak (loadings)').invStep === 'Weak (loadings)');
  // the real output of the Data 2 partial strong model: its 91-character title was written on two lines by the generator
  const raw3p = fx('v91_LongInv_besem_3p_scalar.out');
  ok('fixture: the TITLE spans two lines in the Mplus output (a 91-character line would have been cut at 90)', /\[partial strong:\r?\nz2_t1\/z2_t2\]/.test(raw3p));
  const twoLine = parseOut(raw3p);
  ok('a TITLE written on two lines is joined before the tag is read', twoLine.title === 'Longitudinal invariance (bifactor-ESEM) - Strong (intercepts) [partial strong: z2_t1/z2_t2]' && twoLine.invStep === 'Strong (intercepts)' && twoLine.invBranch?.partial.scalar.join() === 'z2_t1/z2_t2' && invarianceLabel(twoLine) === 'Partial strong (z2_t1/z2_t2 intercept free)', [twoLine.title, invarianceLabel(twoLine)]);
  const p = parseOut(fx('v91_Inv_3_scalar.out'));
  ok('a real strong-step output: modification indices parsed (groups, intercepts)', p.modIndices && p.modIndices.entries.length > 0 && p.modIndices.entries.some((e) => e.kind === 'MEAN' && e.group === 'G1') && p.modIndices.entries.some((e) => e.kind === 'MEAN' && e.group === 'G2'), p.modIndices?.entries?.slice(0, 3));
  ok('every entry carries a numeric M.I.; the minimum printed is read', p.modIndices.entries.every((e) => Number.isFinite(e.mi)) && p.modIndices.min === 10, p.modIndices.min);
  ok('modIndexFor: the Z2 intercept of the failed strong model, max over the two groups (2568.592)', modIndexFor(p, 'scalar', 'Z2') === 2568.592 && modIndexFor(p, 'scalar', 'Z1') === 37.475, [modIndexFor(p, 'scalar', 'Z2'), modIndexFor(p, 'scalar', 'Z1')]);
  ok('modIndexFor: a loading and a residual covariance are not intercepts', modIndexFor(p, 'metric', 'F3:Z2') === 16.827 && modIndexFor(p, 'scalar', 'F3') === null, [modIndexFor(p, 'metric', 'F3:Z2'), modIndexFor(p, 'scalar', 'F3')]);
  ok('modIndexFor: an unknown item → null', modIndexFor(p, 'scalar', 'NOPE') === null);
  const cat = parseOut(fx('mg_cat_2_metric.out'));
  ok('ordinal output: a truncated threshold name "[ PSI1_T1$ ]" still maps to its item', modIndexFor(cat, 'scalar', 'PSI1_T1') != null);
  // the full-chain fixtures carry no tag
  ok('a full-chain fixture has no branch', p.invBranch === null || p.invBranch === undefined);
}

section('table, note and prose with a branch (synthetic outputs on real fixtures)');
{
  // the MCP-era ESEM.dat fixtures carry no app TITLE, so the step comes from a hand-set invStep (as a user's own output would)
  const STEPS = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
  const LABEL = { configural: 'Configural', metric: 'Weak (loadings)', scalar: 'Strong (intercepts)', strict: 'Strict (residuals)', varcov: 'Factor var/cov', latentmean: 'Latent means' };
  const full = STEPS.map((s) => ({ step: s, parsed: { ...parseOut(fx(`inv_${s}.out`)), invKind: 'multigroup', invModel: 'esem', invStep: LABEL[s] } }));
  // the strong fixture plays the failed strong model: push its CFI down, then a partial model one df lower that recovers
  const failed = { ...full[2].parsed, fit: { ...full[2].parsed.fit, cfi: full[1].parsed.fit.cfi - 0.05, tli: full[1].parsed.fit.tli - 0.06, rmsea: full[1].parsed.fit.rmsea + 0.05 } };
  const mk = (p, extra = {}) => { const parsed = { ...p, ...extra }; return { label: invarianceLabel(parsed), parsed }; };
  const tag = { invBranch: { partial: { scalar: ['X3'] }, counts: {}, skipped: [], text: 'partial strong: X3' } };
  // the branch rows get fits a hair below the weak model's (every step within the guideline), one df lower than the full chain
  const near = (p, k) => ({ ...p.fit, df: p.fit.df - 1, cfi: full[1].parsed.fit.cfi - 0.002 * k, tli: full[1].parsed.fit.tli - 0.002 * k, rmsea: full[1].parsed.fit.rmsea + 0.001 * k });
  const partial = mk(full[2].parsed, { ...tag, fit: near(full[2].parsed, 1) });
  const strictP = mk(full[3].parsed, { ...tag, fit: near(full[3].parsed, 2) });
  const vcP = mk(full[4].parsed, { ...tag, fit: near(full[4].parsed, 3) });
  const lmP = mk(full[5].parsed, { ...tag, fit: near(full[5].parsed, 4) });
  const models = [lmP, mk(full[5].parsed), mk(full[0].parsed), strictP, mk(full[1].parsed), mk(failed), mk(full[3].parsed), partial, vcP, mk(full[4].parsed)]; // arrival order irrelevant
  ok('label of the partial model', partial.label === 'Partial strong (X3 intercept free)', partial.label);
  ok('labels of the later branch models keep their step', strictP.label === 'Strict (residuals)' && lmP.label === 'Latent means');
  ok('sort: the full strong model before its partial form', sortInvarianceModels(models).map((m) => m.label).slice(2, 4).join(' | ') === 'Strong (intercepts) | Partial strong (X3 intercept free)', sortInvarianceModels(models).map((m) => m.label));
  const series = invarianceSeries(models);
  ok('rows: configural, weak, strong (not retained), partial strong, strict, var–cov, latent means — the full later steps left out', series.map((r) => r.m.label).join(' | ') === 'Configural | Weak (loadings) | Strong (intercepts) | Partial strong (X3 intercept free) | Strict (residuals) | Factor var/cov | Latent means' && series.filter((r) => !r.retained).length === 1, series.map((r) => `${r.m.label}${r.retained ? '' : '†'}`));
  ok('the partial model and the later steps compare with the retained chain (weak → partial → strict …)', series[3].prev === series[1].m && series[4].prev === series[3].m && series[2].prev === series[1].m, series.map((r) => r.prev?.label));
  ok('the failed model does not mark the later rows as "for completeness"', series.slice(3).every((r) => r.after == null));
  const html = renderInvarianceTable(models);
  ok('table: dagger on the failed row, note explains the branch', /Strong \(intercepts\)<sup>†<\/sup>/.test(html) && /† Reported but not retained/.test(html) && /The partial strong model frees the X3 intercept — the parameter with the largest modification index of the strong \(intercepts\) model, which is reported but not retained — and is compared with the weak \(loadings\) model; the strict \(residuals\), factor var\/cov, and latent means models are built from it \(Byrne et al\., 1989; Morin, 2023\)/.test(html), html.match(/<p class="apa-note">[\s\S]*?<\/p>/)?.[0]);
  const note = invarianceGuidelineNote(series);
  ok('note: "preceding retained model"', /preceding retained model/.test(note));
  const prose = invarianceProseText(models);
  ok('prose: failure, partial model, later models built from it (no modification indices in these fixtures)', /The strong \(intercepts\) model went beyond/.test(prose) && /modification indices pointed to the X3 intercept;/.test(prose) && /the partial strong \(x3 intercept free\) model stayed within the guideline relative to the weak \(loadings\) model/.test(prose) && /built from the partial strong model, stayed within the guideline/.test(prose), prose);
  ok('freedText forms', freedText(tag.invBranch, 'scalar') === 'X3 intercept free' && freedText({ partial: { scalar: ['A', 'B'] } }, 'scalar', true) === 'A and B thresholds free' && freedText({ partial: { scalar: [] }, counts: { scalar: 3 } }, 'scalar') === '3 intercepts freed');
  const word = buildWordHtml(models);
  ok('Word export: the partial row, the dagger and the note', /Partial strong \(X3 intercept free\)/.test(word) && /Strong \(intercepts\) †/.test(word) && /Reported but not retained/.test(word));
  // a skipped step: the failed var–cov model kept, the latent means model built without it
  const skipTag = { invBranch: { partial: {}, counts: {}, skipped: ['varcov'], text: 'without var-cov' } };
  // on these fixtures the strong step itself is beyond the guideline, so the full strong and strict models get fits near the weak one
  const within = (p, k) => ({ ...p.fit, cfi: full[1].parsed.fit.cfi - 0.002 * k, tli: full[1].parsed.fit.tli - 0.002 * k, rmsea: full[1].parsed.fit.rmsea + 0.001 * k });
  const failedVc = { ...full[4].parsed, fit: { ...within(full[4].parsed, 3), cfi: full[1].parsed.fit.cfi - 0.03 } };
  const lmSkip = mk(full[5].parsed, { ...skipTag, fit: { ...within(full[5].parsed, 3), df: full[5].parsed.fit.df - 3 } });
  const models2 = [mk(full[0].parsed), mk(full[1].parsed), mk(full[2].parsed, { fit: within(full[2].parsed, 1) }), mk(full[3].parsed, { fit: within(full[3].parsed, 2) }), mk(failedVc), lmSkip, mk(full[5].parsed)];
  const s2 = invarianceSeries(models2);
  ok('skipped var–cov: rows configural … strict, var–cov (not retained), latent means (branch); the full latent means left out', s2.map((r) => `${r.m.label}${r.retained ? '' : '†'}`).join(' | ') === 'Configural | Weak (loadings) | Strong (intercepts) | Strict (residuals) | Factor var/cov† | Latent means', s2.map((r) => `${r.m.label}${r.retained ? '' : '†'}`));
  ok('the latent means model compares with strict', s2[5].prev === s2[3].m);
  const h2 = renderInvarianceTable(models2);
  ok('note: estimated without the var–cov constraints, compared with the last retained model', /The latent means model is estimated without the latent variance–covariance constraints \(the factor var\/cov model is reported but not retained; its constraints have no partial form in an ESEM set\) and compared with the last retained model/.test(h2), h2.match(/<p class="apa-note">[\s\S]*?<\/p>/)?.[0]);
  const p2 = invarianceProseText(models2);
  ok('prose: the skip sentence', /These constraints have no partial form in an ESEM set/.test(p2) && /latent means model/.test(p2), p2);
  // no branch at all: the classic reading is unchanged
  const s3 = invarianceSeries([mk(full[0].parsed), mk(full[1].parsed), mk(failed), mk(full[3].parsed)]);
  ok('without a branch the failed step stays retained and the rows after it are "for completeness"', s3[2].retained && s3[3].after === s3[2].m);
}

section('real Mplus 9.1.1 runs: Morin\'s Data 1 ESEM chain with the Z2 intercept freed (Table 27.1 reproduced)');
{
  const names = ['Inv_1_configural', 'Inv_2_metric', 'Inv_3_scalar', 'Inv_3p_scalar', 'Inv_4p_strict', 'Inv_5p_varcov', 'Inv_6p_latentmean'];
  const models = names.map((n) => { const p = parseOut(fx(`v91_${n}.out`)); return { label: invarianceLabel(p), parsed: p, fileName: `${n}.out` }; });
  ok('titles: new step names, the branch models tagged', models[1].parsed.invStep === 'Weak (loadings)' && models[2].parsed.invStep === 'Strong (intercepts)' && !models[2].parsed.invBranch && models[3].parsed.invBranch?.partial.scalar.join() === 'Z2' && models[6].parsed.invBranch?.text === 'partial strong: Z2', models.map((m) => m.parsed.invStep));
  ok('labels', models.map((m) => m.label).join(' | ') === 'Configural | Weak (loadings) | Strong (intercepts) | Partial strong (Z2 intercept free) | Strict (residuals) | Factor var/cov | Latent means', models.map((m) => m.label));
  const chi = models.map((m) => `${apa2(m.parsed.fit.chi2)} (${m.parsed.fit.df})`);
  ok('χ² (df) of the chapter\'s Table 27.1: 76.025 (66), 109.697 (93), 3013.353 (102), 123.025 (101), 135.819 (113), 157.798 (119), 159.461 (122)', chi.join(', ') === '76.03 (66), 109.70 (93), 3013.35 (102), 123.03 (101), 135.82 (113), 157.80 (119), 159.46 (122)', chi);
  const series = invarianceSeries([...models].reverse());
  ok('series: seven rows in sequence order, the full strong model reported but not retained', series.map((r) => r.m.label + (r.retained ? '' : '†')).join(' | ') === 'Configural | Weak (loadings) | Strong (intercepts)† | Partial strong (Z2 intercept free) | Strict (residuals) | Factor var/cov | Latent means', series.map((r) => r.m.label));
  ok('the strong model went beyond the guideline, the partial model and the later steps stayed within it', series[2].dec.ok === false && series.slice(3).every((r) => r.dec.ok === true), series.map((r) => r.dec.ok));
  ok('every later row compares with the retained chain', series[3].prev === models[1] && series[4].prev === models[3] && series[5].prev === models[4] && series[6].prev === models[5]);
  const html = renderInvarianceTable(models);
  ok('table: the partial row with the chapter\'s values, the dagger, the note', /<td>Partial strong \(Z2 intercept free\)<\/td><td>123\.03<\/td><td>101<\/td>/.test(html) && /Strong \(intercepts\)<sup>†<\/sup><\/td><td>3013\.35<\/td>/.test(html) && /The partial strong model frees the Z2 intercept — the parameter with the largest modification index of the strong \(intercepts\) model, which is reported but not retained — and is compared with the weak \(loadings\) model; the strict \(residuals\), factor var\/cov, and latent means models are built from it/.test(html), html.match(/<p class="apa-note">[\s\S]*?<\/p>/)?.[0]);
  const prose = invarianceProseText(models);
  ok('prose: the Z2 modification index (2568.6) and the partial strong model', /The strong \(intercepts\) model went beyond/.test(prose) && /pointed to the Z2 intercept \(MI = 2568\.6\)/.test(prose) && /partial strong \(z2 intercept free\) model stayed within the guideline relative to the weak \(loadings\) model/.test(prose) && /strict \(residuals\), factor var\/cov, and latent means models, built from the partial strong model, stayed within the guideline/.test(prose), prose);
  ok('Word export carries the partial row', /Partial strong \(Z2 intercept free\)/.test(buildWordHtml(models)));
}

section('real Mplus 9.1.1 runs: Data 2 bifactor-ESEM across time (z2 freed) and an ordinal chain with DIFFTEST');
{
  const strong = parseOut(fx('v91_LongInv_besem_3_scalar.out')), p3 = parseOut(fx('v91_LongInv_besem_3p_scalar.out')), p6 = parseOut(fx('v91_LongInv_besem_6p_latentmean.out'));
  ok('Data 2: full strong 3427.376 (204) with CONVERGENCE = .005, partial strong 217.187 (203) and latent means 2699.858 (229) without it (Table 27.1)', apa2(strong.fit.chi2) === '3427.38' && strong.fit.df === 204 && apa2(p3.fit.chi2) === '217.19' && p3.fit.df === 203 && apa2(p6.fit.chi2) === '2699.86' && p6.fit.df === 229, [strong.fit.chi2, p3.fit.chi2, p6.fit.chi2]);
  ok('Data 2: longitudinal titles, the pair named in the tag', strong.invKind === 'longitudinal' && strong.invModel === 'besem' && invarianceLabel(p3) === 'Partial strong (z2_t1/z2_t2 intercept free)' && p6.invBranch.partial.scalar.join() === 'z2_t1/z2_t2', invarianceLabel(p3));
  ok('Data 2: the latent-means model goes beyond the guideline, as in the chapter', invarianceSeries([{ label: invarianceLabel(strong), parsed: strong }, { label: invarianceLabel(p3), parsed: p3 }, { label: invarianceLabel(p6), parsed: p6 }])[2].dec.ok === false);
  const c3 = parseOut(fx('v91_cat_Inv_3_scalar.out')), c3p = parseOut(fx('v91_cat_Inv_3p_scalar.out')), c4p = parseOut(fx('v91_cat_Inv_4p_strict.out'));
  ok('ordinal chain: WLSMV, the partial strong model three df lower (three of duy2_t1\'s four thresholds freed)', /WLSMV/.test(c3p.estimator) && c3.fit.df === 126 && c3p.fit.df === 123 && c4p.fit.df === 135, [c3.fit.df, c3p.fit.df, c4p.fit.df]);
  ok('ordinal chain: DIFFTEST reported by the partial strong model (vs weak) and by strict@p (vs the partial model)', c3p.diffTest && c3p.diffTest.df === 30 && c4p.diffTest && c4p.diffTest.df === 12, [c3p.diffTest, c4p.diffTest]);
  ok('ordinal chain: label "Partial strong (duy2_t1 thresholds free)"', invarianceLabel(c3p) === 'Partial strong (duy2_t1 thresholds free)' && c3p.invStep === 'Strong (thresholds)', invarianceLabel(c3p));
}

console.log(`\npartial.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
