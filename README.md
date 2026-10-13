# ESEM Analyzer

A small, **browser-based** web app that removes the two most error-prone steps of an ESEM / bifactor-ESEM
workflow in **Mplus**:

1. **Writing the `.inp` syntax** — the `(*1)` ESEM blocks, `~0` target patterns, standardized-factor
   identification, and the measurement-invariance label bookkeeping.
2. **Turning the `.out` into journal tables** — fit indices, standardized loadings, ω, factor
   correlations, invariance comparisons, prose, and path diagrams.

It **never uploads your data** — syntax generation and output parsing happen in your browser. Online, you run
the generated `.inp` files in your own licensed Mplus and drop the resulting `.out` back in. Started locally with
`node serve.mjs` on a computer that has Mplus, the app **runs the models itself**: the topbar shows the Mplus
version it found, **Run all in Mplus** writes the files to `mplus-runs/<stamp>/`, and each `.out` flows into the
results as it finishes — nothing to download or upload. The online page can use that runner too: start
`ESEM-Analyzer.exe` (or `node serve.mjs`) and press **Connect** in the guide or on the Mplus pill; the page
links to it on localhost and remembers the choice. A first-visit **Guide** explains the four steps and both ways.

> **▶ Try it live (no install): https://cahitgs.github.io/esem-analyzer/**
> &nbsp;·&nbsp; **Guided demo (worked example): https://cahitgs.github.io/esem-analyzer/demo.html**

![Model builder — Λ target-pattern matrix, live syntax, conceptual diagram](docs/img/02-model-builder.png?v=9)

---

## What it does

| Step | You do | The app does |
|------|--------|--------------|
| **1 · Data** | Upload a `.dat` / `.csv` | Auto-detect columns, delimiter, header; export an Mplus-ready `.dat` |
| **2 · Model** | Sketch the factor model on a Λ grid | Pick factors, rotation (Geomin / Target), estimator, bifactor, grouping |
| **3 · Syntax** | — | Generate exact `.inp` for each model; download one file, a `.zip`, or write them straight into a working folder (auto mode) |
| **4 · Results** | Drop your Mplus `.out` files — or let auto mode import them | APA fit / loadings / bifactor / invariance tables + prose + path diagrams; copy to Word, `.docx` |

### Models supported

