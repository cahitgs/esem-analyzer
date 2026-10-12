// ewc.test.mjs — ESEM-within-CFA: parse the SVALUES block, suggest referents, build the EWC .inp.
// Fixtures are REAL Mplus 8.3 outputs (ESEM.dat) run with OUTPUT: SVALUES.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSvalues, suggestReferents, buildEwcInp, fixedCrossCount } from '../js/ewc.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, g) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  XX  ' + n + (g !== undefined ? ' got ' + JSON.stringify(g) : ''))); };

// ---- oblique ESEM (2 factors, 6 items) ----
const esem = parseSvalues(fx('esem_svalues.out'));
ok('esem: SVALUES found', esem.found === true);
ok('esem: 2 factors', esem.factors.length === 2, esem.factors);
ok('esem: 6 items', esem.items.length === 6, esem.items.length);
ok('esem: not bifactor', esem.isBifactor === false, esem.isBifactor);
ok('esem: loading f1·x1 parsed', esem.loadings.f1?.x1 === '0.90151', esem.loadings.f1?.x1);
ok('esem: factor corr captured', esem.withs.length === 1 && esem.withs[0].raw === '0.43948', esem.withs);
ok('esem: intercept x4', esem.intercepts.x4 === '0.71039', esem.intercepts.x4);
ok('esem: uniqueness x1', esem.uniq.x1 === '0.39076', esem.uniq.x1);
ok('esem: header has DATA/VARIABLE', esem.header.some((l) => /^DATA/.test(l)) && esem.header.some((l) => /USEVARIABLES/i.test(l)), esem.header);
ok('esem: header drops ROTATION', !esem.header.some((l) => /ROTATION/i.test(l)));

const eRefs = suggestReferents(esem);
ok('esem: one referent per factor', Object.keys(eRefs).length === 2, eRefs);
ok('esem: referents distinct', eRefs.f1 !== eRefs.f2, eRefs);
ok('esem: m(m-1)=2 cross-loadings fixed', fixedCrossCount(esem, eRefs) === 2, fixedCrossCount(esem, eRefs));

const eInp = buildEwcInp(esem, { referents: eRefs });
ok('esem inp: no ROTATION', !/ROTATION/i.test(eInp));
ok('esem inp: factor variances fixed @1', /f1@1;/.test(eInp) && /f2@1;/.test(eInp));
ok('esem inp: referent cross-loading fixed (@)', new RegExp(`f2 BY ${eRefs.f1}@`).test(eInp) || new RegExp(`f1 BY ${eRefs.f2}@`).test(eInp), eInp);
ok('esem inp: free correlation kept (*)', /WITH f1\*0\.43948/.test(eInp));
ok('esem inp: all lines <= 90 chars', eInp.split('\n').every((l) => l.length <= 90), eInp.split('\n').reduce((m, l) => Math.max(m, l.length), 0));
// exactly m(m-1) '@' on BY lines (referent cross-loadings)
const atBy = (eInp.match(/ BY \S+@/g) || []).length;
ok('esem inp: exactly 2 fixed cross-loadings in BY lines', atBy === 2, atBy);

// ---- higher-order form (Morin: referent MAIN loading also fixed, variances *1 not @1) ----
const ho = buildEwcInp(esem, { referents: eRefs, variant: 'higherOrder' });
ok('ho: title says higher-order', /TITLE: ESEM-within-CFA \(higher-order form\);/.test(ho), ho.split('\n')[0]);
ok('ho: variances FREE (*1), not fixed', /f1\*1;/.test(ho) && /f2\*1;/.test(ho) && !/f1@1;/.test(ho) && !/f2@1;/.test(ho));
ok('ho: referent MAIN loadings fixed (@)',
  new RegExp(`f1 BY ${eRefs.f1}@`).test(ho) && new RegExp(`f2 BY ${eRefs.f2}@`).test(ho), { f1: eRefs.f1, f2: eRefs.f2 });
// m(m−1) cross + m main = m² fixed loadings on BY lines
const hoAt = (ho.match(/ BY \S+@/g) || []).length;
ok('ho: m² = 4 fixed loadings in BY lines', hoAt === 4, hoAt);
ok('ho: correlation still free (*)', /WITH f1\*0\.43948/.test(ho));
ok('ho: comment shows how to add HF', /HF BY f1\* f2;/.test(ho), null);
ok('ho: all lines <= 90 chars', ho.split('\n').every((l) => l.length <= 90), ho.split('\n').reduce((m, l) => Math.max(m, l.length), 0));
// basic stays the default — explicit 'basic' is byte-identical to no variant
ok('ho: variant "basic" === default', buildEwcInp(esem, { referents: eRefs, variant: 'basic' }) === eInp);
// non-referent main loadings must stay free in the higher-order form
const freeMains = esem.items.filter((it) => it !== eRefs.f1 && it !== eRefs.f2)
  .every((it) => new RegExp(`f1 BY ${it}\\*`).test(ho) && new RegExp(`f2 BY ${it}\\*`).test(ho));
