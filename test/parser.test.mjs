// parser.test.mjs — validate out-parser against real Mplus fixtures. Run: node test/parser.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOut, summarizeFit } from '../js/out-parser.js';
import { invarianceDecision } from '../js/apa-render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const approx = (a, b, tol = 0.0005) => a != null && Math.abs(a - b) <= tol;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

// Fixtures are real Mplus outputs captured via the mplus MCP (see test/fixtures/).
const fx = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8');
const p = parseOut(fx('esem_geomin.out'));
console.log('\nESEM Geomin fixture →', summarizeFit(p));

check('nObs = 4500', p.nObs === 4500, p.nObs);
check('nFreeParams = 23', p.nFreeParams === 23, p.nFreeParams);
check('chi2 = 3.117', approx(p.fit.chi2, 3.117), p.fit.chi2);
check('df = 4', p.fit.df === 4, p.fit.df);
check('p = 0.5384', approx(p.fit.p, 0.5384), p.fit.p);
check('scalingFactor = 0.9896', approx(p.fit.scalingFactor, 0.9896), p.fit.scalingFactor);
check('CFI = 1.000', approx(p.fit.cfi, 1.0), p.fit.cfi);
check('TLI = 1.000', approx(p.fit.tli, 1.0), p.fit.tli);
check('RMSEA = 0.000', approx(p.fit.rmsea, 0.0), p.fit.rmsea);
check('RMSEA CI = [0.000, 0.020]', approx(p.fit.rmseaLo, 0.0) && approx(p.fit.rmseaHi, 0.02), [p.fit.rmseaLo, p.fit.rmseaHi]);
check('SRMR = 0.002', approx(p.fit.srmr, 0.002), p.fit.srmr);
check('logLik = -32781.176', approx(p.fit.logLik, -32781.176, 0.01), p.fit.logLik);
check('logLikScaling = 0.9981', approx(p.fit.logLikScaling, 0.9981), p.fit.logLikScaling);
check('AIC = 65608.352', approx(p.fit.aic, 65608.352, 0.01), p.fit.aic);
check('BIC = 65755.824', approx(p.fit.bic, 65755.824, 0.01), p.fit.bic);
check('aBIC = 65682.739', approx(p.fit.abic, 65682.739, 0.01), p.fit.abic);
check('estimator = MLR', p.estimator === 'MLR', p.estimator);
check('factors = [F1, F2]', JSON.stringify(p.factorOrder) === JSON.stringify(['F1', 'F2']), p.factorOrder);
check('items = X1..X6', JSON.stringify(p.items) === JSON.stringify(['X1','X2','X3','X4','X5','X6']), p.items);
check('STDYX F1 BY X1 = 0.820', approx(p.loadings.F1?.X1?.est, 0.820), p.loadings.F1?.X1?.est);
check('STDYX F1 BY X6 = -0.146', approx(p.loadings.F1?.X6?.est, -0.146), p.loadings.F1?.X6?.est);
check('STDYX F2 BY X4 = 0.838', approx(p.loadings.F2?.X4?.est, 0.838), p.loadings.F2?.X4?.est);
check('F2 WITH F1 = 0.540', approx(p.factorCorr[0]?.est, 0.540) && p.factorCorr[0]?.a === 'F2' && p.factorCorr[0]?.b === 'F1', p.factorCorr[0]);
check('residual X1 = 0.333', approx(p.residualVariances.X1, 0.333), p.residualVariances.X1);
check('R² X1 = 0.667', approx(p.rSquare.X1, 0.667), p.rSquare.X1);
check('δ X1 = 0.333 (= 1 − R²)', approx(p.uniqueness.X1, 0.333) && approx(p.uniqueness.X1, 1 - p.rSquare.X1), p.uniqueness.X1);
check('primary X1 = F1', p.primaryFactor.X1 === 'F1', p.primaryFactor.X1);
check('primary X4 = F2', p.primaryFactor.X4 === 'F2', p.primaryFactor.X4);
check('ω F1 ≈ 0.766', approx(p.omega.F1, 0.766, 0.003), p.omega.F1);
check('ω F2 ≈ 0.771', approx(p.omega.F2, 0.771, 0.003), p.omega.F2);
check('converged = true', p.converged === true, p.converged);

