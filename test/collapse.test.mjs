// collapse.test.mjs — sparse response categories (empty in one group or at one wave) and their merges:
// detection, the DEFINE lines, threshold counts after merging, validation, save/restore. Run: node test/collapse.test.mjs
import { createModelSpec, setItems, setFactorCount, setWaveItems, validateSpec, thresholdCounts, sparseCategories, setMerge, clearMerge, categoryCounts, applyRecode } from '../js/state.js';
import { buildInp, INV_SEQUENCE } from '../js/syntax-generator.js';
import { serializeSpec, applySavedSpec } from '../js/spec-store.js';
import { parseOut } from '../js/out-parser.js';
import { noFitReason } from '../js/apa-render.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };

// 12 Likert items (1–5), two groups; in group 2 nobody picked 5 on m3, and nobody picked 1 on m7 in group 1
const items = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
const rows = Array.from({ length: 400 }, (_, r) => {
  const g = r < 200 ? 1 : 2;
  const vals = items.map((_, i) => 1 + ((r * 3 + i * 7) % 5));
  if (g === 2 && vals[2] === 5) vals[2] = 4;
  if (g === 1 && vals[6] === 1) vals[6] = 2;
  return [r + 1, ...vals, g].map(String);
});
const mk = () => {
  const s = createModelSpec({ fileName: 'sp.dat', delimiter: 'whitespace', hasHeader: false, nCols: 14, nRows: 400, varNames: ['id', ...items, 'g'], categorical: items.slice(), missingCode: null, _matrix: rows });
  setItems(s, items); setFactorCount(s, 3);
  const ids = s.factors.map((f) => f.id);
  for (const it of items) s.target[it] = {};
  items.forEach((it, i) => { s.target[it][ids[Math.floor(i / 4)]] = true; });
  s.estimator = 'WLSMV';
  s.groups = { enabled: true, variable: 'g', codes: [{ code: 1, label: 'men' }, { code: 2, label: 'women' }], invariance: { sequence: [...INV_SEQUENCE] } };
  return s;
};

console.log('— detection across groups —');
{
  const s = mk();
  const sp = sparseCategories(s);
  ok('two sparse categories found: m3 = 5 (empty in women) and m7 = 1 (empty in men)', sp.length === 2 && sp.some((x) => x.item === 'm3' && x.level === 5 && x.to === 4) && sp.some((x) => x.item === 'm7' && x.level === 1 && x.to === 2), sp);
  const m3 = sp.find((x) => x.item === 'm3');
  ok('counts per group reported, columns = the item itself', m3.counts.map((c) => `${c.label}:${c.n}`).join() === 'men:40,women:0' && m3.columns.join() === 'm3', m3);
  ok('validateSpec: sparse categories are an error that names the items', /2 response categories are empty .*m3 = 5, m7 = 1/.test(validateSpec(s).errors.join(' | ')), validateSpec(s).errors);
  ok('threshold counts before merging: 4 thresholds everywhere', thresholdCounts(s).m3 === 4 && thresholdCounts(s).m7 === 4);
  setMerge(s, 'm3', 5, 4); setMerge(s, 'm7', 1, 2);
  ok('after merging: no sparse categories, no error, 3 thresholds for the merged items', sparseCategories(s).length === 0 && !validateSpec(s).errors.some((e) => /response categor/.test(e)) && thresholdCounts(s).m3 === 3 && thresholdCounts(s).m7 === 3 && thresholdCounts(s).m1 === 4, [sparseCategories(s), thresholdCounts(s)]);
  ok('categoryCounts applies the merge (no level 5 left on m3)', !categoryCounts(s, 'm3').has(5) && categoryCounts(s, 'm3').get(4) > 0);
  ok('applyRecode follows chains and leaves other values', applyRecode({ 5: 4, 4: 3 }, 5) === 3 && applyRecode({ 5: 4 }, 2) === 2 && applyRecode(null, 7) === 7);
  const inp = buildInp(s, 'cinv:configural');
  const defIdx = inp.indexOf('DEFINE:'), anaIdx = inp.indexOf('ANALYSIS:'), varIdx = inp.indexOf('VARIABLE:');
  ok('DEFINE block sits between VARIABLE and ANALYSIS with one IF/THEN line per merge', defIdx > varIdx && defIdx < anaIdx && /DEFINE:\nIF \(m3 EQ 5\) THEN m3 = 4;\nIF \(m7 EQ 1\) THEN m7 = 2;\nANALYSIS:/.test(inp), inp.slice(varIdx, anaIdx + 10));
  ok('thresholds in the chain follow the merged counts (m3 has $1–$3, no $4)', /\[m3\$3\]/.test(inp) && !/\[m3\$4\]/.test(inp) && /\[m1\$4\]/.test(inp), inp);
  ok('the single-group models carry the DEFINE too', /DEFINE:\nIF \(m3 EQ 5\) THEN m3 = 4;/.test(buildInp(s, 'cfa')) && /DEFINE:/.test(buildInp(s, 'esem')));
  setItems(s, items.filter((it) => it !== 'm7'));
  ok('a merge of a column the model does not use is not written', /IF \(m3 EQ 5\)/.test(buildInp(s, 'cfa')) && !/m7 EQ 1/.test(buildInp(s, 'cfa')));
  clearMerge(s, 'm3', 5);
  ok('clearMerge removes the merge and the DEFINE line', !s.recode.m3 && !/DEFINE/.test(buildInp(s, 'cfa')) && sparseCategories(s).length === 1);
}