ok('ho: non-referent loadings all free (*)', freeMains);

// ---- bifactor ESEM (G + 2 specifics, 12 items) ----
const bes = parseSvalues(fx('besem_svalues.out'));
ok('besem: SVALUES found', bes.found === true);
ok('besem: 3 factors', bes.factors.length === 3, bes.factors);
ok('besem: bifactor detected', bes.isBifactor === true, bes.isBifactor);
ok('besem: general factor = g', bes.generalFactor === 'g', bes.generalFactor);
ok('besem: orthogonal withs (~0)', bes.withs.every((w) => Math.abs(parseFloat(w.raw)) < 0.05), bes.withs);

const bRefs = suggestReferents(bes);
ok('besem: one referent per factor (incl G)', Object.keys(bRefs).length === 3, bRefs);
ok('besem: referents distinct', new Set(Object.values(bRefs)).size === 3, bRefs);
ok('besem: m(m-1)=6 cross-loadings fixed', fixedCrossCount(bes, bRefs) === 6, fixedCrossCount(bes, bRefs));

const bInp = buildEwcInp(bes, { referents: bRefs });
ok('besem inp: correlations fixed @0', (bInp.match(/WITH \S+@0;/g) || []).length === 3, (bInp.match(/WITH \S+@0;/g) || []).length);
ok('besem inp: all variances @1 (g,f1,f2)', /g@1;/.test(bInp) && /f1@1;/.test(bInp) && /f2@1;/.test(bInp));
ok('besem inp: 6 fixed cross-loadings in BY lines', (bInp.match(/ BY \S+@/g) || []).length === 6, (bInp.match(/ BY \S+@/g) || []).length);
ok('besem inp: all lines <= 90 chars', bInp.split('\n').every((l) => l.length <= 90), bInp.split('\n').reduce((m, l) => Math.max(m, l.length), 0));

// ---- SVALUES echo carrying a parameter label ("z2*0.20786 (res1);" — residual-positivity aid) ----
const lab = parseSvalues(fx('besem_target_data1.out'));
ok('labeled: SVALUES found', lab.found === true);
ok('labeled: z2 uniqueness parsed despite trailing "(res1)"', lab.uniq.z2 === '0.20786', lab.uniq.z2);
ok('labeled: every item keeps its uniqueness start value', lab.items.length === 12 && lab.items.every((it) => lab.uniq[it] != null), lab.items.filter((it) => lab.uniq[it] == null));
const labInp = buildEwcInp(lab, { referents: suggestReferents(lab), title: 'EWC' });
ok('labeled: EWC .inp emits the z2 start value', labInp.includes('z2*0.20786;'), null);

// ---- bifactor detection shares the Results-table rule: Morin's Data-1 bifactor-ESEM has G-λ down to .12 ----
const d1 = parseSvalues(fx('besem_target_data1.out'));
ok('data1 besem: detected as bifactor (g named, loads on every item)', d1.isBifactor === true && d1.generalFactor === 'g', [d1.isBifactor, d1.generalFactor]);
const d1Inp = buildEwcInp(d1);
ok('data1 besem inp: 6 correlations fixed @0, variances @1', (d1Inp.match(/WITH \S+@0;/g) || []).length === 6 && /g@1; f1@1; f2@1; f3@1;/.test(d1Inp), d1Inp.match(/WITH \S+@0;/g));
ok('data1 besem inp: m(m-1)=12 fixed cross-loadings', (d1Inp.match(/ BY \S+@/g) || []).length === 12, (d1Inp.match(/ BY \S+@/g) || []).length);
ok('hint: table verdict "G" (upper case) maps onto g', parseSvalues(fx('besem_target_data1.out'), { generalFactor: 'G' }).generalFactor === 'g');
ok('hint: null → not bifactor even for a true bifactor block', parseSvalues(fx('besem_svalues.out'), { generalFactor: null }).isBifactor === false);
ok('hint: unknown name falls back to the shared rule', parseSvalues(fx('besem_svalues.out'), { generalFactor: 'NOPE' }).generalFactor === 'g');
ok('EWC OUTPUT is the one default line', /OUTPUT:\nSAMPSTAT STANDARDIZED MODINDICES CINTERVAL RESIDUAL SVALUES TECH1 TECH3 TECH4;/.test(d1Inp));

// ---- non-SVALUES output yields found:false ----
const none = parseSvalues('SOME RANDOM TEXT WITHOUT A MODEL COMMAND BLOCK');
ok('no-svalues: found=false', none.found === false);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
