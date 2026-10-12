// docx.test.mjs — the Word-clipboard export must mirror the in-browser Morin-style (Hoyle Ch. 27,
// Table 2) loadings table: subscale blocks closed by thin-underlined ω rows (rule rows dropped in
// print), bold mains, italic non-significant loadings, heavy border on the last physical row,
// factor correlations only for oblique solutions. Run: node test/docx.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut } from '../js/out-parser.js';
import { buildWordHtml } from '../js/docx-export.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

const es = parseOut(fx('esem_target_data1.out'));
const bs = parseOut(fx('besem_target_data1.out'));
const esHtml = buildWordHtml([{ label: 'ESEM', parsed: es }]);
const bsHtml = buildWordHtml([{ label: 'Bifactor-ESEM', parsed: bs }]);
const THIN = 'border-bottom:0.75pt solid #000;', HEAVY = 'border-bottom:1.5pt solid #000;';
const omegaRows = (html) => [...html.matchAll(/<tr><td[^>]*>ω<\/td>.*?<\/tr>/g)].map((m) => m[0]);

console.log('\n— Morin blocks in the Word HTML —');
check('ESEM: 3 block ω rows', omegaRows(esHtml).length === 3, omegaRows(esHtml).length);
check('bifactor: 3 block ω rows', omegaRows(bsHtml).length === 3, omegaRows(bsHtml).length);
check('rule rows skipped (ω underline is the block separator)', !esHtml.includes('grp-rule') && !bsHtml.includes('grp-rule'), null);
check('ESEM: non-significant loading italic (X3 on F2 = .004)', /font-style:italic;">\.004<\/td>/.test(esHtml), null);
check('bifactor: bold target G loading (.116)', /font-weight:bold;">\.116<\/td>/.test(bsHtml), null);

console.log('\n— factor correlations —');
check('ESEM (oblique): includes "Factor correlations"', esHtml.includes('Factor correlations'), null);
check('bifactor (orthogonal): omits "Factor correlations"', !bsHtml.includes('Factor correlations'), null);

console.log('\n— ω placement —');
const bsOm = omegaRows(bsHtml);
check('bifactor: G ω .782 rides the LAST ω row together with F3 .456', bsOm[2]?.includes('.782') && bsOm[2]?.includes('.456'), bsOm[2]);
check('bifactor: G ω absent from earlier block ω rows', !bsOm[0]?.includes('.782') && !bsOm[1]?.includes('.782'), bsOm[0]);

console.log('\n— block borders —');
check('ESEM: all 3 ω rows thin-underlined', omegaRows(esHtml).every((r) => r.includes(THIN)), omegaRows(esHtml));
check('ESEM: heavy closing border on the last corr row (F3)', esHtml.includes(`text-align:left;${HEAVY}">F3</td>`), null);
check('bifactor: last ω row heavy, earlier ω rows thin', bsOm[2]?.includes(HEAVY) && !bsOm[2]?.includes(THIN) && bsOm[0]?.includes(THIN) && bsOm[1]?.includes(THIN), bsOm);

console.log('\n— notes —');
check('ESEM note flags italic non-significant loadings', esHtml.includes('non-significant loadings (p ≥ .05) in italics'), null);
check("bifactor note explains the general factor's ω placement", bsHtml.includes("the general factor's ω is shown on the last block"), null);

console.log('\n— longitudinal invariance path intact —');
const steps = ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean'];
const longHtml = buildWordHtml(steps.map((s) => ({ label: s, parsed: parseOut(fx(`long_besem_${s}.out`)) })));
check('six long_besem fixtures render the longitudinal invariance table', longHtml.includes('Tests of longitudinal measurement invariance'), null);

console.log(`\ndocx.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