console.log('\n— detection across waves —');
{
  const t1 = items.slice(0, 6).map((x) => `${x}_t1`), t2 = items.slice(0, 6).map((x) => `${x}_t2`);
  const wrows = Array.from({ length: 300 }, (_, r) => {
    const a = t1.map((_, i) => 1 + ((r * 3 + i * 7) % 5)), b = t2.map((_, i) => 1 + ((r * 7 + i * 3) % 5));
    if (b[1] === 1) b[1] = 2; // m2 at Time 2 never shows category 1
    return [r + 1, ...a, ...b].map(String);
  });
  const s = createModelSpec({ fileName: 'w.dat', delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 300, varNames: ['id', ...t1, ...t2], categorical: [...t1, ...t2], missingCode: null, _matrix: wrows });
  s.longitudinal.enabled = true; setWaveItems(s, 0, t1); setWaveItems(s, 1, t2); setFactorCount(s, 2);
  const ids = s.factors.map((f) => f.id); for (const it of t1) s.target[it] = {}; t1.forEach((it, i) => { s.target[it][ids[Math.floor(i / 3)]] = true; });
  s.estimator = 'WLSMV';
  const sp = sparseCategories(s);
  ok('one sparse category across waves: m2 = 1 present at Time 1, empty at Time 2; the merge targets both columns', sp.length === 1 && sp[0].item === 'm2_t1' && sp[0].level === 1 && sp[0].to === 2 && sp[0].columns.join() === 'm2_t1,m2_t2' && sp[0].counts.map((c) => c.label).join() === 'Time 1,Time 2', sp);
  ok('validateSpec: the sparse category is an error and so is the unequal category count', /response categor/.test(validateSpec(s).errors.join(' | ')) && /m2_t1 has 5 categories but m2_t2 has 4/.test(validateSpec(s).errors.join(' | ')), validateSpec(s).errors);
  for (const col of sp[0].columns) setMerge(s, col, 1, 2);
  ok('after merging both columns: no sparse categories, equal counts, chain valid', sparseCategories(s).length === 0 && validateSpec(s).errors.length === 0 && thresholdCounts(s, t1).m2_t1 === 3 && thresholdCounts(s, t2).m2_t2 === 3, validateSpec(s).errors);
  const inp = buildInp(s, 'linv:esem:configural');
  ok('longitudinal input: DEFINE for both wave columns, thresholds th2_1…th2_3 only', /DEFINE:\nIF \(m2_t1 EQ 1\) THEN m2_t1 = 2;\nIF \(m2_t2 EQ 1\) THEN m2_t2 = 2;/.test(inp) && /\[m2_t2\$3\] \(th2_3\)|\[m2_t2\$3\];/.test(inp) && !/\[m2_t2\$4\]/.test(inp), inp);
  const saved = JSON.parse(JSON.stringify(serializeSpec(s)));
  const fresh = createModelSpec({ fileName: 'w.dat', delimiter: 'whitespace', hasHeader: false, nCols: 13, nRows: 300, varNames: ['id', ...t1, ...t2], categorical: [...t1, ...t2], missingCode: null, _matrix: wrows });
  applySavedSpec(fresh, saved);
  ok('merges survive the .json round trip', JSON.stringify(fresh.recode) === JSON.stringify(s.recode), fresh.recode);
}

console.log('\n— the Mplus error itself (real run without the merge) —');
{
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mg_emptycat_configural.out'), 'utf8');
  const p = parseOut(text);
  ok('parser: "Group 2 does not contain all values of categorical variable: M3" → emptyCategory + warning', p.emptyCategory?.variable === 'M3' && p.emptyCategory.group === 2 && p.warnings.some((w) => /merge that category/.test(w)), [p.emptyCategory, p.warnings]);
  ok('noFitReason names the empty category and points to the Model step', /response category of M3 is empty in group 2/.test(noFitReason(p)), noFitReason(p));
}

console.log(`\ncollapse.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
