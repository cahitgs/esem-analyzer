// data-parse.js — read an Mplus .dat (free, whitespace) or .csv entirely in-browser.
// Returns metadata only; the numeric matrix is kept for optional group-code discovery.
// Mplus .dat has NO header row, so for .dat we default names to V1..Vn (user-editable).

export function parseDataFile(text, fileName = '') {
  // strip BOM, normalize newlines, drop blank lines
  const raw = String(text).replace(/^﻿/, '');
  const allLines = raw.split(/\r\n|\r|\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  if (!allLines.length) throw new Error('The file looks empty.');

  // Auto-detect the field delimiter: semicolon, comma, or tab — whichever splits the header into
  // the most columns. Turkish/European Excel exports use ';' because ',' is the decimal mark.
  // Fall back to whitespace (the Mplus .dat free format, which has no header row).
  const firstLine = allLines[0];
  let delimChar = null, delimName = 'whitespace';
  for (const [ch, name] of [[';', 'semicolon'], [',', 'comma'], ['\t', 'tab']]) {
    const n = firstLine.split(ch).length;
    if (n > 1 && (delimChar === null || n > firstLine.split(delimChar).length)) { delimChar = ch; delimName = name; }
  }
  const splitRow = delimChar
    ? (l) => l.split(delimChar).map((s) => s.trim())
    : (l) => l.trim().split(/\s+/);

  const firstTok = splitRow(firstLine);
  const isNum = (s) => s !== '' && !Number.isNaN(Number(s.replace(/[*.]/g, (m) => (m === '.' ? '.' : '0'))) ) && /^-?[\d.]+([eE]-?\d+)?$/.test(s);
  const secondTok = allLines[1] ? splitRow(allLines[1]) : [];
  // Header row: the first row is (almost) all non-numeric labels while the data row is mostly
  // numeric. A fraction test (not "all numeric") tolerates comma-decimals (Turkish "3,45"), NA, or
  // stray missing codes in the data row. Works for any delimiter incl. whitespace; a real Mplus
  // .dat has a numeric first row (fraction ~1), so this never false-positives on it.
  const numFrac = (toks) => (toks.length ? toks.filter(isNum).length / toks.length : 0);
  const hasHeader = firstTok.length > 1 && secondTok.length === firstTok.length
    && numFrac(firstTok) < 0.2 && numFrac(secondTok) >= 0.6;

  const nCols = firstTok.length;
  const dataLines = hasHeader ? allLines.slice(1) : allLines;
  const varNames = hasHeader ? dedupeNames(firstTok.map((s) => sanitizeName(s))) : Array.from({ length: nCols }, (_, i) => `V${i + 1}`);

  // numeric matrix (for group-code discovery, preview, and the Mplus-ready .dat export)
  const cap = Math.min(dataLines.length, 50000);
  const matrix = [];
  for (let i = 0; i < cap; i++) {
    const t = splitRow(dataLines[i]);
    if (t.length === nCols) matrix.push(t);
  }

  // Mplus needs a space/comma/tab file with NO header; a semicolon CSV or a header row is not
  // directly readable. Flag that, and offer a canonical .dat the app can export (see buildDat).
  const needsMplusDat = hasHeader || delimName === 'semicolon';

  return {
    fileName,
    mplusFile: mplusDataName(fileName),
    delimiter: delimName,
    hasHeader,
    needsMplusDat,
    matrixTruncated: dataLines.length > cap,
    nCols,
    nRows: dataLines.length,
    varNames,
    categorical: [],
    missingCode: null,
    preview: dataLines.slice(0, 6).map(splitRow),
    _matrix: matrix,
  };
}

/** A short, ASCII, Mplus-safe data filename derived from the upload (always .dat). */
export function mplusDataName(fileName = '') {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  const safe = base.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => TR_MAP[m]).replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return (safe || 'data') + '.dat';
}

/** Build a Mplus-ready data file: the numeric matrix, space-delimited, no header row.
 *  Mplus free format treats "," as a VALUE separator, so a Turkish decimal comma ("3,45") would be
 *  read as two numbers and shift the whole row → astronomical variances / read errors. Normalize
 *  decimal commas to dots, and write empty cells as the Mplus free-format missing flag "*". */
export function buildDat(data) {
  const rows = (data && data._matrix) || [];
  const fix = (t) => (t === '' ? '*' : t.replace(/^(-?\d+),(\d+)$/, '$1.$2'));
  return rows.map((r) => r.map(fix).join(' ')).join('\n') + '\n';
}

/** Distinct values in a column (by variable name) — used to auto-fill grouping codes. */
export function distinctValues(data, varName, max = 12) {
  const idx = data.varNames.indexOf(varName);
  if (idx < 0 || !data._matrix) return [];
  const seen = new Map();
  for (const row of data._matrix) {
    const v = row[idx];
    if (v == null || v === '') continue;
    seen.set(v, (seen.get(v) || 0) + 1);
    if (seen.size > max) break;
  }
  return Array.from(seen.entries()).map(([value, count]) => ({ value, count }))
    .sort((a, b) => Number(a.value) - Number(b.value));
}

const TR_MAP = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U' };
// Mplus variable names: ASCII, ≤ 8 chars, must start with a letter. Transliterate Turkish letters
// to their ASCII equivalents (İ→I, Ş→S, …) rather than dropping them, so names stay readable.
function sanitizeName(s) {
  const ascii = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => TR_MAP[m]);
  return ascii.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1').slice(0, 8) || 'V';
}

/** Ensure 8-char-truncated names are unique (duplicates would break the Mplus NAMES list). */
function dedupeNames(names) {
  const seen = new Map();
  return names.map((n) => {
    if (!seen.has(n)) { seen.set(n, 1); return n; }
    const k = seen.get(n) + 1; seen.set(n, k);
    const suffix = String(k);
    return n.slice(0, 8 - suffix.length) + suffix;
  });
}
