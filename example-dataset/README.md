# Example dataset — `data.dat`

A **fully synthetic** dataset that mirrors the 3-factor / bifactor structure of the ACSS example in
Swami, Maïano & Morin (2023). No real participants, and the article's own data is not redistributed.

- **600 rows × 16 columns**, space-delimited, no header, dot decimals (Mplus free format).
- Columns `i1 … i15` = 15 items; `gender` = a 2-level grouping variable (`1` men / `2` women).
- **Structure:** a true bifactor population — one general factor (G) plus **3 specific factors of five
  items each** (i1–i5 → F1, i6–i10 → F2, i11–i15 → F3), λ_G ≈ .45, λ_S ≈ .55. So it fits a 3-factor
  CFA/ESEM well and a bifactor model even better.

## Ready-made Mplus inputs and outputs

Every `.inp` was produced by the toolkit; every `.out` is a **real Mplus 8.3 run** of it (all converged,
full SE + fit). These inputs carry the OUTPUT request the toolkit used at the time (`SAMPSTAT STANDARDIZED
RESIDUAL CINTERVAL MODINDICES (3.0) TECH2 TECH4`, with `SVALUES` on the rotated models); the app now requests
Morin's fuller line, which changes what Mplus prints, not what it estimates. Drop any `.out` into the app's **Results** step for APA tables, prose, and path diagrams.

| File | Model | Note |
|------|-------|------|
| `1_CFA.out` | 3-factor CFA | independent-clusters |
| `2_ESEM_geomin.out` | 3-factor ESEM, Geomin (.5) | carries a **SVALUES** block → ESEM-within-CFA |
| `3_ESEM_target.out` | 3-factor ESEM, Target | carries a SVALUES block |
| `4_Bifactor_CFA.out` | Bifactor-CFA (G + 3 S) | orthogonal general + specific factors |
| `5_Bifactor_ESEM.out` | Bifactor-ESEM (G + 3 S), BI-GEOMIN | carries a SVALUES block |
| `inv_1_configural.out … inv_6_latentmean.out` | Measurement invariance across `gender` | configural → metric → scalar → strict → var/cov → latent means |
| `LongInv_esem_1 … 6*.out` | **Longitudinal** invariance, ESEM (Geomin) | 2-wave well-being example (see below), same six steps |
| `LongInv_besem_1 … 6*.out` | **Longitudinal** invariance, bifactor-ESEM | Morin's Hoyle-Handbook sequence (orthogonal target, G + 3 S per wave) |

## Second dataset — `iyiolus.dat` (2 waves, for the longitudinal models)

Also fully synthetic: **800 rows × 24 columns**, 12 well-being items (`duy1…sos4`) measured at two time
points (`_t1` / `_t2`), bifactor population (G + 3 specific factors), fully invariant across waves with a
designed **+0.5 SD gain on the general factor** at Time 2. So the longitudinal sequences support invariance
through variance–covariance and reject the latent-means step — and the bifactor sequence shows the growth
lives on G only (specific-factor means ≈ 0).

## Try it (in the app)

1. Open the app → **"Skip to reading .out files →"**.
2. Drop `1_CFA.out` + `2_ESEM_geomin.out` + `5_Bifactor_ESEM.out` together → one fit-comparison table plus
   standardized loadings and diagrams for each; the ESEM card also offers an **ESEM-within-CFA** conversion.
3. Drop all six `inv_*.out` together → an invariance table with Satorra–Bentler Δχ², ΔCFI / ΔTLI / ΔRMSEA verdicts.
4. Drop all twelve `LongInv_*.out` together → two longitudinal comparison tables (ESEM and bifactor-ESEM).
5. To build syntax from scratch: **Data** → `data.dat` → **Model** (3 factors, i1–i5 → F1, i6–i10 → F2, i11–i15 → F3).

A guided walkthrough of all of this is at [`/demo.html`](../demo.html).
