# A walkthrough — *ESEM Analyzer*

This guide goes through the whole workflow with the bundled [`example-dataset/`](example-dataset/): build
the syntax, run it in your own Mplus, and turn the output into APA tables, prose, and diagrams — including
**ESEM-within-CFA**. Every syntax pattern below has been run back through Mplus 8.3 to confirm it reproduces
the intended model.

**Try it live:** <https://cahitgs.github.io/esem-analyzer/> · or `node serve.mjs` locally.

The app keeps everything in the browser: it generates Mplus input and reads Mplus output, but it never runs
Mplus and never uploads your data.

---

## 1 · Data

Upload a `.dat` or `.csv`. The app auto-detects the column count, the delimiter (space / comma / semicolon /
tab), and whether the first row is a header, and it can export an **Mplus-ready `.dat`** (space-delimited, no
header, dot decimals) — handy when your file is a semicolon CSV or uses comma decimals, which Mplus cannot
read directly.

**Example data.** The second card of the Data page holds the two simulated data sets of Morin’s (2023) chapter (two groups; two occasions) with the model of the tutorial article: one click loads the file, the names and the sketch, and the `.dat` and model `.json` files can be downloaded. `?example=data1` / `?example=data2` open the app with them.


For this walkthrough you can skip data entry: open the app and click **"Skip to reading .out files →"**, or
use the example file `example-dataset/data.dat` (600 × 16, a synthetic 3-factor / bifactor dataset).

## 2 · Model

Sketch the measurement model on the **Λ target-pattern matrix**. Rows are items, columns are factors; click
a cell to set the primary (target) loading. Choose the number of factors, the rotation, the estimator, which
models to generate, and (optionally) a grouping variable for invariance.

![Model builder](docs/img/02-model-builder.png?v=4)

**Geomin vs Target — what the grid means.** Under **Geomin** every item loads on every factor freely (the
rotation decides the pattern); the orange marks only label which loading you consider *primary* (for bolding,
the diagram, and ω) and do **not** change the syntax. Under **Target** the grid *is* the model: marked cells
are free, unmarked cells are given a target value of `~0`. The app warns if a Target pattern has too few `~0`
constraints to identify the rotation, or if a factor has no main items.

## 3 · Syntax

The app writes exact Mplus `.inp` for each requested model. Download a single file or a `.zip` of all of
them; lines are wrapped to stay under Mplus's 90-character limit.

![Generated syntax](docs/img/03-syntax.png?v=6)

A few load-bearing conventions:

- **CFA** uses standardized-factor identification: `F1 BY x1* x2 x3; F1@1;`
- **ESEM (Geomin):** `ROTATION = GEOMIN(OBLIQUE, .5);` and `F1-Fk BY <items> (*1);`
- **ESEM (Target):** one `BY` line per factor with `~0` on the cross-loadings.
- **Bifactor-ESEM:** `ROTATION = BI-GEOMIN(ORTHOGONAL .5);` with `G F1-Fk BY <items> (*1);`
- **Invariance** uses the standardized-factors approach (`F@1`/`[F@0]` freed to `*`/`[*]` from weak
  invariance on) with alphanumeric equality labels `(i1-i#)`, `(u1-u#)`, `(cov#)`. With grouping on, the checked
  measurement models are still generated on the total sample (with time on, on the Time-1 indicators), followed by one invariance sequence per checked measurement model — **CFA**, **ESEM**, **bifactor-CFA** and
  **bifactor-ESEM** (the bifactor chains handle the G factor's variance/mean/covariances per step; the bifactor-ESEM chain uses orthogonal
  target rotation) — each with its own file prefix and its own results table.
