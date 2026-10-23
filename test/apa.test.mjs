// apa.test.mjs — Morin-style (Hoyle Ch. 27, Table 2) loadings tables: a-priori subscale blocks
// recovered from the echoed input, per-block ω rows, bold mains, italic non-significant loadings.
// Fixtures are real Mplus 8.3 runs of the app's syntax on Morin's Ch27 Data 1 (target rotation;
// the bifactor run carries Morin's documented "res1 > 0" remedy) — every ω below equals the
// value Morin PUBLISHED in his chapter Table 2. Run: node test/apa.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut } from '../js/out-parser.js';
import { renderLoadingsTable, renderFitTable, fitFamily, fitComparisons } from '../js/apa-render.js';
import { buildWordHtml } from '../js/docx-export.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
let pass = 0, fail = 0;
const approx = (a, b, tol = 0.0015) => a != null && Math.abs(a - b) <= tol;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

console.log('\n— a-priori target pattern from the echoed input —');
const es = parseOut(fx('esem_target_data1.out'));
const bs = parseOut(fx('besem_target_data1.out'));
check('ESEM target: pattern recovered (3 factors × 4 mains)', es.targetPattern && ['F1', 'F2', 'F3'].every((f) => es.targetPattern[f]?.size === 4), es.targetPattern && Object.keys(es.targetPattern));
check('bifactor: pattern has G(12) + F1-F3(4)', bs.targetPattern?.G?.size === 12 && bs.targetPattern?.F1?.size === 4, null);
const eg = parseOut(fx('../../example-dataset/2_ESEM_geomin.out'));
check('geomin range statement: pattern uninformative → null', eg.targetPattern === null, eg.targetPattern && Object.keys(eg.targetPattern));

console.log('\n— general-factor detection with small G loadings —');
check('bifactor generalFactor = G (min G-λ = .116 < .2)', bs.generalFactor === 'G', bs.generalFactor);
check('Z1 assigned to its A-PRIORI subscale F3 (dominant specific is a cross-loading)', bs.specificFactor.Z1 === 'F3', bs.specificFactor.Z1);

console.log('\n— ω per subscale block = Morin chapter Table 2 (published values) —');
check('ESEM ω .790/.839/.743', approx(es.omega.F1, 0.790) && approx(es.omega.F2, 0.839) && approx(es.omega.F3, 0.743), [es.omega.F1, es.omega.F2, es.omega.F3]);
check('bifactor ω G=.782, S=.772/.823/.456', approx(bs.omega.G, 0.782) && approx(bs.omega.F1, 0.772) && approx(bs.omega.F2, 0.823) && approx(bs.omega.F3, 0.456), [bs.omega.G, bs.omega.F1, bs.omega.F2, bs.omega.F3]);

console.log('\n— loadings = Morin chapter Table 2 (spot cells) —');
check('ESEM X1 row .490/.221/-.106/δ.679', approx(es.loadings.F1.X1.est, 0.490) && approx(es.loadings.F2.X1.est, 0.221) && approx(es.loadings.F3.X1.est, -0.106) && approx(es.uniqueness.X1, 0.679), null);
check('bifactor Z2 row G.405/S3.820/δ.162', approx(bs.loadings.G.Z2.est, 0.405) && approx(bs.loadings.F3.Z2.est, 0.820) && approx(bs.uniqueness.Z2, 0.162), [bs.loadings.G?.Z2?.est, bs.loadings.F3?.Z2?.est, bs.uniqueness.Z2]);

