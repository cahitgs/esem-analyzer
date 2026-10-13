// invorder.test.mjs — invariance rows keep the sequence order whatever the arrival order, outputs without
// fit statistics are marked "Not estimated" and skipped by the comparisons (not sorted to the top), the
// checked measurement models are generated on the total sample when grouping is on, and ID-like columns
// are kept out of the items. Fixtures mg_notestimated_scalar.out / mg_besem_nochisq_configural.out are real
// Mplus 8.3 runs in which an ID column had been selected as an item. Run: node test/invorder.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut } from '../js/out-parser.js';
import { sortInvarianceModels, invarianceSeries, renderInvarianceTable, renderInvarianceProse, noFitReason, renderProse, renderFitTable } from '../js/apa-render.js';
import { buildWordHtml } from '../js/docx-export.js';
import { buildInp, requestedModels } from '../js/syntax-generator.js';
import { createModelSpec, setItems, setFactorCount, setWaveItems, setTime1, validateSpec, looksLikeId, pairWavesByName, guessWaveCounterparts, nameSubstitution, consistentWavePairs, orderWave2, carriedKeys, mapByKey } from '../js/state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(HERE, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };
const STEPS = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const LABELS = ['Configural', 'Metric (loadings)', 'Scalar (intercepts)', 'Strict (residuals)', 'Factor var/cov', 'Latent means'];

console.log('\n— outputs without fit statistics —');
const scalarBad = parseOut(fx('mg_notestimated_scalar.out'));
const besemBad = parseOut(fx('mg_besem_nochisq_configural.out'));
ok('scalar: terminated normally but the rotation failed → no fit', scalarBad.converged && scalarBad.rotationFailed && scalarBad.fit.chi2 == null, scalarBad.fit);
ok('scalar: reason = rotation did not converge', noFitReason(scalarBad) === 'rotation did not converge', noFitReason(scalarBad));
ok('bifactor configural: robust χ² not computed', besemBad.chiSquareComputed === false && noFitReason(besemBad) === 'χ² could not be computed', noFitReason(besemBad));
ok('scalar: step parsed from the TITLE', scalarBad.invStep === 'Scalar (intercepts)', scalarBad.invStep);
ok('a converged output with fit → no reason', noFitReason(parseOut(fx('inv_metric.out'))) === null);

console.log('\n— sequence order regardless of arrival order —');
const besem = Object.fromEntries(STEPS.map((s, i) => [s, parseOut(fx(`mg_besem_${i + 1}_${s}.out`))]));
const arrival = ['latentmean', 'scalar', 'configural', 'varcov', 'metric', 'strict'].map((s) => ({ label: besem[s].invStep, parsed: besem[s] }));
const sorted = sortInvarianceModels(arrival).map((m) => m.label);
ok('sorted: configural → … → latent means', sorted.join(' | ') === LABELS.join(' | '), sorted);
ok('input array not mutated', arrival[0].label === 'Latent means');
const html = renderInvarianceTable(arrival);
ok('table: first row is Configural', /<tbody><tr><td>Configural<\/td>/.test(html));
ok('table: all six rows estimated', !/Not estimated/.test(html));
ok('Morin-style labels sort too', sortInvarianceModels([
  { label: 'Latent Means Invariance', parsed: { fit: {} } }, { label: 'Strong Invariance', parsed: { fit: {} } },
  { label: 'Latent Variances and Covariances Invariance', parsed: { fit: {} } }, { label: 'Weak Invariance', parsed: { fit: {} } },
  { label: 'Configural Invariance', parsed: { fit: {} } }, { label: 'Strict Invariance', parsed: { fit: {} } },
]).map((m) => m.label.split(' ')[0]).join() === 'Configural,Weak,Strong,Strict,Latent,Latent');

console.log('\n— a failed step keeps its place and is skipped by the comparisons —');
const esemFx = (n, label) => ({ label, parsed: parseOut(fx(n)) });
const mixed = [esemFx('inv_metric.out', 'Metric (loadings)'), { label: scalarBad.invStep, parsed: scalarBad }, esemFx('inv_configural.out', 'Configural'), esemFx('inv_strict.out', 'Strict (residuals)')];
const series = invarianceSeries(mixed);
ok('series order configural, metric, scalar, strict', series.map((r) => r.m.label).join(' | ') === LABELS.slice(0, 4).join(' | '), series.map((r) => r.m.label));
ok('scalar row marked unestimated', series[2].estimated === false && series[2].dec.text === 'Not estimated');
ok('strict compares with metric (nearest estimated model)', series[3].prev?.label === 'Metric (loadings)' && series[3].dec.text !== '—' && series[3].dec.dcfi != null, series[3].dec);
const h2 = renderInvarianceTable(mixed);
ok('table: Configural first even though the failed scalar has no df', h2.indexOf('<td>Configural</td>') < h2.indexOf('<td>Scalar (intercepts)</td>'));
ok('table: Not estimated cell + note naming the model and the reason', /Not estimated<\/span>/.test(h2) && /Not estimated: Mplus produced no fit statistics for Scalar \(intercepts\) \(rotation did not converge\)/.test(h2));
ok('table: strict row carries a decision', /<td>Strict \(residuals\)<\/td>(?:<td>[^<]*<\/td>){10}<td><span[^>]*>(Supported|Not supported)<\/span>/.test(h2));
const prose = renderInvarianceProse(mixed);
ok('prose: names the unestimated model, no empty parentheses', /scalar \(intercepts\) model could not be estimated \(rotation did not converge\)/.test(prose) && !/\(\)/.test(prose), prose);
const word = buildWordHtml(mixed);
ok('Word export: Configural first and the Not estimated row', word.indexOf('Configural') < word.indexOf('Scalar (intercepts)') && /Not estimated/.test(word));

console.log('\n— grouping on: measurement models on the total sample, then the invariance chains —');
const items = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
const spec = createModelSpec({ fileName: 'esem_sim_3f.dat', delimiter: 'whitespace', hasHeader: false, nCols: 14, nRows: 1000, varNames: ['id', ...items, 'cinsiyet'], categorical: [], missingCode: null });
setItems(spec, items); setFactorCount(spec, 3);
items.forEach((it, i) => { spec.target[it] = { F1: i < 4, F2: i >= 4 && i < 8, F3: i >= 8 }; });
spec.modelTypes = { cfa: true, esem: true, bifactorCfa: true, bifactorEsem: true };
spec.groups = { enabled: true, variable: 'cinsiyet', codes: [{ code: 1, label: 'kadin' }, { code: 2, label: 'erkek' }], invariance: { sequence: [...STEPS] } };
const keys = requestedModels(spec).map((m) => m.key);
ok('order: 4 measurement models, then inv, then binv', keys.join() === ['cfa', 'esem', 'bifactorCfa', 'bifactorEsem', ...STEPS.map((s) => 'inv:' + s), ...STEPS.map((s) => 'binv:' + s)].join(), keys);
const cfa = buildInp(spec, 'cfa'), esem = buildInp(spec, 'esem'), besemInp = buildInp(spec, 'bifactorEsem');
ok('CFA / ESEM / bifactor-ESEM on the total sample: no GROUPING line', ![cfa, esem, besemInp].some((t) => /GROUPING/.test(t)));
ok('invariance models keep the GROUPING line', /GROUPING IS cinsiyet \(1 = kadin 2 = erkek\);/.test(buildInp(spec, 'inv:configural')) && /GROUPING IS cinsiyet/.test(buildInp(spec, 'binv:configural')));
ok('no grouping → same measurement models, no chains', requestedModels({ ...spec, groups: { ...spec.groups, enabled: false } }).map((m) => m.key).join() === 'cfa,esem,bifactorCfa,bifactorEsem');