// ---- CFA fixture (no rotation) ----
const c = parseOut(fx('cfa_2f.out'));
console.log('\nCFA fixture →', summarizeFit(c));
check('CFA df = 8', c.fit.df === 8, c.fit.df);
check('CFA CFI = 0.967', approx(c.fit.cfi, 0.967), c.fit.cfi);
check('CFA RMSEA = 0.096', approx(c.fit.rmsea, 0.096), c.fit.rmsea);
check('CFA F2 WITH F1 = 0.728', approx(c.factorCorr[0]?.est, 0.728), c.factorCorr[0]?.est);
check('CFA loadings present', c.loadings.F1?.X1?.est != null && c.loadings.F2?.X4?.est != null, [c.loadings.F1?.X1?.est, c.loadings.F2?.X4?.est]);
check('CFA ω F1 ≈ 0.814', approx(c.omega.F1, 0.814, 0.003), c.omega.F1);

// ---- ESEM-Target fixture ----
const t = parseOut(fx('esem_target_2f.out'));
console.log('ESEM-Target fixture →', summarizeFit(t));
check('Target df = 4', t.fit.df === 4, t.fit.df);
check('Target CFI = 1.000', approx(t.fit.cfi, 1.0), t.fit.cfi);
check('Target F2 WITH F1 = 0.637 (< CFA 0.728)', approx(t.factorCorr[0]?.est, 0.637) && t.factorCorr[0].est < c.factorCorr[0].est, t.factorCorr[0]?.est);
check('Target F1 BY X1 = 0.932', approx(t.loadings.F1?.X1?.est, 0.932), t.loadings.F1?.X1?.est);

// ---- Bifactor-ESEM fixture (clean, orthogonal) ----
const be = parseOut(fx('bifactor_esem.out'));
console.log('\nBifactor-ESEM fixture → isBifactor =', be.isBifactor, '| G =', be.generalFactor);
check('BF-ESEM detected bifactor', be.isBifactor === true, be.isBifactor);
check('BF-ESEM general factor = G', be.generalFactor === 'G', be.generalFactor);
check('BF-ESEM G loads all 6 items', be.items.every((it) => be.loadings.G?.[it]?.est != null), be.items.map((it) => be.loadings.G?.[it]?.est));
check('BF-ESEM specific X1 = S1', be.specificFactor.X1 === 'S1', be.specificFactor.X1);
check('BF-ESEM specific X4 = S2', be.specificFactor.X4 === 'S2', be.specificFactor.X4);
check('BF-ESEM ω(G) computed', be.omega.G != null && be.omega.G > 0.5, be.omega.G);
check('BF-ESEM factors orthogonal (r=0)', be.factorCorr.every((c) => Math.abs(c.est) < 0.001), be.factorCorr.map((c) => c.est));

// ---- Bifactor-CFA fixture (under-identified on this data → no SEs; must degrade gracefully) ----
const bc = parseOut(fx('bifactor_cfa.out'));
console.log('Bifactor-CFA fixture → seComputed =', bc.seComputed, '| warnings =', bc.warnings.length);
check('BF-CFA still extracts G loadings (no-SE form)', bc.items.every((it) => bc.loadings.G?.[it]?.est != null), bc.loadings.G);
check('BF-CFA flags SE not computed', bc.seComputed === false && bc.warnings.some((w) => /Standard errors/.test(w)), bc.warnings);
check('BF-CFA is bifactor', bc.isBifactor === true, bc.isBifactor);