console.log('\n— Morin-style table rendering —');
const esHtml = renderLoadingsTable(es, {});
const bsHtml = renderLoadingsTable(bs, {});
check('ESEM table: 3 block ω rows', (esHtml.match(/<td>ω<\/td>/g) || []).length === 3, (esHtml.match(/<td>ω<\/td>/g) || []).length);
check('ESEM table: non-significant loading in italics (X3 on F2 = .004)', /<i>\.004<\/i>/.test(esHtml), null);
check('ESEM table: oblique → factor correlations shown', esHtml.includes('Factor correlations'), null);
check('bifactor table: orthogonal → factor correlations omitted', !bsHtml.includes('Factor correlations'), null);
check('bifactor table: G ω rides the last block row', /<tr><td>ω<\/td><td>\.782<\/td><td><\/td><td><\/td><td>\.456<\/td><td><\/td><\/tr>/.test(bsHtml), null);
check('bifactor table: G loadings bold (target class)', /class="target">\.116/.test(bsHtml), null);
check('block rules between subscales', (bsHtml.match(/grp-rule/g) || []).length >= 2, null);

console.log('\n— the four-model fit table: Morin’s reference comparisons —');
{
  const four = [
    { label: 'CFA', parsed: parseOut(fx('cfa_data1.out')) },
    { label: 'ESEM (Target)', parsed: parseOut(fx('esem_target_data1.out')) },
    { label: 'Bifactor-CFA', parsed: parseOut(fx('bcfa_data1.out')) },
    { label: 'Bifactor-ESEM', parsed: parseOut(fx('besem_target_data1.out')) },
  ];
  const fam = four.map((m) => fitFamily(m.parsed));
  check('families read from the outputs (rotation → ESEM, general factor → bifactor)', fam.join() === 'cfa,esem,bcfa,besem', fam);
  const cmp = fitComparisons(four);
  check('reference mode: ESEM and bifactor-CFA vs CFA, bifactor-ESEM vs ESEM; Δχ² only for the nested pair', cmp.mode === 'reference' && JSON.stringify(cmp.rows) === JSON.stringify([{ ref: null, nested: false }, { ref: 0, nested: true }, { ref: 0, nested: false }, { ref: 1, nested: false }]), cmp);
  const html = renderFitTable(four);
  check('fixtures reproduce Morin (2023) Table 1: χ²(df) = 4212.95 (51), 50.52 (33), 2709.33 (42), 23.23 (24)',
    /<td>4212\.95<\/td><td>51<\/td>/.test(html) && /<td>50\.52<\/td><td>33<\/td>/.test(html) && /<td>2709\.33<\/td><td>42<\/td>/.test(html) && /<td>23\.23<\/td><td>24<\/td>/.test(html), html.match(/<td>[\d.]+<\/td><td>\d+<\/td>/g));
  const rows = html.split('<tr>').slice(2);
  check('ESEM row: vs. CFA with a Satorra–Bentler Δχ²(s) on 18 df', /<td>CFA<\/td><td>[\d.]+\*<\/td><td>18<\/td>/.test(rows[1]), rows[1]);
  check('bifactor-CFA row: vs. CFA, no Δχ² (not nested) but ΔCFI/ΔTLI/ΔRMSEA', /<td>CFA<\/td><td>—<\/td><td>—<\/td><td>[+−]\.\d{3}<\/td><td>[+−]\.\d{3}<\/td><td>[+−]\.\d{3}<\/td>/.test(rows[2]), rows[2]);
  check('bifactor-ESEM row: vs. ESEM (Target), no Δχ²', /<td>ESEM \(Target\)<\/td><td>—<\/td><td>—<\/td>/.test(rows[3]), rows[3]);
  check('note explains the reference comparisons and the nested pairs', /reference model/.test(html) && /nested pairs/.test(html));
  const two = renderFitTable([four[0], { label: 'CFA 2-factor', parsed: four[0].parsed }]);
  check('two models of one family keep the row-by-row Δ (no vs. column)', !/<th>vs\.<\/th>/.test(two) && /<th>Δχ²\(s\)<\/th>/.test(two) && /<td>CFA 2-factor<\/td><td>[\d.]+<\/td>/.test(two), two.slice(-400));
  const w = buildWordHtml(four);
  check('Word export shows the same vs. column and note', /<th[^>]*>vs\.<\/th>/.test(w) && /reference model/.test(w), w.slice(0, 200));
}

console.log(`\napa.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