console.log('\n— ID-like columns —');
const matrix = Array.from({ length: 40 }, (_, r) => [String(r + 1), String((r % 5) + 1), String(((r * 7) % 5) + 1), String((r % 2) + 1)]);
const data = { fileName: 'x.dat', delimiter: 'whitespace', hasHeader: true, nCols: 4, nRows: 40, varNames: ['id', 'm1', 'm2', 'grup'], categorical: [], missingCode: null, _matrix: matrix };
ok('looksLikeId: id column → true, Likert item → false, group → false', looksLikeId(data, 'id') === true && looksLikeId(data, 'm1') === false && looksLikeId(data, 'grup') === false);
ok('looksLikeId without data: the name decides', looksLikeId({ varNames: ['id', 'x1'] }, 'id') === true && looksLikeId({ varNames: ['id', 'x1'] }, 'x1') === false);
const s2 = createModelSpec(data);
ok('default item selection skips the id column', !s2.items.includes('id') && s2.items.includes('m1'), s2.items);
setItems(s2, ['id', 'm1', 'm2', 'grup']); setFactorCount(s2, 1);
const w = validateSpec(s2).warnings.join(' | ');
ok('validateSpec warns about the id item', /^id looks like a case identifier/.test(w) || / id looks like a case identifier/.test(w), w);

console.log('\n— longitudinal sequences: same order rule, same unestimated handling —');
const lsteps = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const lfx = Object.fromEntries(lsteps.map((s) => [s, parseOut(fx(`long_esem_${s}.out`))]));
const larrival = ['varcov', 'latentmean', 'metric', 'configural', 'strict', 'scalar'].map((s) => ({ label: lfx[s].invStep, parsed: lfx[s] }));
ok('longitudinal titles carry the step', larrival.every((m) => m.parsed.invKind === 'longitudinal' && m.parsed.invStep), larrival.map((m) => m.parsed.invStep));
ok('sorted: configural → … → latent means', sortInvarianceModels(larrival).map((m) => m.label).join(' | ') === LABELS.join(' | '), sortInvarianceModels(larrival).map((m) => m.label));
const lh = renderInvarianceTable(larrival, { longitudinal: true });
ok('longitudinal table: Configural first, "two time points" note', /<tbody><tr><td>Configural<\/td>/.test(lh) && /across two time points/.test(lh));
// a step whose Mplus run did not converge (fit stripped, converged=false) keeps its place and is skipped
const broken = larrival.map((m) => (m.label === 'Scalar (intercepts)' ? { label: m.label, parsed: { ...m.parsed, fit: {}, converged: false } } : m));
const ls = invarianceSeries(broken);
ok('non-converged scalar: 3rd row, Not estimated, reason "did not converge"', ls[2].m.label === 'Scalar (intercepts)' && !ls[2].estimated && ls[2].reason === 'did not converge', ls[2]);
ok('strict then compares with metric', ls[3].prev?.label === 'Metric (loadings)' && ls[3].dec.text !== '—');
const lw = buildWordHtml(broken);
ok('Word export (longitudinal): Configural first, Not estimated row present', lw.indexOf('Configural') < lw.indexOf('Scalar (intercepts)') && /Not estimated/.test(lw));

console.log('\n— single-group model without fit statistics —');
const bcfa = { label: 'Bifactor-CFA', parsed: parseOut(fx('bifactor_cfa.out')) };
const okEsem = { label: 'ESEM', parsed: parseOut(fx('esem_geomin.out')) };
ok('fixture: converged but χ² not computed', bcfa.parsed.converged && noFitReason(bcfa.parsed) === 'χ² could not be computed', noFitReason(bcfa.parsed));
const pr = renderProse([okEsem, bcfa]);
ok('prose: unestimated model named with its reason, no "undefined"', /Bifactor-CFA model could not be estimated \(χ² could not be computed\)/.test(pr) && !/undefined/.test(pr), pr);
ok('prose: the estimated model keeps its fit sentence', /ESEM model provided/.test(pr));
const ft = renderFitTable([okEsem, bcfa]);
ok('fit table: dashes for the unestimated row + note with the reason', /<td>Bifactor-CFA<\/td><td>—<\/td>/.test(ft) && /Not estimated: Mplus produced no fit statistics for Bifactor-CFA \(χ² could not be computed\)/.test(ft));
const wsg = buildWordHtml([okEsem, bcfa]);
ok('Word export: same sentence and note, no "undefined"', /could not be estimated \(χ² could not be computed\)/.test(wsg) && /Not estimated: Mplus produced no fit statistics/.test(wsg) && !/undefined/.test(wsg));