- **Categorical items** (all items flagged on the Data step) switch the multi-group sequence to the
  **WLSMV + `PARAMETERIZATION=THETA`** thresholds chain: configural already equates every item's first
  threshold plus one referent's second threshold per factor (Millsap identification — latent means are
  free in the non-reference groups from the start), scalar equates all thresholds, strict refixes the
  uniquenesses to 1. Each step saves derivatives via `SAVEDATA: DIFFTEST = Inv_diff_<step>.dat;` and the
  next step reads them via `ANALYSIS: DIFFTEST = …;` — **run the models in order, in one folder** (auto
  mode does this for you), so Mplus can print the difference test the Results table relies on. The
  bifactor-ESEM sequence follows the same chain (one more referent's second threshold for the G factor,
  Morin's rule) with its own `BifactorInv_diff_<step>.dat` files. Across time the same thresholds chain is
  generated for CFA, ESEM, bifactor-CFA and bifactor-ESEM (thresholds equated across waves by shared labels, Time-1
  uniquenesses fixed at 1, `LongInv_<model>_diff_<step>.dat` files). Mixed item sets (some ordinal, some continuous)
  run under WLSMV/THETA with thresholds for the ordinal and intercepts for the continuous items (CFA, ESEM and
  bifactor-CFA; a factor's latent mean is freed from configural on only when it owns an ordinal referent). A response
  category empty in one group or at one wave stops WLSMV: the invariance card lists these **sparse categories** with
  their counts and merges them into a neighbour on request (`DEFINE: IF (item EQ k) THEN item = j;` in every input).
- Every model requests Morin's recommended output line, `SAMPSTAT STANDARDIZED MODINDICES CINTERVAL
  RESIDUAL SVALUES TECH1 TECH3 TECH4`; `SVALUES` is what ESEM-within-CFA (below) needs. With the loosened
  `CONVERGENCE` aid on and a missing-value code set, ML-family models also get a matching `H1CONVERGENCE`
  line (and `H1ITERATIONS` wherever an `ITERATIONS` line is set). Categorical chains need, per factor, one
  referent item with at least three response categories (its second threshold identifies the latent means);
  binary-only factors are refused with an explanation.

Now run the `.inp` files in **your own Mplus** and save the `.out` files.

## 4 · Results

Drop one or many `.out` files. Each is parsed in the browser into a fit row, a standardized-loadings table
(target loadings bold, δ uniqueness, McDonald's ω, factor correlations), auto-written APA prose, and a path
diagram. Multiple invariance models become a single comparison table with Δχ² (Satorra–Bentler scaled for
MLR; for WLSMV sequences the column shows Mplus's `DIFFTEST` difference test instead, read from each
step's own `.out`), ΔCFI, ΔTLI, and ΔRMSEA; the note gives Chen's (2007) guideline for reading them (a decrease
of .010 or more in CFI or TLI, or an increase of .015 or more in RMSEA, suggests the added constraints are not
tenable), names the comparison model of a row whose preceding step was not estimated, and says that the rows
after a step that went beyond the guideline are reported for completeness only. There is no verdict column. When both
the ESEM and bifactor-ESEM multi-group sequences are present, they render as two separate tables. Export
with **Copy for Word** or **Download .docx**.

![Results — fit, loadings, diagram](docs/img/04-results.png?v=5)

The diagrams follow the article's figures and are interactive — toggle cross-loadings / uniquenesses,
show/hide factors, drag the ellipses to reposition for reporting, and export SVG or PNG. The bifactor layout
puts the specific factors on one side and the global factor on the other, reaching every item:

![Bifactor diagram](docs/img/06-bifactor-diagram.png?v=5)

The six invariance models (men vs women) collapse into one comparison table with the Δ statistics, read
against Chen's guideline in the note:

![Measurement invariance comparison table](docs/img/07-invariance.png?v=6)

## 5 · ESEM-within-CFA

When a dropped ESEM (or bifactor-ESEM) `.out` carries a `SVALUES` block, the Results step shows an
**ESEM-within-CFA** card. It reads the rotated solution's *unstandardized* estimates ("CFA MODEL COMMAND
WITH FINAL ROTATED ESTIMATES USED AS STARTING VALUES"), picks a referent indicator per factor, fixes that
referent's cross-loadings to their ESEM values (`@`), fixes the factor variances to 1, and — for bifactor —
fixes all factor correlations to 0. Choose a different referent per factor from the dropdowns; copy or
download the runnable `.inp`.

The card offers two identification **forms** (Morin):

- **Standard** (default) — referent *cross*-loadings fixed, factor variances `@1`. Use when the factors
  stay exogenous: MIMIC / DIF models, or the factors predicting outcomes.
- **Higher-order** — the referent's *main* loading is **also** fixed and the factor variances are freed
  with a start value of 1 (`*1` instead of `@1`). Required when the factors become **endogenous** — under
  a higher-order factor (`HF BY f1* f2 f3; HF@1;`) or predicted by covariates — because an endogenous
  factor's (residual) variance must remain a free parameter, so scale-setting moves from the variance to
  the referent's main loading. Both forms are exact reparameterizations of the same rotated solution.

![ESEM-within-CFA card](docs/img/05-esem-within-cfa.png?v=5)

This is Morin's referent method (Technical Supplement, pp. T10–T13). With the same referents, the toolkit
reproduces the published ESEM-within-CFA byte-for-byte at the parameter level.

### Why you can trust it — exact reproduction in Mplus 8.3

The generated **oblique** ESEM-within-CFA is an exact reparameterization of the ESEM it came from:

| Model (example dataset) | npar | df | χ² (MLR) | log-likelihood |
|---|---|---|---|---|
| 3-factor ESEM (Geomin) — `2_ESEM_geomin.out` | 72 | 63 | 68.83 | −11107.13 |
| → its ESEM-within-CFA | **72** | **63** | **68.82** | **−11107.13** |

Same parameter count, same degrees of freedom, same fit. (For an orthogonal bifactor solution the
within-CFA reproduces the same log-likelihood and estimates via the referent method; its df can sit
m(m−1)/2 above the rotated bifactor-ESEM — a known property of the orthogonal referent parameterization.)

The **higher-order form** is verified the same way: on the bundled 2-factor ESEM (`ESEM.dat`,
χ²(4) = 3.117, LL = −32781.176, npar = 23), the generated higher-order EWC returns the identical
npar / df / χ² / log-likelihood in Mplus 8.3, with the freed factor variances estimated back at 1.000
and the factor correlation at its ESEM value (.439).

