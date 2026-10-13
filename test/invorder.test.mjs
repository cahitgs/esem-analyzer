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

console.log(`\ninvorder.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
