# Example data of the tutorial article

`Ch27-Data1.dat` and `Ch27-Data2.dat` are the two simulated data sets that accompany

Morin, A. J. S. (2023). Exploratory structural equation modeling. In R. H. Hoyle (Ed.), *Handbook of structural equation modeling* (2nd ed., pp. 503–524). Guilford.

They are redistributed here with the author's permission so that the tutorial article on ESEM Analyzer can be reproduced from the app's Data page (card "Example data from the article", or `?example=data1` / `?example=data2`).

- **Data Set 1** — 12 continuous indicators (X1–X4, Y1–Y4, Z1–Z4) from a three-factor ESEM population model (main loadings .50–.90, factor correlations .20/.30/.35, cross-loadings 0–.20) and GROUP (1, 2; 5,000 each); the Z2 intercept differs between the groups. Space-delimited, no header row, 10,000 rows × 13 columns.
- **Data Set 2** — the same indicators at two occasions (x1_t1 … z4_t1, x1_t2 … z4_t2) from a bifactor-ESEM population model (G loadings .40–.80, S loadings .40–.70, correlated uniquenesses 0–.15 across occasions); the general-factor mean rises from 0 to .8 and the z2 intercept is not invariant over time. 10,000 rows × 24 columns.
- `data1-model.json`, `data2-model.json` — the model specifications of the article (3 factors, target rotation, all four measurement models, the six-step invariance sequence across groups / across time), in the app's Save model format.