console.log('\n— comparison sentence, loglikelihood-only outputs, remaining reasons —');
const cfa2 = { label: 'CFA', parsed: parseOut(fx('cfa_2f.out')) };
const pr3 = renderProse([cfa2, okEsem, bcfa]);
ok('comparison sentence uses the estimated models only', /Relative to the CFA solution/.test(pr3) && /in the ESEM solution/.test(pr3) && !/in the Bifactor-CFA solution/.test(pr3), pr3.slice(-300));
ok('comparison paragraph is not double-wrapped', !/<p class="apa-prose"><p class="apa-prose">/.test(pr3) && !/<\/p><\/p>/.test(pr3));
const seOnly = { label: 'SE-only', parsed: { ...okEsem.parsed, fit: {}, seComputed: false } };
ok('reason: standard errors could not be computed', noFitReason(seOnly.parsed) === 'standard errors could not be computed' && /could not be estimated \(standard errors could not be computed\)/.test(renderProse([seOnly])));
const bare = { label: 'Bare', parsed: { ...okEsem.parsed, fit: {} } };
ok('reason fallback: no fit statistics reported', noFitReason(bare.parsed) === 'no fit statistics reported');
const llOnly = { label: 'CFA (MLR, categorical)', parsed: { ...okEsem.parsed, fit: { logLik: -1234.5, aic: 2500.1, bic: 2600.2 } } };
ok('loglikelihood-only output counts as estimated', noFitReason(llOnly.parsed) === null);
const prLL = renderProse([llOnly]);
ok('prose: loglikelihood-only sentence, no "could not be estimated", no undefined', /converged \(log-likelihood = [-−]?1234\.50/.test(prLL) && !/could not be estimated/.test(prLL) && !/undefined/.test(prLL), prLL);
ok('fit-table note explains the missing χ² indices', /no χ²-based fit indices/.test(renderFitTable([okEsem, llOnly])));
const wLL = buildWordHtml([okEsem, llOnly]);
ok('Word export: same for a loglikelihood-only output', /converged \(log-likelihood = [-−]?1234\.50/.test(wLL) && /no χ²-based fit indices/.test(wLL) && !/undefined/.test(wLL));
ok('note escapes a label with < in the HTML path only', /&lt;x&gt;/.test(renderFitTable([{ label: 'A <x>', parsed: bcfa.parsed }])));

console.log('\n— Time-2 columns guessed for a Time-1 selection —');
const sub = (a, b) => { const d = nameSubstitution(a, b); return d ? `${d.ma}→${d.mb}` : ''; };
const G = (names, t1) => guessWaveCounterparts({ varNames: names }, t1).join();
const seq = (pre, n, suf = '') => Array.from({ length: n }, (_, i) => `${pre}${i + 1}${suf}`);
ok('substitution = one whole token: x1_t1→x1_t2 "1→2", V10→V20 "10→20", X1→Y1 "X→Y", pre_x1→post_x1 "pre→post", A_pre→A_post "pre→post", w1x1→w2x1 "1→2", x1→x1_2 "→_2"',
  sub('x1_t1', 'x1_t2') === '1→2' && sub('V10', 'V20') === '10→20' && sub('X1', 'Y1') === 'X→Y' && sub('pre_x1', 'post_x1') === 'pre→post' && sub('A_pre', 'A_post') === 'pre→post' && sub('w1x1', 'w2x1') === '1→2' && sub('x1', 'x1_2') === '→_2',
  [sub('V10', 'V20'), sub('x1', 'x1_2')]);
ok('no substitution for two changed tokens (x1_t1→y2_t1); an inserted digit widens to the whole number (x1→x12 is 1→12, never 1→2)', sub('x1_t1', 'y2_t1') === '' && sub('x1', 'x12') === '1→12', [sub('x1_t1', 'y2_t1'), sub('x1', 'x12')]);
ok('anchored keys: the item number (duy1_t1→duy2_t1) and the wave (duy1_t1→duy1_t2) are different keys', !nameSubstitution('duy1_t1', 'duy2_t1').keys.some((k) => nameSubstitution('duy1_t1', 'duy1_t2').keys.includes(k)));
const t1n = seq('m', 12, '_t1'), t2n = seq('m', 12, '_t2');
ok('by name: m1_t1 … m12_t1 → m1_t2 … m12_t2 (id skipped)', G(['id', ...t1n, ...t2n], t1n) === t2n.join());
const vnames = { varNames: Array.from({ length: 25 }, (_, i) => `V${i + 1}`), _matrix: Array.from({ length: 40 }, (_, r) => [String(r + 1), ...Array.from({ length: 24 }, (_, c) => String(((r * 7 + c) % 5) + 1))]) };
const vt1 = vnames.varNames.slice(1, 13);
ok('no header (V1 = id): Time 2 is the block after Time 1, not "V1 + the next eleven"', guessWaveCounterparts(vnames, vt1).join() === vnames.varNames.slice(13, 25).join(), guessWaveCounterparts(vnames, vt1));
ok('Morin ESEM.dat: X1–X6 → Y1–Y6', G(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'GV'], ['X1', 'X2', 'X3', 'X4', 'X5', 'X6']) === 'Y1,Y2,Y3,Y4,Y5,Y6');
ok('Ch27 Data 2 names pair by name', pairWavesByName({ varNames: ['x1_t1', 'y1_t1', 'z1_t1', 'x1_t2', 'y1_t2', 'z1_t2'] }, ['x1_t1', 'y1_t1', 'z1_t1']).join() === 'x1_t2,y1_t2,z1_t2');
const v26 = { varNames: Array.from({ length: 26 }, (_, i) => `V${i + 1}`), _matrix: Array.from({ length: 40 }, (_, r) => [String(r + 1), ...Array.from({ length: 25 }, (_, c) => String(((r * 7 + c) % 5) + 1))]) };
const v10 = ['V10', 'V11', 'V12', 'V13', 'V14', 'V15'];
ok('V10…V15 (headerless, id in V1): no by-name pairing, block after → V16…V21 (not V20…V25)', pairWavesByName(v26, v10) === null && guessWaveCounterparts(v26, v10).join() === 'V16,V17,V18,V19,V20,V21', guessWaveCounterparts(v26, v10));
ok('Time 2 before Time 1 with trailing covariates: X1…X6 → Y1…Y6 by name', G(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'GV', 'AGE', 'SEX', 'INC', 'EDU', 'REG'], ['X1', 'X2', 'X3', 'X4', 'X5', 'X6']) === 'Y1,Y2,Y3,Y4,Y5,Y6');
ok('interleaved pre/post with trailing covariates: *_pre → *_post by name', G(['A_pre', 'A_post', 'B_pre', 'B_post', 'C_pre', 'C_post', 'age', 'sex', 'grp'], ['A_pre', 'B_pre', 'C_pre']) === 'A_post,B_post,C_post');
const x30 = ['id', ...seq('x', 30, '_pre'), ...seq('x', 30, '_post')];
ok('items 10–15 of a 30-item pre/post inventory → x10_post…x15_post (never x20_pre…)', G(x30, seq('x', 15, '_pre').slice(9)) === seq('x', 15, '_post').slice(9).join());
const w3 = ['id', ...seq('x', 3, '_t1'), ...seq('x', 3, '_t2'), ...seq('x', 3, '_t3')];
ok('3-wave file: Time 1 = wave 1 → wave 2; Time 1 = wave 2 → wave 3 (not back to wave 1)', G(w3, seq('x', 3, '_t1')) === seq('x', 3, '_t2').join() && G(w3, seq('x', 3, '_t2')) === seq('x', 3, '_t3').join(), [G(w3, seq('x', 3, '_t2'))]);
ok('pre/post/fu: Time 1 = *_pre → *_post (not *_fu)', G(['id', ...seq('x', 4, '_pre'), ...seq('x', 4, '_post'), ...seq('x', 4, '_fu')], seq('x', 4, '_pre')) === seq('x', 4, '_post').join());
ok('two scales at two waves: dep*_pre → dep*_post (never the anxiety items)', G(['id', ...seq('dep', 6, '_pre'), ...seq('dep', 6, '_post'), ...seq('anx', 6, '_pre'), ...seq('anx', 6, '_post'), 'age'], seq('dep', 6, '_pre')) === seq('dep', 6, '_post').join());
ok('unsuffixed Time 1 with covariates between the waves: x1…x6 → x1_2…x6_2', G(['id', ...seq('x', 6), 'age', 'sex', 'edu', 'inc', 'reg', 'grp', ...seq('x', 6, '_2')], seq('x', 6)) === seq('x', 6, '_2').join());
ok('two unsuffixed scales with _fu follow-ups: sat1…sat6 → sat1_fu…sat6_fu (never eng*)', G(['id', ...seq('sat', 6), ...seq('eng', 6), ...seq('sat', 6, '_fu'), ...seq('eng', 6, '_fu')], seq('sat', 6)) === seq('sat', 6, '_fu').join());
ok('Turkish wave words with covariates between: x*_ön → x*_son', G(['id', ...seq('x', 6, '_ön'), 'yaş', 'cins', 'eğt', 'gelir', 'bölge', 'grup', ...seq('x', 6, '_son')], seq('x', 6, '_ön')) === seq('x', 6, '_son').join());
const x20 = ['id', ...seq('x', 20, '_t1'), ...seq('x', 20, '_t2'), 'age', 'sex'];
ok('item subset that drops item 2 (x1, x3…x6) still pairs with its own _t2 columns', G(x20, ['x1_t1', 'x3_t1', 'x4_t1', 'x5_t1', 'x6_t1']) === 'x1_t2,x3_t2,x4_t2,x5_t2,x6_t2', G(x20, ['x1_t1', 'x3_t1', 'x4_t1', 'x5_t1', 'x6_t1']));
const iyi = ['duy1_t1', 'duy2_t1', 'duy3_t1', 'duy4_t1', 'psi1_t1', 'psi2_t1', 'psi3_t1', 'psi4_t1', 'sos1_t1', 'sos2_t1', 'sos3_t1', 'sos4_t1', 'duy1_t2', 'duy2_t2', 'duy3_t2', 'duy4_t2', 'psi1_t2', 'psi2_t2', 'psi3_t2', 'psi4_t2', 'sos1_t2', 'sos2_t2', 'sos3_t2', 'sos4_t2', 'okul'];
ok('iyiolus layout minus duy2_t1 → the matching _t2 columns', G(iyi, iyi.slice(0, 12).filter((v) => v !== 'duy2_t1')) === iyi.slice(12, 24).filter((v) => v !== 'duy2_t2').join());
ok('one item per scale (duy1, psi1, sos1) → their _t2 columns, not the item-2 siblings', G(iyi, ['duy1_t1', 'psi1_t1', 'sos1_t1']) === 'duy1_t2,psi1_t2,sos1_t2', G(iyi, ['duy1_t1', 'psi1_t1', 'sos1_t1']));
ok('T1 vs T3 selection is a consistent pairing; a shifted one is not', consistentWavePairs(seq('x', 3, '_t1'), seq('x', 3, '_t3')) === true && consistentWavePairs(['m1_t1', 'm2_t1'], ['id', 'm1_t2']) === false);
{
  const s3 = createModelSpec({ fileName: 'w3.dat', delimiter: 'whitespace', hasHeader: true, nCols: 10, nRows: 500, varNames: w3, categorical: [], missingCode: null });
  s3.longitudinal.enabled = true; setWaveItems(s3, 0, seq('x', 3, '_t1')); setWaveItems(s3, 1, seq('x', 3, '_t3')); setFactorCount(s3, 1);
  ok('validateSpec: wave 1 vs wave 3 → no pairing warning', !/does not pair/.test(validateSpec(s3).warnings.join(' | ')), validateSpec(s3).warnings);
  const s4 = createModelSpec({ fileName: 'v.dat', delimiter: 'whitespace', hasHeader: false, nCols: 26, nRows: 40, varNames: v26.varNames, categorical: [], missingCode: null, _matrix: v26._matrix });
  s4.longitudinal.enabled = true; setWaveItems(s4, 0, v10); setWaveItems(s4, 1, ['V16', 'V17', 'V18', 'V19', 'V20', 'V21']); setFactorCount(s4, 1);
  ok('validateSpec: positional names (V10… vs V16…) → no pairing warning', !/does not pair/.test(validateSpec(s4).warnings.join(' | ')), validateSpec(s4).warnings);
  const s5 = createModelSpec({ fileName: 'v.dat', delimiter: 'whitespace', hasHeader: false, nCols: 25, nRows: 40, varNames: vnames.varNames, categorical: [], missingCode: null, _matrix: vnames._matrix });
  s5.longitudinal.enabled = true; setWaveItems(s5, 0, vt1); setWaveItems(s5, 1, ['V1', ...vnames.varNames.slice(13, 24)]); setFactorCount(s5, 3);
  ok('validateSpec: id column inside Time 2 → warning', /V1 looks like a case identifier — remove it from Time 2/.test(validateSpec(s5).warnings.join(' | ')), validateSpec(s5).warnings);
  const s6 = createModelSpec({ fileName: 'x.dat', delimiter: 'whitespace', hasHeader: true, nCols: 25, nRows: 1000, varNames: ['id', ...t1n, ...t2n], categorical: [], missingCode: null });
  s6.longitudinal.enabled = true; setWaveItems(s6, 0, t1n); setWaveItems(s6, 1, ['id', ...t2n.slice(0, 11)]); setFactorCount(s6, 3);
  ok('validateSpec: shifted Time 2 → "does not pair … one-to-one" warning naming the first bad pair', /does not pair with Time 1 one-to-one by name \(m1_t1 ↔ id, expected m1_t2\) — expected order m1_t2, m2_t2, m3_t2/.test(validateSpec(s6).warnings.join(' | ')), validateSpec(s6).warnings);
  setWaveItems(s6, 1, t2n);
  ok('validateSpec: correct pairing → no pairing warning', !/does not pair/.test(validateSpec(s6).warnings.join(' | ')));
}
const scr = { varNames: ['id', 'a1_t1', 'b1_t1', 'c1_t1', 'c1_t2', 'a1_t2', 'b1_t2'] };
ok('orderWave2 keeps the by-name order when the selection is the by-name set', orderWave2(scr, ['a1_t1', 'b1_t1', 'c1_t1'], new Set(['c1_t2', 'a1_t2', 'b1_t2'])).join() === 'a1_t2,b1_t2,c1_t2');
ok('orderWave2: a subset of the by-name set keeps the pairing order (a1_t2 before c1_t2)', orderWave2(scr, ['a1_t1', 'b1_t1', 'c1_t1'], new Set(['c1_t2', 'a1_t2'])).join() === 'a1_t2,c1_t2');
ok('orderWave2 falls back to column order for positional names', orderWave2({ varNames: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'] }, ['V2', 'V3'], new Set(['V6', 'V4', 'V5'])).join() === 'V4,V5,V6');
{
  // the Time-1 toggle flow: drop a2_t1 → Time 2 follows with the same key, even with the Time-2 block stored in reverse
  const rev = { varNames: ['id', 'a1_t1', 'a2_t1', 'b1_t1', 'b2_t1', 'b2_t2', 'b1_t2', 'a2_t2', 'a1_t2'] };
  const w1 = ['a1_t1', 'a2_t1', 'b1_t1', 'b2_t1'], w2 = guessWaveCounterparts(rev, w1);
  ok('reverse-stored Time 2 pairs by name', w2.join() === 'a1_t2,a2_t2,b1_t2,b2_t2', w2);
  const key = carriedKeys(w1, w2);
  ok('sharedPairKey + mapByKey carry the pairing through a Time-1 change', key.length > 0 && mapByKey(rev, ['a1_t1', 'b1_t1', 'b2_t1'], key).join() === 'a1_t2,b1_t2,b2_t2', mapByKey(rev, ['a1_t1', 'b1_t1', 'b2_t1'], key));
  const k3 = carriedKeys(seq('x', 3, '_t1'), seq('x', 3, '_t3'));
  ok('a wave-3 choice survives a Time-1 change (mapByKey with the t1→t3 key)', mapByKey({ varNames: w3 }, ['x1_t1', 'x3_t1'], k3).join() === 'x1_t3,x3_t3');
}

console.log('\n— pairing: third-round scenarios —');
ok('camelCase boundary: preSE1 → postSE1 is "pre→post"', sub('preSE1', 'postSE1') === 'pre→post' && sub('preDep1', 'postDep1') === 'pre→post');
ok('one item per scale with word waves → the _post columns, not item 2', G(['id', ...seq('dep', 6, '_pre'), ...seq('anx', 6, '_pre'), ...seq('dep', 6, '_post'), ...seq('anx', 6, '_post'), 'age'], ['dep1_pre', 'anx1_pre']) === 'dep1_post,anx1_post', G(['id', ...seq('dep', 6, '_pre'), ...seq('anx', 6, '_pre'), ...seq('dep', 6, '_post'), ...seq('anx', 6, '_post'), 'age'], ['dep1_pre', 'anx1_pre']));
ok('one item per scale, Turkish words', G(['id', ...seq('duy', 4, '_ön'), ...seq('psi', 4, '_ön'), ...seq('sos', 4, '_ön'), ...seq('duy', 4, '_son'), ...seq('psi', 4, '_son'), ...seq('sos', 4, '_son'), 'okul'], ['duy1_ön', 'psi1_ön', 'sos1_ön']) === 'duy1_son,psi1_son,sos1_son');
const f12 = ['id', ...seq('f1_', 6, '_pre'), ...seq('f2_', 6, '_pre'), ...seq('f1_', 6, '_post'), ...seq('f2_', 6, '_post'), 'age'];
ok('numbered scales f1_k / f2_k: the scale number is not the wave', G(f12, seq('f1_', 6, '_pre')) === seq('f1_', 6, '_post').join(), G(f12, seq('f1_', 6, '_pre')));
const Fi = ['id', ...seq('F1i', 4, '_T1'), ...seq('F2i', 4, '_T1'), ...seq('F1i', 4, '_T2'), ...seq('F2i', 4, '_T2')];
ok('numbered scales with numeric waves (F1i1_T1): wave, not scale', G(Fi, seq('F1i', 4, '_T1')) === seq('F1i', 4, '_T2').join(), G(Fi, seq('F1i', 4, '_T1')));
const ab = ['id', ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`a${i}_pre`, `a${i}_post`]), ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`b${i}_pre`, `b${i}_post`]), 'age', 'sex'];
ok('letter scales a/b, per-item interleaving: a*_pre → a*_post (not b*_pre)', G(ab, seq('a', 6, '_pre')) === seq('a', 6, '_post').join(), G(ab, seq('a', 6, '_pre')));
ok('letter scales x/y with _2 follow-ups: x1…x6 → x1_2…x6_2 (not y1…y6)', G(['id', ...seq('x', 6), ...seq('y', 6), ...seq('x', 6, '_2'), ...seq('y', 6, '_2')], seq('x', 6)) === seq('x', 6, '_2').join());
ok('letter scales x/y with pre/post: x*_pre → x*_post', G(['id', ...seq('x', 6, '_pre'), ...seq('y', 6, '_pre'), ...seq('x', 6, '_post'), ...seq('y', 6, '_post')], seq('x', 6, '_pre')) === seq('x', 6, '_post').join());
for (const mk of ['_t2', '_w2', '_T2', '_time2', '_wave2']) ok(`unsuffixed Time 1 with ${mk} follow-ups and covariates between → the ${mk} columns`, G(['id', ...seq('x', 6), 'age', 'sex', 'edu', 'inc', 'reg', 'grp', ...seq('x', 6, mk)], seq('x', 6)) === seq('x', 6, mk).join(), G(['id', ...seq('x', 6), 'age', 'sex', 'edu', 'inc', 'reg', 'grp', ...seq('x', 6, mk)], seq('x', 6)));
ok('unsuffixed Time 1, _2 and _3 waves, two scales: dep1…dep6 → dep1_2…dep6_2', G([...seq('dep', 6), ...seq('anx', 6), ...seq('dep', 6, '_2'), ...seq('anx', 6, '_2'), ...seq('dep', 6, '_3'), ...seq('anx', 6, '_3')], seq('dep', 6)) === seq('dep', 6, '_2').join());
ok('unknown wave words still pair by coverage (_bl → _fu)', G(['id', ...seq('dep', 6, '_bl'), ...seq('anx', 6, '_bl'), ...seq('dep', 6, '_fu'), ...seq('anx', 6, '_fu')], ['dep1_bl', 'anx1_bl']) === 'dep1_fu,anx1_fu');
ok('scale-major numeric layout, one item per scale → the _t2 columns', G(['id', ...seq('dep', 6, '_t1'), ...seq('dep', 6, '_t2'), ...seq('anx', 6, '_t1'), ...seq('anx', 6, '_t2')], ['dep1_t1', 'anx1_t1']) === 'dep1_t2,anx1_t2');
ok('Time-2 block before Time 1, one item per scale → the _t2 columns', G(['id', 'dep1_t2', 'anx1_t2', 'dep2_t2', 'anx2_t2', 'dep3_t2', 'anx3_t2', 'dep1_t1', 'anx1_t1', 'dep2_t1', 'anx2_t1', 'dep3_t1', 'anx3_t1'], ['dep1_t1', 'anx1_t1']) === 'dep1_t2,anx1_t2');
{
  const glued = createModelSpec({ fileName: 'g.dat', delimiter: 'whitespace', hasHeader: true, nCols: 25, nRows: 300, varNames: ['id', ...seq('preSE', 4), ...seq('preDep', 4), ...seq('preAnx', 4), ...seq('postSE', 4), ...seq('postDep', 4), ...seq('postAnx', 4)], categorical: [], missingCode: null });
  glued.longitudinal.enabled = true; setWaveItems(glued, 0, ['preSE1', 'preDep1', 'preAnx1']); setWaveItems(glued, 1, ['postSE1', 'postDep1', 'postAnx1']); setFactorCount(glued, 1);
  ok('glued wave words: correct selection raises no pairing warning and is the by-name guess', !/does not pair/.test(validateSpec(glued).warnings.join(' | ')) && pairWavesByName(glued.data, ['preSE1', 'preDep1', 'preAnx1']).join() === 'postSE1,postDep1,postAnx1', [validateSpec(glued).warnings, pairWavesByName(glued.data, ['preSE1', 'preDep1', 'preAnx1'])]);
}
{
  const w12 = { varNames: ['id', ...seq('x', 12, '_t1'), ...seq('x', 12, '_t2'), ...seq('x', 12, '_t3')] };
  const keys = carriedKeys(seq('x', 9, '_t1'), seq('x', 9, '_t3'));
  ok('carried keys survive a two-digit item (x10_t1) joining Time 1', mapByKey(w12, [...seq('x', 9, '_t1'), 'x10_t1'], keys)?.join() === [...seq('x', 9, '_t3'), 'x10_t3'].join(), mapByKey(w12, [...seq('x', 9, '_t1'), 'x10_t1'], keys));
  ok('carried keys survive a Time 2 one column short', carriedKeys(seq('x', 6, '_t1'), seq('x', 5, '_t3')).length > 0 && mapByKey(w12, seq('x', 5, '_t1'), carriedKeys(seq('x', 6, '_t1'), seq('x', 5, '_t3'))).join() === seq('x', 5, '_t3').join());
  const rev3 = { varNames: ['id', 'a1_t1', 'a2_t1', 'b1_t1', 'b2_t1', 'b2_t2', 'b1_t2', 'a2_t2', 'a1_t2', 'b2_t3', 'b1_t3', 'a2_t3', 'a1_t3'] };
  const w1 = ['a1_t1', 'a2_t1', 'b1_t1', 'b2_t1'], w2 = ['a1_t3', 'a2_t3', 'b1_t3', 'b2_t3'];
  ok('orderWave2 keeps a wave-3 choice through a chip toggle (reverse-stored block)', orderWave2(rev3, w1, new Set(w2), w2).join() === w2.join() && orderWave2(rev3, w1, new Set(['a1_t3', 'a2_t3', 'b1_t3']), w2).join() === 'a1_t3,a2_t3,b1_t3');
}
console.log('\n— pairing: fourth-round scenarios (prefix waves, four waves, three-wave words, glued words, slid markers) —');
const pre2 = (sc, w) => Array.from({ length: 6 }, (_, i) => `T${w}_${sc}${i + 1}`);
const two = (mk) => ['id', ...mk('dep', 1), ...mk('anx', 1), ...mk('dep', 2), ...mk('anx', 2), 'age', 'sex'];
ok('prefix wave token T1_dep1: Time 1 = T1_dep* → T2_dep* (not T1_anx*)', G(two(pre2), pre2('dep', 1)) === pre2('dep', 2).join(), G(two(pre2), pre2('dep', 1)));
ok('prefix wave token, one item per scale: [T1_dep1, T1_anx1] → [T2_dep1, T2_anx1]', G(two(pre2), ['T1_dep1', 'T1_anx1']) === 'T2_dep1,T2_anx1');
ok('prefix wave token, three waves, Time 1 = wave 2 → wave 3', G(['id', ...pre2('dep', 1), ...pre2('anx', 1), ...pre2('dep', 2), ...pre2('anx', 2), ...pre2('dep', 3), ...pre2('anx', 3)], pre2('dep', 2)) === pre2('dep', 3).join());
for (const [w1, w2] of [['t1', 't2'], ['w1', 'w2'], ['T1', 'T2'], ['pre', 'post']]) {
  const g = (sc, w) => Array.from({ length: 6 }, (_, i) => `${w === 1 ? w1 : w2}${sc}${i + 1}`); // t1dep1…t1dep6 (glued prefix)
  ok(`glued prefix ${w1}dep1 → ${w2}dep1 (not ${w1}anx1)`, G(two(g), g('dep', 1)) === g('dep', 2).join(), G(two(g), g('dep', 1)));
}
ok('glued camelCase prefix T1selfEst1 → T2selfEst1 (not T1lifeSat1)', G(['id', ...seq('T1selfEst', 5), ...seq('T1lifeSat', 5), ...seq('T2selfEst', 5), ...seq('T2lifeSat', 5)], seq('T1selfEst', 5)) === seq('T2selfEst', 5).join());
ok('numbered scales with a prefix wave: T1_F1_* → T2_F1_* (not T1_F2_*)', G(['id', ...seq('T1_F1_', 6), ...seq('T1_F2_', 6), ...seq('T2_F1_', 6), ...seq('T2_F2_', 6)], seq('T1_F1_', 6)) === seq('T2_F1_', 6).join(), G(['id', ...seq('T1_F1_', 6), ...seq('T1_F2_', 6), ...seq('T2_F1_', 6), ...seq('T2_F2_', 6)], seq('T1_F1_', 6)));
ok('bare Time 1 + prefix marker: dep1…dep6 → t2_dep1…t2_dep6 (not anx1…)', G(['id', ...seq('dep', 6), ...seq('anx', 6), ...seq('t2_dep', 6), ...seq('t2_anx', 6)], seq('dep', 6)) === seq('t2_dep', 6).join());
const four = ['id', ...seq('dep', 6, '_t1'), ...seq('anx', 6, '_t1'), ...seq('dep', 6, '_t2'), ...seq('anx', 6, '_t2'), ...seq('dep', 6, '_t3'), ...seq('anx', 6, '_t3'), ...seq('dep', 6, '_t4'), ...seq('anx', 6, '_t4')];
ok('four waves, two scales: dep*_t1 → dep*_t2 (not anx*_t1); dep*_t3 → dep*_t4', G(four, seq('dep', 6, '_t1')) === seq('dep', 6, '_t2').join() && G(four, seq('dep', 6, '_t3')) === seq('dep', 6, '_t4').join(), [G(four, seq('dep', 6, '_t1')), G(four, seq('dep', 6, '_t3'))]);
const six = ['id', ...[1, 2, 3, 4, 5, 6].flatMap((w) => [...seq('dep', 6, `_${w}`), ...seq('anx', 6, `_${w}`)])];
ok('six waves with bare numeric suffixes: dep*_1 → dep*_2 (not anx*_1)', G(six, seq('dep', 6, '_1')) === seq('dep', 6, '_2').join(), G(six, seq('dep', 6, '_1')));
ok('three equal scales with prefix waves still pair with the wave', G(['id', ...pre2('dep', 1), ...pre2('anx', 1), ...pre2('str', 1), ...pre2('dep', 2), ...pre2('anx', 2), ...pre2('str', 2)], pre2('dep', 1)) === pre2('dep', 2).join());
ok('one item per scale, short scales, prefix waves: [t1_x1, t1_y1] → [t2_x1, t2_y1] (not the next item)', G(['id', 't1_x1', 't1_x2', 't1_x3', 't1_y1', 't1_y2', 't1_y3', 't2_x1', 't2_x2', 't2_x3', 't2_y1', 't2_y2', 't2_y3'], ['t1_x1', 't1_y1']) === 't2_x1,t2_y1');
ok('middle wave token, one item per scale: [Dep_T1_1, Anx_T1_1] → [Dep_T2_1, Anx_T2_1]', G(['id', ...seq('Dep_T1_', 3), ...seq('Anx_T1_', 3), ...seq('Dep_T2_', 3), ...seq('Anx_T2_', 3)], ['Dep_T1_1', 'Anx_T1_1']) === 'Dep_T2_1,Anx_T2_1');
// three-wave word tokens
const w3w = (a, b, c) => ['id', ...seq('dep', 6, `_${a}`), ...seq('anx', 6, `_${a}`), ...seq('dep', 6, `_${b}`), ...seq('anx', 6, `_${b}`), ...seq('dep', 6, `_${c}`), ...seq('anx', 6, `_${c}`), 'age'];
ok('pre/post/followup: Time 1 = dep*_post → dep*_followup (not back to pre)', G(w3w('pre', 'post', 'followup'), seq('dep', 6, '_post')) === seq('dep', 6, '_followup').join(), G(w3w('pre', 'post', 'followup'), seq('dep', 6, '_post')));
ok('base/post/fu: Time 1 = dep*_base → dep*_post (not fu)', G(w3w('base', 'post', 'fu'), seq('dep', 6, '_base')) === seq('dep', 6, '_post').join());
ok('baseline/post/followup: Time 1 = dep*_baseline → dep*_post', G(w3w('baseline', 'post', 'followup'), seq('dep', 6, '_baseline')) === seq('dep', 6, '_post').join());
ok('pre/mid/post: Time 1 = dep*_pre → dep*_mid; dep*_mid → dep*_post', G(w3w('pre', 'mid', 'post'), seq('dep', 6, '_pre')) === seq('dep', 6, '_mid').join() && G(w3w('pre', 'mid', 'post'), seq('dep', 6, '_mid')) === seq('dep', 6, '_post').join());
ok('post with an unknown third word: dep*_post → dep*_f1 rather than back to pre', G(w3w('pre', 'post', 'f1'), seq('dep', 6, '_post')) === seq('dep', 6, '_f1').join(), G(w3w('pre', 'post', 'f1'), seq('dep', 6, '_post')));
ok('before/after/later and on/son/izlem chains', G(w3w('before', 'after', 'later'), seq('dep', 6, '_after')) === seq('dep', 6, '_later').join() && G(w3w('on', 'son', 'izlem'), seq('dep', 6, '_son')) === seq('dep', 6, '_izlem').join());
ok('insertion form dep1 / dep1_post / dep1_followup: Time 1 = dep*_post → dep*_followup (not bare)', G(['id', ...seq('dep', 6), ...seq('anx', 6), ...seq('dep', 6, '_post'), ...seq('anx', 6, '_post'), ...seq('dep', 6, '_followup'), ...seq('anx', 6, '_followup')], seq('dep', 6, '_post')) === seq('dep', 6, '_followup').join());
ok('bl/fu1/fu2: dep*_bl → dep*_fu1 (not fu2, not anx); fu1 → fu2', G(w3w('bl', 'fu1', 'fu2'), seq('dep', 6, '_bl')) === seq('dep', 6, '_fu1').join() && G(w3w('bl', 'fu1', 'fu2'), seq('dep', 6, '_fu1')) === seq('dep', 6, '_fu2').join(), [G(w3w('bl', 'fu1', 'fu2'), seq('dep', 6, '_bl')), G(w3w('bl', 'fu1', 'fu2'), seq('dep', 6, '_fu1'))]);
ok('base/fu6/fu12: dep*_base → dep*_fu6', G(w3w('base', 'fu6', 'fu12'), seq('dep', 6, '_base')) === seq('dep', 6, '_fu6').join());
// ASCII Turkish on/son and other substitutions the greedy scan used to miss
ok('nameSubstitution: on→son in every position', sub('x1_on', 'x1_son') === 'on→son' && sub('on_x1', 'son_x1') === 'on→son' && sub('x1on', 'x1son') === 'on→son', [sub('x1_on', 'x1_son'), sub('on_x1', 'son_x1'), sub('x1on', 'x1son')]);
ok('nameSubstitution: a prefix marker starting with the scale letter slides to the start', sub('trust1', 't2_trust1') === '→t2_' && sub('TAS1', 'T2_TAS1') === '→T2_' && sub('pa1', 'post_pa1') === '→post_' && sub('Wb1', 'W2_Wb1') === '→W2_', [sub('trust1', 't2_trust1'), sub('pa1', 'post_pa1')]);
ok('nameSubstitution: letter+digit wave words, two-token changes, digit runs', sub('dep1_bl', 'dep1_fu1') === 'bl→fu1' && sub('x1_t1', 'y2_t1') === '' && sub('V10', 'V20') === '10→20' && sub('x1', 'x12') === '1→12' && sub('dep1_t1', 'dep10_t1') === '1→10', [sub('dep1_bl', 'dep1_fu1'), sub('x1_t1', 'y2_t1'), sub('x1', 'x12')]);
ok('nameSubstitution: glued lowercase wave words split off', sub('predep1', 'postdep1') === 'pre→post' && sub('deppre1', 'deppost1') === 'pre→post' && sub('predep1', 'preanx1') === 'predep→preanx', [sub('predep1', 'postdep1'), sub('deppre1', 'deppost1'), sub('predep1', 'preanx1')]);
ok('ASCII on/son: dep*_on → dep*_son (not anx*_on); single scale with covariates between', G(['id', ...seq('dep', 6, '_on'), ...seq('anx', 6, '_on'), ...seq('dep', 6, '_son'), ...seq('anx', 6, '_son')], seq('dep', 6, '_on')) === seq('dep', 6, '_son').join() && G(['id', ...seq('x', 6, '_on'), 'yas', 'cins', 'egt', 'gelir', 'bolge', 'grup', ...seq('x', 6, '_son')], seq('x', 6, '_on')) === seq('x', 6, '_son').join());
{
  const on = createModelSpec({ fileName: 'on.dat', delimiter: 'whitespace', hasHeader: true, nCols: 25, nRows: 300, varNames: ['id', ...seq('dep', 6, '_on'), ...seq('anx', 6, '_on'), ...seq('dep', 6, '_son'), ...seq('anx', 6, '_son')], categorical: [], missingCode: null });
  on.longitudinal.enabled = true; setWaveItems(on, 0, seq('dep', 6, '_on')); setWaveItems(on, 1, seq('dep', 6, '_son')); setFactorCount(on, 1);
  ok('validateSpec: the correct on/son selection raises no pairing warning', !/does not pair/.test(validateSpec(on).warnings.join(' | ')), validateSpec(on).warnings);
}
ok('trust1…trust6 with t2_ follow-ups → t2_trust* (not dep*); [dep1, trust1] → [t2_dep1, t2_trust1]', G(['id', ...seq('dep', 6), ...seq('trust', 6), ...seq('t2_dep', 6), ...seq('t2_trust', 6)], seq('trust', 6)) === seq('t2_trust', 6).join() && G(['id', ...seq('dep', 6), ...seq('trust', 6), ...seq('t2_dep', 6), ...seq('t2_trust', 6)], ['dep1', 'trust1']) === 't2_dep1,t2_trust1');
const glued = ['id', ...seq('predep', 6), ...seq('preanx', 6), ...seq('postdep', 6), ...seq('postanx', 6), 'age'];
ok('glued lowercase prefix words: [predep1, preanx1] → [postdep1, postanx1]; predep* → postdep*', G(glued, ['predep1', 'preanx1']) === 'postdep1,postanx1' && G(glued, seq('predep', 6)) === seq('postdep', 6).join(), [G(glued, ['predep1', 'preanx1']), G(glued, seq('predep', 6))]);
ok('glued lowercase prefix words with Time 2 stored first', G(['id', ...seq('postdep', 6), ...seq('postanx', 6), ...seq('predep', 6), ...seq('preanx', 6), 'age'], seq('predep', 6)) === seq('postdep', 6).join());
{
  // Time-1 follow-through (setTime1 = the wave picker AND the Items card in time mode)
  const f3 = createModelSpec({ fileName: 'f3.dat', delimiter: 'whitespace', hasHeader: true, nCols: 18, nRows: 300, varNames: ['id', ...seq('x', 6, '_t1'), ...seq('x', 6, '_t2'), ...seq('x', 5, '_t3')], categorical: [], missingCode: null });
  f3.longitudinal.enabled = true; setWaveItems(f3, 0, seq('x', 5, '_t1')); setWaveItems(f3, 1, seq('x', 5, '_t3')); setFactorCount(f3, 1);
  setTime1(f3, seq('x', 6, '_t1'));
  ok('setTime1: a wave-3 choice survives a new Time-1 column without a wave-3 counterpart (x6_t1 stays unpaired)', f3.longitudinal.waves[1].join() === seq('x', 5, '_t3').join() && f3.items.join() === seq('x', 6, '_t1').join(), f3.longitudinal.waves);
  ok('validateSpec then reports the indicator-count mismatch instead of silently re-pairing', /same number of indicators/.test(validateSpec(f3).errors.join(' | ')), validateSpec(f3).errors);
  setTime1(f3, seq('x', 5, '_t1'));
  ok('setTime1: removing the column restores a clean wave-3 pairing', f3.longitudinal.waves[1].join() === seq('x', 5, '_t3').join() && validateSpec(f3).errors.length === 0, [f3.longitudinal.waves, validateSpec(f3).errors]);
  const f4 = createModelSpec({ fileName: 'f4.dat', delimiter: 'whitespace', hasHeader: true, nCols: 10, nRows: 300, varNames: ['id', ...seq('x', 4, '_t1'), ...seq('x', 4, '_t2'), 'age'], categorical: [], missingCode: null });
  f4.longitudinal.enabled = true; setWaveItems(f4, 0, seq('x', 3, '_t1')); setWaveItems(f4, 1, seq('x', 3, '_t2')); setFactorCount(f4, 1);
  setTime1(f4, seq('x', 4, '_t1'));
  ok('setTime1 from the Items card keeps the waves in step (x4_t1 brings x4_t2; items = Time 1)', f4.longitudinal.waves[1].join() === seq('x', 4, '_t2').join() && f4.items.join() === seq('x', 4, '_t1').join() && validateSpec(f4).errors.length === 0, [f4.longitudinal.waves, validateSpec(f4).errors]);
  const chain = buildInp(f4, 'linv:cfa:configural');
  ok('…so the longitudinal syntax lists every indicator (no null)', !/null/.test(chain) && /x4_t2/.test(chain), chain.split('\n').filter((l) => /BY/.test(l)));
}
// generated sweep: scales × wave-token schemes (suffix, prefix, glued, words) × waves × layouts × covariates × id ×
// selections — the guess is never a WRONG non-null pairing
{
  const SCALES = [['dep', 'anx'], ['a', 'b'], ['x', 'y'], ['f1_', 'f2_'], ['dep', 'anx', 'str']];
  const SCHEMES = [
    { f: (sc, i, w) => `${sc}${i}_t${w}`, max: 4 }, { f: (sc, i, w) => `${sc}${i}${['_pre', '_post', '_fu'][w - 1]}`, max: 3 }, { f: (sc, i, w) => `${sc}${i}_${w}`, max: 4 },
    { f: (sc, i, w) => `${sc}${i}${w === 1 ? '' : `_${w}`}`, max: 4 }, { f: (sc, i, w) => `${sc}${i}${w === 1 ? '' : `_t${w}`}`, max: 4 }, { f: (sc, i, w) => `${sc}${i}_T${w}`, max: 4 },
    { f: (sc, i, w) => `${sc}${i}_w${w}`, max: 4 }, { f: (sc, i, w) => `${sc}${i}${['_ön', '_son'][w - 1]}`, max: 2 }, { f: (sc, i, w) => `${sc}${i}${['_on', '_son', '_izlem'][w - 1]}`, max: 3 },
    { f: (sc, i, w) => `T${w}_${sc}${i}`, max: 4 }, { f: (sc, i, w) => `t${w}${sc}${i}`, max: 4 }, { f: (sc, i, w) => `w${w}${sc}${i}`, max: 4 }, { f: (sc, i, w) => `${['pre', 'post', 'fu'][w - 1]}_${sc}${i}`, max: 3 },
    { f: (sc, i, w) => `${['pre', 'post', 'fu'][w - 1]}${sc}${i}`, max: 3 }, { f: (sc, i, w) => `${sc}${i}_${['pre', 'post', 'followup'][w - 1]}`, max: 3 }, { f: (sc, i, w) => `${sc}${i}_${['base', 'post', 'fu'][w - 1]}`, max: 3 },
    { f: (sc, i, w) => `${sc}${i}_${['bl', 'fu1', 'fu2'][w - 1]}`, max: 3 },
  ];
  const COV = [[], ['age', 'sex'], null]; // none, after, between
  let wrong = 0, nulls = 0, total = 0;
  const bad = [];
  const items = [1, 2, 3, 4, 5, 6];
  for (const scales of SCALES) for (const [si, { f: name, max }] of SCHEMES.entries()) for (const waves of [2, 3, 4]) {
    if (waves > max) continue;
    for (const layout of waves === 4 ? ['wave'] : ['wave', 'scale', 'item']) for (const cov of waves === 4 ? [[]] : COV) for (const withId of waves === 4 ? [true] : [true, false]) {
      let names = [];
      if (layout === 'wave') for (let w = 1; w <= waves; w++) for (const sc of scales) for (const i of items) names.push(name(sc, i, w));
      else if (layout === 'scale') for (const sc of scales) for (let w = 1; w <= waves; w++) for (const i of items) names.push(name(sc, i, w));
      else for (const sc of scales) for (const i of items) for (let w = 1; w <= waves; w++) names.push(name(sc, i, w));
      if (cov === null) names = [...names.slice(0, 6), 'age', 'sex', ...names.slice(6)]; else names = [...names, ...cov];
      if (withId) names = ['id', ...names];
      for (const w1 of waves === 2 ? [1] : [1, 2]) {
        const [s1, s2] = scales;
        const selections = [items.map((i) => name(s1, i, w1)), items.filter((i) => i !== 2).map((i) => name(s1, i, w1)), [name(s1, 1, w1), name(s2, 1, w1)], [name(s1, 3, w1), name(s2, 3, w1), name(s1, 5, w1)]];
        for (const t1 of selections) {
          const expected = t1.map((v) => { for (const sc of scales) for (const i of items) if (name(sc, i, w1) === v) return name(sc, i, w1 + 1); return '?'; });
          const got = pairWavesByName({ varNames: names }, t1);
          total++;
          if (got === null) nulls++;
          else if (got.join() !== expected.join()) { wrong++; if (bad.length < 8) bad.push({ scheme: si, scales: scales.join('/'), layout, waves, cov, t1: t1.join(), got: got.join() }); }
        }
      }
    }
  }
  ok(`generated sweep: ${total} files/selections, ${wrong} wrong non-null pairings (${nulls} left to the layout fallback)`, wrong === 0, bad);
}


console.log(`\ninvorder.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
