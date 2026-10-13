// invorder.test.mjs — invariance rows keep the sequence order whatever the arrival order, outputs without
// fit statistics are marked "Not estimated" and skipped by the comparisons (not sorted to the top), the
// checked measurement models are generated on the total sample when grouping is on, and ID-like columns
// are kept out of the items. Fixtures mg_notestimated_scalar.out / mg_besem_nochisq_configural.out are real
// Mplus 8.3 runs in which an ID column had been selected as an item. Run: node test/invorder.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut } from '../js/out-parser.js';
import { sortInvarianceModels, invarianceSeries, renderInvarianceTable, renderInvarianceProse, noFitReason } from '../js/apa-render.js';
import { buildWordHtml } from '../js/docx-export.js';
import { buildInp, requestedModels } from '../js/syntax-generator.js';
import { createModelSpec, setItems, setFactorCount, validateSpec, looksLikeId } from '../js/state.js';

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

console.log(`\ninvorder.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
