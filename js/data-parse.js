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
export function sanitizeName(s) {
  const ascii = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => TR_MAP[m]);
  return ascii.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1').slice(0, 8) || 'V';
}

/** Ensure 8-char-truncated names are unique (duplicates would break the Mplus NAMES list). */
export function dedupeNames(names) {
  const seen = new Map();
  return names.map((n) => {
    if (!seen.has(n)) { seen.set(n, 1); return n; }
    const k = seen.get(n) + 1; seen.set(n, k);
    const suffix = String(k);
    return n.slice(0, 8 - suffix.length) + suffix;
  });
}

/** Parse a pasted list of variable names — one per line (the Name column copied from SPSS), or separated by
 *  spaces, commas or tabs, or a whole Mplus "NAMES ARE x1-x12 age;" statement (ranges expanded). Returns
 *  Mplus-safe, unique names. */
export function parseNameList(text) {
  const t = String(text || '').replace(/^\s*NAMES\s*(ARE|=)\s*/i, '').replace(/;\s*$/, '');
  const out = [];
  for (const tok of t.split(/[\s,;]+/).filter(Boolean)) {
    const r = tok.match(/^([A-Za-z_][A-Za-z0-9_]*?)(\d+)-([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/);
    if (r && r[1] === r[3] && Number(r[4]) > Number(r[2]) && Number(r[4]) - Number(r[2]) < 5000) { for (let i = Number(r[2]); i <= Number(r[4]); i++) out.push(`${r[1]}${i}`); }
    else out.push(tok);
  }
  return dedupeNames(out.map(sanitizeName));
}

/** A value that looks like a missing-value code and is not declared as one: a known sentinel (999, -999, -99,
 *  9999, -9, ".", NA …) seen in at least two columns, where every other value of those columns sits far below
 *  it (so 99 on a 0–100 scale is not flagged). Returns { code, columns, cells } or null. */
export function detectMissingCode(data) {
  const m = data?._matrix;
  if (!m?.length) return null;
  const nCols = data.varNames.length;
  const SENT = ['-999', '999', '-9999', '9999', '-99', '99', '-9', '-1', '-999.0', '-99.0', '999.0', '.', 'NA', 'na', 'N/A', 'n/a', '-'];
  const cands = new Map(); // code → { columns: Set, cells }
  for (let c = 0; c < nCols; c++) {
    const counts = new Map();
    let maxOther = -Infinity, minOther = Infinity;
    const present = new Set();
    for (const row of m) {
      const v = row[c];
      if (v == null || v === '') continue;
      if (SENT.includes(v)) { present.add(v); counts.set(v, (counts.get(v) || 0) + 1); continue; }
      const x = Number(String(v).replace(',', '.'));
      if (!Number.isNaN(x)) { if (x > maxOther) maxOther = x; if (x < minOther) minOther = x; }
    }
    for (const v of present) {
      const x = Number(v);
      const numeric = !Number.isNaN(x);
      // a numeric sentinel must sit far outside the column's other values; a textual one always counts
      const fits = !numeric || (x < 0 ? (minOther === Infinity || minOther >= 0) : (maxOther === -Infinity || maxOther <= x / 5));
      if (!fits) continue;
      if (!cands.has(v)) cands.set(v, { columns: new Set(), cells: 0 });
      cands.get(v).columns.add(data.varNames[c]);
      cands.get(v).cells += counts.get(v);
    }
  }
  let best = null;
  for (const [code, info] of cands) {
    if (info.columns.size < 2) continue;
    if (!best || info.columns.size > best.columns.size || (info.columns.size === best.columns.size && info.cells > best.cells)) best = { code, columns: info.columns.size, cells: info.cells, names: [...info.columns] };
  }
  return best;
}

/** Columns that look like ordered-categorical (Likert) items: integer values only, 2–7 distinct levels within
 *  0–10, over at least 20 rows; `ignore` lists the missing-value code(s) to leave out. ID-like columns do not
 *  pass (too many levels). */
export function detectLikertColumns(data, { ignore = [] } = {}) {
  const m = data?._matrix;
  if (!m?.length || m.length < 20) return [];
  const skip = new Set(['', '*', '.', ...ignore.filter((x) => x != null && x !== '').map(String)]);
  const out = [];
  data.varNames.forEach((name, c) => {
    const levels = new Set();
    let n = 0, ok = true;
    for (const row of m) {
      const v = row[c];
      if (v == null || skip.has(v)) continue; // blanks and the missing-value code do not count as levels
      const x = Number(String(v).replace(',', '.'));
      if (Number.isNaN(x) || !Number.isInteger(x) || x < 0 || x > 10) { ok = false; break; }
      levels.add(x); n++;
      if (levels.size > 7) { ok = false; break; }
    }
    if (ok && n >= 20 && levels.size >= 2) out.push(name);
  });
  return out;
}

