// examples.test.mjs — the two example data sets of the tutorial article (Morin, 2023, Ch27) and their model presets:
// loading a preset onto its data file must regenerate the inputs the article ran (test/fixtures/ch27/data1 and data2
// hold the article's 2 × 28 inputs). Five of those were re-run with the tutorial's convergence aids (Step 5: the
// residual-variance constraint for Z2; Part 2: CONVERGENCE = .005 from the strong step on); the preset generates the
// first-pass inputs, so those five must equal the article's files once the aid lines are removed, and nothing else.
// Run: node test/examples.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDataFile } from '../js/data-parse.js';
import { createModelSpec } from '../js/state.js';
import { applySavedSpec, specSignature } from '../js/spec-store.js';
import { buildInp, requestedModels } from '../js/syntax-generator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'example-dataset', 'ch27');
let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${typeof got === 'string' ? got.slice(0, 300) : JSON.stringify(got)})`); }
}
const norm = (t) => t.replace(/\r\n/g, '\n').trimEnd();
const AID_LINE = /^(Z2 \(res1\);|MODEL CONSTRAINT:|res1 > 0;|CONVERGENCE = \.005;)$/;
const stripAids = (t) => t.split('\n').filter((l) => !AID_LINE.test(l.trim())).join('\n');
const SETS = {
  data1: { file: 'Ch27-Data1.dat', preset: 'data1-model.json', rows: 10000, cols: 13, aided: ['BifactorESEM_3s.inp'],
    names: ['X1', 'X2', 'X3', 'X4', 'Y1', 'Y2', 'Y3', 'Y4', 'Z1', 'Z2', 'Z3', 'Z4', 'GROUP'] },
  data2: { file: 'Ch27-Data2.dat', preset: 'data2-model.json', rows: 10000, cols: 24, aided: ['LongInv_besem_3_scalar.inp', 'LongInv_besem_4_strict.inp', 'LongInv_besem_5_varcov.inp', 'LongInv_besem_6_latentmean.inp'],
    names: ['x1_t1', 'x2_t1', 'x3_t1', 'x4_t1', 'y1_t1', 'y2_t1', 'y3_t1', 'y4_t1', 'z1_t1', 'z2_t1', 'z3_t1', 'z4_t1', 'x1_t2', 'x2_t2', 'x3_t2', 'x4_t2', 'y1_t2', 'y2_t2', 'y3_t2', 'y4_t2', 'z1_t2', 'z2_t2', 'z3_t2', 'z4_t2'] },
};
for (const [id, S] of Object.entries(SETS)) {
  console.log(`\n— ${id}: ${S.file} + ${S.preset} —`);
  const text = readFileSync(join(EX, S.file), 'utf8');
  const data = parseDataFile(text, S.file);
  check(`${id}: ${S.rows} rows × ${S.cols} columns, no header, whitespace`, data.nRows === S.rows && data.nCols === S.cols && !data.hasHeader && data.delimiter === 'whitespace', [data.nRows, data.nCols, data.hasHeader, data.delimiter]);
  check(`${id}: the Mplus data file keeps its name`, data.mplusFile === S.file, data.mplusFile);
  data.varNames = S.names.slice(); data.categorical = [];
  const spec = createModelSpec(data); spec.signature = specSignature(data);
  const saved = JSON.parse(readFileSync(join(EX, S.preset), 'utf8'));
  check(`${id}: preset names the same columns`, JSON.stringify(saved.columns) === JSON.stringify(S.names), saved.columns);
  const r = applySavedSpec(spec, saved);
  check(`${id}: preset applies without dropping anything`, r.ok && r.dropped.length === 0, r);
  check(`${id}: 12 items, 3 factors, target rotation, four models`, spec.items.length === 12 && spec.factors.length === 3 && spec.rotation.type === 'TARGET' && spec.rotation.oblique && Object.values(spec.modelTypes).every(Boolean), [spec.items.length, spec.factors.length, spec.rotation, spec.modelTypes]);
  if (id === 'data1') check('data1: invariance across GROUP with labels G1/G2', spec.groups.enabled && spec.groups.variable === 'GROUP' && spec.groups.codes.map((c) => c.label).join() === 'G1,G2' && spec.groups.invariance.sequence.length === 6, spec.groups);
  else check('data2: two waves of 12 paired by name, correlated uniquenesses', spec.longitudinal.enabled && spec.longitudinal.waves[0].length === 12 && spec.longitudinal.waves[1][5] === 'y2_t2' && spec.longitudinal.correlatedUniqueness, spec.longitudinal);
  const models = requestedModels(spec);
  check(`${id}: 28 models requested`, models.length === 28, models.length);
  const fxDir = join(HERE, 'fixtures', 'ch27', id);
  const fixtures = readdirSync(fxDir).filter((f) => f.endsWith('.inp')).sort();
  check(`${id}: the 28 file names are those of the article`, JSON.stringify(models.map((m) => m.file).sort()) === JSON.stringify(fixtures), models.map((m) => m.file).sort());
  let identical = 0, aidedOk = 0; const diffs = [];
  for (const m of models) {
    const gen = norm(buildInp(spec, m.key));
    let ref = null;
    try { ref = norm(readFileSync(join(fxDir, m.file), 'utf8')); } catch { diffs.push(m.file + ': no fixture'); continue; }
    if (S.aided.includes(m.file)) { if (ref !== stripAids(ref) && gen === stripAids(ref)) aidedOk++; else diffs.push(m.file + ' (aided)'); }
    else if (gen === ref) identical++; else diffs.push(m.file);
  }
  check(`${id}: ${28 - S.aided.length} generated inputs are identical to the article's inputs`, identical === 28 - S.aided.length, diffs);
  check(`${id}: the ${S.aided.length} input(s) the article re-ran with convergence aids differ only by the aid lines`, aidedOk === S.aided.length && diffs.length === 0, diffs);
}
console.log(`\nexamples.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