- **CFA** (independent-clusters, standardized-factor identification `F1 BY x1* …; F1@1;`)
- **ESEM** — Geomin (oblique/orthogonal, ε) and Target rotation
- **Bifactor-CFA** and **Bifactor-ESEM** (BI-GEOMIN orthogonal / orthogonal Target)
- **Measurement invariance** — across **groups** (multi-group, for first-order ESEM and **bifactor-ESEM**) or across **time** (within-person, 2-wave longitudinal, for CFA, ESEM, and **bifactor-ESEM**): configural → metric → scalar → strict → variance–covariance → latent means (Satorra–Bentler scaled Δχ² for MLR; Chen 2007 ΔCFI/ΔTLI/ΔRMSEA verdicts). Longitudinal models equate loadings across waves and correlate each indicator's residual over time; the bifactor sequences follow Morin's Hoyle-Handbook chapter (orthogonal target rotation, general + specific factors).
- **Categorical (ordinal) invariance** — flag every item categorical and the multi-group sequence switches to the thresholds-based **WLSMV + THETA** chain (Millsap identification: first thresholds + one referent's second threshold equated from configural on) and wires the **`DIFFTEST`** handshake between steps automatically; the Results table then reports Mplus's difference-test Δχ² instead of a (invalid) Satorra–Bentler value. The **bifactor-ESEM** sequence gets the same thresholds chain — with one extra referent threshold for the G factor (Morin's T15/T42 rule) and its own `BifactorInv_diff_*.dat` files. Longitudinal sequences are continuous-only; categorical wave columns are refused with an explanation.
- **ESEM-within-CFA** — convert a rotated ESEM solution into an equivalent CFA you can embed in larger SEM/MIMIC/DIF models (Morin's referent method)
- **Convergence aids** (optional, on the Syntax step) — the two remedies Morin uses in the Hoyle-Handbook chapter: a loosened `CONVERGENCE` criterion (emitted for every model, invariance sequences included) and per-item residual-variance positivity constraints (`item (res#); … MODEL CONSTRAINT: res# > 0;`, single-group measurement models only) for Heywood cases. With a missing-value code and an ML-family estimator the loosened criterion also brings a matching `H1CONVERGENCE` line, plus `H1ITERATIONS` wherever an `ITERATIONS` line is set (Morin's T32 note). Every model requests Morin's recommended `OUTPUT: SAMPSTAT STANDARDIZED MODINDICES CINTERVAL RESIDUAL SVALUES TECH1 TECH3 TECH4;`
- **Run in Mplus from the app** (local `node serve.mjs` + Mplus installed) — one button runs every generated model on your computer, one after another (invariance sequences keep their `DIFFTEST` order), with live status, a stop button and the Mplus log; outputs import themselves. ESEM-within-CFA models generated from a local run can be run from their card too.
- **Auto mode** (fallback when the local server is not running; Chrome/Edge desktop) — pick a local working folder and the app writes every `.inp`, the Mplus-ready `.dat`, and a `RUN-ALL.bat` there; double-click that file once and the results import themselves as each model finishes. Nothing is uploaded — the folder, the bat, and Mplus are all on your machine.

Standardized-loadings tables follow Morin's Table-2 layout — items grouped into subscale blocks with a per-block ω row, target loadings bold, non-significant loadings italic — identically in the browser, the copy-to-Word HTML, and the `.docx` export.

### Path diagrams

Factors, items, correlations, uniquenesses, and a
proper bifactor layout (specific factors one side, the global factor reaching every item the other side).
Diagrams are interactive — toggle cross-loadings / uniquenesses, show/hide factors, **drag the ellipses**
to reposition for reporting, and export SVG / PNG.

---

## ESEM-within-CFA

After you run an ESEM with `OUTPUT: SVALUES;` (the app adds this automatically), drop the `.out` back in
and the **Results** step offers a one-click conversion to ESEM-within-CFA: it reads the rotated solution's
unstandardized estimates, picks a referent indicator per factor, fixes that referent's cross-loadings to
their ESEM values (and, for bifactor, all factor correlations to 0), and writes a runnable `.inp`.

Two identification forms are offered: **standard** (factor variances `@1` — for MIMIC/DIF or factors
predicting outcomes) and **higher-order** (the referent's main loading also fixed, variances `*1` — for
factors that become endogenous, e.g. under a higher-order factor).

![ESEM-within-CFA card](docs/img/05-esem-within-cfa.png?v=9)

**Verified against real Mplus 8.3:** the generated oblique ESEM-within-CFA reproduces the source ESEM
*exactly* — identical number of free parameters, degrees of freedom, χ², and log-likelihood
(e.g. the bundled 3-factor ESEM: npar 72, df 63, LL −11107.13 in both). See [`GUIDE.md`](GUIDE.md).

---

## Quick start

The app itself is a static site, but `serve.mjs` is also the local Mplus runner, so start it with Node:

```bash
node serve.mjs            # → http://localhost:3001 — also detects Mplus and runs models from the app
node serve.mjs --open     # same, and opens the browser
PORT=3400 node serve.mjs  # another port;  MPLUS_PATH=... if Mplus.exe is not under Program Files

# any static server works too (no local runs; download / drop .out instead)
python -m http.server 8000
```

Then open the URL and follow **Data → Model → Syntax → Results**. A ready-made example with real Mplus
outputs lives in [`example-dataset/`](example-dataset/) — open the app, choose **"Skip to reading .out
files →"**, and drop `example-dataset/2_ESEM_geomin.out`.

No build step, no dependencies to install (the local runner is a zero-dependency Node script). Tailwind, `docx`,
and `JSZip` load from CDNs; the four engines (syntax generator, `.out` parser, APA render, ESEM-within-CFA) are plain
ES modules.

---

## Desktop runner (one .exe, no Node install)

For colleagues who have Mplus but not Node: `node tools/build-exe.mjs` packages the app and the runner into a single
Windows executable, `dist/ESEM-Analyzer.exe` (~105 MB; Node is inside). Double-click it: a console window opens,
the browser opens on `http://localhost:3001` (or the next free port), the topbar shows the Mplus it found, and
**Run all in Mplus** works with nothing else installed. Runs are written to `mplus-runs/` next to the exe; closing
the window stops it. The exe is unsigned, so SmartScreen asks once ("More info → Run anyway"). Build on a machine
with Node 20.12+; the first build fetches `postject` via npx. The runner also answers the online page on
localhost (CORS for the GitHub Pages origin; `ALLOW_ORIGINS` adds others), so the published UI can drive it.

## Tested against real Mplus

The engines are unit-tested against **real Mplus `.out` fixtures**, and the generated syntax has been run
back through Mplus 8.3 to confirm it reproduces the intended models (matching degrees of freedom and fit).

```bash
node test/parser.test.mjs       # .out parser             (65)
node test/dataparse.test.mjs    # data-file detection     (9)
node test/ewc.test.mjs          # ESEM-within-CFA         (52)
node test/longitudinal.test.mjs # longitudinal invariance (69)
node test/apa.test.mjs          # Morin-style APA tables   (16)
node test/docx.test.mjs         # Word/.docx export        (15)
node test/aids.test.mjs         # convergence aids         (36)
node test/runscripts.test.mjs   # auto-mode run scripts    (18)
node test/mginv.test.mjs        # MG bifactor-ESEM invariance (26)
node test/catinv.test.mjs       # categorical WLSMV invariance + DIFFTEST, ESEM + bifactor-ESEM chains (97)
node test/invorder.test.mjs     # invariance step order, unestimated outputs (MG + longitudinal), total-sample models, ID columns, Time-2 pairing incl. an 18 000-file name sweep (138)
```

The two multi-group invariance engines were additionally **cross-validated against De Beer & Morin's
(B)ESEM syntax generator** ([statstools.app/b_esem](https://statstools.app/b_esem/)): on the same data,
both tools' models produce identical free-parameter counts, degrees of freedom, χ², and — for the
categorical chain — identical `DIFFTEST` Δχ² values at every step in real Mplus 8.3 runs. The categorical
bifactor-ESEM chain, added later, was verified in real Mplus 8.3 runs: every step converges, and the
free-parameter counts, df and `DIFFTEST` df match the intended constraints (`test/catinv.test.mjs`).

---

## Project layout

```
index.html              shell (topbar, control column, desk + manuscript, Mplus sheet)
css/app.css             design system ("living manuscript")
serve.mjs               local server + Mplus runner (health, runs, SSE job events)
tools/build-exe.mjs     packages app + runner into dist/ESEM-Analyzer.exe (Node SEA)
js/
  shell.js              UI helpers, Mplus sheet, the paper, tooltips
  runner.js             browser side of the local Mplus runner (same origin or localhost connect)
  guide.js              first-visit guide: the four steps and the two ways to run Mplus
  state.js              ModelSpec + validation
  data-parse.js         .dat/.csv reader + Mplus-ready .dat export
  model-builder.js      Λ target-pattern grid + controls
  syntax-generator.js   buildInp(spec, modelType) — exact Mplus templates
  out-parser.js         parseOut(text) → ParsedModel
  ewc.js                ESEM-within-CFA (parse SVALUES, build EWC .inp)
  apa-render.js         APA tables + prose + Satorra–Bentler Δχ²
  diagram.js            SVG path diagrams (interactive)
  docx-export.js        copy-to-Word, .docx, .zip
test/                   node test runners + real .out fixtures
example-dataset/        synthetic 3-factor data + ready .inp/.out
docs/img/               screenshots used in the docs
```

See the full walkthrough in **[`GUIDE.md`](GUIDE.md)**.

---

## Notes & disclaimer

- This is an independent helper. It is **not affiliated with or endorsed by** Muthén & Muthén (Mplus).
  You need your own licensed copy of Mplus to run the syntax.
- Your data and output files never leave the browser; the app makes no network requests with them.
- The public site uses [GoatCounter](https://www.goatcounter.com) for anonymous, cookie-free visit
  counts (page, referrer, country) — it never sees your data or output files.
- The reference article and its supplement are © their publisher and are **not** redistributed here.

## License

[MIT](LICENSE) © 2026 Mehmet Cahit Marangoz