// ---- Multi-group invariance fixtures ----
const inv = {};
for (const s of ['configural', 'metric', 'scalar', 'strict', 'varcov', 'latentmean']) inv[s] = parseOut(fx(`inv_${s}.out`));
console.log('\nInvariance df:', ['configural','metric','scalar','strict','varcov','latentmean'].map((s) => inv[s].fit.df).join(' → '));
check('MG nGroups = 2', inv.configural.nGroups === 2, inv.configural.nGroups);
check('MG total N = 4500', inv.configural.nObs === 4500, inv.configural.nObs);
check('MG df monotonic 8<16<20<26<29<31', [8,16,20,26,29,31].every((d, i) => inv[['configural','metric','scalar','strict','varcov','latentmean'][i]].fit.df === d), ['configural','metric','scalar','strict','varcov','latentmean'].map((s)=>inv[s].fit.df));
check('Metric invariance supported', invarianceDecision(inv.configural.fit, inv.metric.fit).ok === true, invarianceDecision(inv.configural.fit, inv.metric.fit));
check('Scalar invariance NOT supported', invarianceDecision(inv.metric.fit, inv.scalar.fit).ok === false, invarianceDecision(inv.metric.fit, inv.scalar.fit));
check('Latent-mean invariance NOT supported', invarianceDecision(inv.varcov.fit, inv.latentmean.fit).ok === false, invarianceDecision(inv.varcov.fit, inv.latentmean.fit));

console.log('\n— rotation field + multi-group TITLE parsing —');
check('esem_geomin rotation = GEOMIN (not the "Rotation Algorithm" sub-heading)', p.rotation === 'GEOMIN', p.rotation);
check('esem_target_2f rotation = TARGET', t.rotation === 'TARGET', t.rotation);
check('bifactor_esem rotation = TARGET', be.rotation === 'TARGET', be.rotation);
check('cfa_2f / bifactor_cfa rotation = null', c.rotation === null && bc.rotation === null, [c.rotation, bc.rotation]);
const mcon = parseOut(fx('mg_cat_1_configural.out')), mmet = parseOut(fx('mg_cat_2_metric.out'));
check('MG title → invKind multigroup, invModel esem, invStep per step', mcon.invKind === 'multigroup' && mcon.invModel === 'esem' && mcon.invStep === 'Configural' && mmet.invStep === 'Metric (loadings)', [mcon.invKind, mcon.invStep, mmet.invStep]);
check('older "MG configural" titles stay untouched (no invStep)', inv.configural.invKind == null && inv.configural.invStep == null, [inv.configural.invKind, inv.configural.invStep]);
const bcat = parseOut(fx('mg_bcat_2_metric.out'));
check('MG bifactor (categorical) title → besem / Metric (loadings) / TARGET', bcat.invKind === 'multigroup' && bcat.invModel === 'besem' && bcat.invStep === 'Metric (loadings)' && bcat.rotation === 'TARGET', [bcat.invModel, bcat.invStep, bcat.rotation]);
const mcat = parseOut(fx('mg_cat_3_scalar.out'));
check('MG first-order (categorical) title → esem / Scalar (intercepts)', mcat.invModel === 'esem' && mcat.invStep === 'Scalar (intercepts)', [mcat.invModel, mcat.invStep]);

console.log('\n— CFA / bifactor-CFA chain titles —');
{
  const a = parseOut(fx('mg_cfa_metric.out')), b = parseOut(fx('mg_bcfa_scalar.out')), c = parseOut(fx('long_bcfa_metric.out')), d = parseOut(fx('mg_bcfa_cat_metric.out'));
  check('"MG invariance (CFA) - …" → multigroup / cfa, no rotation', a.invKind === 'multigroup' && a.invModel === 'cfa' && a.invStep === 'Metric (loadings)' && a.rotation === null, [a.invModel, a.invStep, a.rotation]);
  check('"MG invariance (bifactor-CFA) - …" → bcfa (never cfa or besem)', b.invModel === 'bcfa' && b.invStep === 'Scalar (intercepts)' && d.invModel === 'bcfa', [b.invModel, b.invStep, d.invModel]);
  check('"Longitudinal invariance (bifactor-CFA) - …" → longitudinal / bcfa', c.invKind === 'longitudinal' && c.invModel === 'bcfa' && c.invStep === 'Metric (loadings)', [c.invKind, c.invModel, c.invStep]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
