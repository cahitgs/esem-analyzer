// docx-export.js — export APA results to Word. Three paths:
//   copyResultsToWord(models)  → rich clipboard HTML (paste into Word keeps tables + bold)
//   exportDocx(models)         → a real .docx via the `docx` UMD global
//   zipInputs(files)           → bundle generated .inp files via the `JSZip` UMD global
import { apaNum, apaP, toast, downloadBlob } from './ui.js';
import { sbChiSqDiff, buildLoadingsModel, invarianceSeries, invarianceGuidelineNote, sortInvarianceModels, invarianceProseText, unestimatedNote, noFitReason, unestimatedFitNote, noChiSquareSentence, fitComparisons, fitDelta, REFERENCE_NOTE } from './apa-render.js';

// Sequences are ordered by invariance step (configural → … → latent means), never by df: an output without
// fit statistics has no df and used to be sorted to the top of its table.
const splitGroups = (models) => {
  const longi = models.filter((m) => m.parsed.invKind === 'longitudinal');
  const rest = models.filter((m) => m.parsed.invKind !== 'longitudinal');
  const mg = rest.filter((m) => (m.parsed.nGroups || 1) > 1);
  // Up to four chains per family can coexist (CFA, ESEM, bifactor-CFA, bifactor-ESEM). They are not nested
  // in each other, so each gets its own table — the same split the on-screen Results make.
  const kind = (m) => m.parsed.invModel || (/bifactor-ESEM/i.test(m.parsed.title || '') ? 'besem' : 'esem');
  const pick = (list, id) => sortInvarianceModels(list.filter((m) => kind(m) === id));
  return {
    longiCfa: pick(longi, 'cfa'), longiEsem: pick(longi, 'esem'), longiBcfa: pick(longi, 'bcfa'), longiBesem: pick(longi, 'besem'),
    multiCfa: pick(mg, 'cfa'), multi: pick(mg, 'esem'), multiBcfa: pick(mg, 'bcfa'), multiBesem: pick(mg, 'besem'),
    single: rest.filter((m) => (m.parsed.nGroups || 1) <= 1),
  };
};
// chain sets of one family in table order, with the label used when more than one chain is present
const chainSets = (g, longitudinal) => (longitudinal
  ? [[g.longiCfa, 'CFA'], [g.longiEsem, 'ESEM'], [g.longiBcfa, 'Bifactor-CFA'], [g.longiBesem, 'Bifactor-ESEM']]
  : [[g.multiCfa, 'CFA'], [g.multi, 'first-order ESEM'], [g.multiBcfa, 'bifactor-CFA'], [g.multiBesem, 'bifactor-ESEM']]).filter(([set]) => set.length);
// Multi-group note string for the invariance table (Word + .docx).
function mgNote(models) {
  const series = invarianceSeries(models);
  return `N = ${models[0]?.parsed.nObs ?? '—'} across ${models[0]?.parsed.nGroups ?? 2} groups. ${invarianceGuidelineNote(series)}${unestimatedNote(series)}`;
}

function invRows(models) {
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', 'ΔCFI', 'ΔTLI', 'ΔRMSEA'];
  // same rows as the on-screen table: sequence order, unestimated outputs marked and skipped by the comparisons,
  // a letter mark on a row whose comparison model is not the preceding step (explained in the note)
  const body = invarianceSeries(models).map(({ m, f, dec, estimated, mark }) => (estimated
    ? [m.label + (mark ? ` ${mark}` : ''), f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`,
      dec.dcfi != null ? signed(dec.dcfi) : '—', dec.dtli != null ? signed(dec.dtli) : '—', dec.drmsea != null ? signed(dec.drmsea) : '—']
    : [m.label, 'Not estimated', ...Array(7).fill('—')]));
  return { head, body };
}
function invProseText(models, opts = {}) {
  const s = invarianceProseText(models, opts); // the manuscript's paragraph, verbatim
  return s ? [s] : [];
}
// Longitudinal note string for the invariance table (Word + .docx).
function longiNote(models, modelLabel) {
  const series = invarianceSeries(models);
  return `N = ${models[0]?.parsed.nObs ?? '—'} across two time points${modelLabel ? ` (${modelLabel})` : ''}. ${invarianceGuidelineNote(series)}${unestimatedNote(series)}`;
}

const f2 = (x) => apaNum(x, 2, false);
const f3 = (x) => apaNum(x, 3);
const ci = (lo, hi) => (lo == null || hi == null ? '—' : `[${f3(lo)}, ${f3(hi)}]`);
// Morin-style loadings-table note (same text in Word HTML + .docx; "Note." prefix added per renderer).
const loadingsNote = (p, model) => `Target (primary) loadings in bold${model.anyNonSig ? '; non-significant loadings (p ≥ .05) in italics' : ''}. δ = uniqueness (1 − R²); ω = McDonald's composite reliability (per subscale block${p.generalFactor ? "; the general factor's ω is shown on the last block" : ''}).`;

// ----------------------------------------------------------------------------
// Shared row model so the HTML and .docx builders stay in lockstep.
// ----------------------------------------------------------------------------
function fitRows(models) {
  const multi = models.length > 1;
  // WLSMV runs report WRMR instead of SRMR, and their χ² values cannot be SB-differenced —
  // same auto-detection as apa-render's renderFitTable so screen and Word/.docx stay in step.
  const useWrmr = !models.some((m) => m.parsed.fit.srmr != null) && models.some((m) => m.parsed.fit.wrmr != null);
  const cmp = fitComparisons(models, multi ? 'auto' : 'none');
  const head = ['Model', 'χ²', 'df', 'CFI', 'TLI', 'RMSEA [90% CI]', useWrmr ? 'WRMR' : 'SRMR'];
  if (cmp.mode !== 'none') head.push(...(cmp.mode === 'reference' ? ['vs.'] : []), 'Δχ²(s)', 'Δdf', 'ΔCFI', 'ΔTLI', 'ΔRMSEA');
  const body = models.map((m, i) => {
    const f = m.parsed.fit;
    const r = [m.label, f2(f.chi2), f.df ?? '—', f3(f.cfi), f3(f.tli), `${f3(f.rmsea)} ${ci(f.rmseaLo, f.rmseaHi)}`, f3(useWrmr ? f.wrmr : f.srmr)];
    if (cmp.mode !== 'none') {
      const c = cmp.rows[i];
      if (c.ref == null) r.push(...(cmp.mode === 'reference' ? ['—'] : []), '—', '—', '—', '—', '—');
      else {
        const dl = fitDelta(models[c.ref].parsed.fit, f, { nested: c.nested, useWrmr });
        if (cmp.mode === 'reference') r.push(models[c.ref].label);
        r.push(dl.sb ? f2(dl.sb.TRd) + (dl.sb.p < 0.05 ? '*' : '') : '—', dl.sb ? dl.sb.df : '—',
          dl.dcfi != null ? signed(dl.dcfi) : '—', dl.dtli != null ? signed(dl.dtli) : '—', dl.drmsea != null ? signed(dl.drmsea) : '—');
      }
    }
    return r;
  });
  return { head, body, useWrmr, mode: cmp.mode };
}
// Fit-table note, estimator-aware (Word HTML + .docx share the wording).
function fitNote(models, fr) {
  const n = `N = ${models[0]?.parsed.nObs ?? '—'}.`;
  const ref = fr.mode === 'reference' ? ' ' + REFERENCE_NOTE : '';
  return fr.useWrmr
    ? `${n} WRMR = weighted root mean square residual.${ref} For the WLSMV estimator, χ² differences require the Mplus DIFFTEST option; compare models via ΔCFI/ΔTLI/ΔRMSEA.${unestimatedFitNote(models)}`
    : `${n}${ref} Δχ²(s) = Satorra–Bentler scaled difference (MLR).${unestimatedFitNote(models)} * p < .05.`;
}
function signed(x) { return (x < 0 ? '−' : '+') + apaNum(Math.abs(x), 3); }

// ----------------------------------------------------------------------------
// Word clipboard (HTML)
// ----------------------------------------------------------------------------
export function buildWordHtml(models, { factorLabels = {} } = {}) {
  const groups = splitGroups(models), { single } = groups;
  const longiSets = chainSets(groups, true), mgSets = chainSets(groups, false);
  const lbl = (p, fid) => (factorLabels[fid] || fid);
  const TBL = 'border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt;margin:6pt 0;';
  const top = 'border-top:1.5pt solid #000;', bot = 'border-bottom:1.5pt solid #000;', hbot = 'border-bottom:0.75pt solid #000;';
  const cell = (t, { b = false, ital = false, l = false, thin = false, heavy = false } = {}) => `<td style="padding:3pt 8pt;text-align:${l ? 'left' : 'right'};${b ? 'font-weight:bold;' : ''}${ital ? 'font-style:italic;' : ''}${thin ? hbot : ''}${heavy ? bot : ''}">${t}</td>`;
  const simpleTable = (title, head, body, note) => {
    let h = `<p style="font-style:italic;margin:2pt 0">${title}</p><table style="${TBL}"><tr>${head.map((x, i) => `<th style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${top}${hbot}">${x}</th>`).join('')}</tr>`;
    body.forEach((r, ri) => { h += `<tr>${r.map((c, i) => `<td style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${ri === body.length - 1 ? bot : ''}">${c}</td>`).join('')}</tr>`; });
    return h + `</table><p style="font-size:9pt;margin:2pt 0 10pt"><i>Note.</i> ${note}</p>`;
  };

  // longitudinal invariance table(s) (single-group sequence, one per measurement model)
  let longi = '';
  const longiTable = (set, modelLabel) => {
    if (!set.length) return;
    const ir = invRows(set);
    longi += simpleTable(`Table. Tests of longitudinal measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`, ir.head, ir.body, longiNote(set, modelLabel));
  };
  for (const [set, label] of longiSets) longiTable(set, longiSets.length > 1 ? label : '');

  // invariance table(s) (multi-group) — one per family; the two chains are not nested in each other
  let inv = '';
  const mgTable = (set, modelLabel) => {
    if (!set.length) return;
    const ir = invRows(set);
    inv += simpleTable(`Table. Tests of measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`, ir.head, ir.body, mgNote(set));
  };
  for (const [set, label] of mgSets) mgTable(set, mgSets.length > 1 ? label : '');

  // fit table (single-group)
  let fit = '';
  if (single.length) { const fr = fitRows(single); fit = simpleTable('Table. Goodness-of-fit statistics', fr.head, fr.body, fitNote(single, fr).replace('< .05', '&lt; .05')); }

  // loadings tables (single-group only) — Morin Table-2 blocks via the shared model; rule rows
  // are skipped in print: each ω row's thin underline is the block separator, and the last
  // physical row (last corr row, else the last ω row) carries the heavy closing border.
  let loads = '';
  for (const m of single) {
    const p = m.parsed, model = buildLoadingsModel(p);
    const head = ['Item', ...model.factors.map((fid) => lbl(p, fid)), 'δ'];
    loads += `<p style="font-style:italic;margin:10pt 0 2pt">Table. Standardized factor loadings — ${m.label}</p><table style="${TBL}"><tr>${head.map((h, i) => `<th style="padding:3pt 8pt;text-align:${i ? 'right' : 'left'};${top}${hbot}">${h}</th>`).join('')}</tr>`;
    const omegas = model.rows.filter((r) => r.kind === 'omega');
    for (const r of model.rows) {
      if (r.kind === 'rule') continue;
      const heavy = r.kind === 'omega' && r === omegas[omegas.length - 1] && !model.anyCorr;
      const thin = r.kind === 'omega' && !heavy;
      loads += `<tr>${r.cells.map((c, i) => cell(c.t, { b: !!c.bold, ital: !!c.italic, l: i === 0, thin, heavy })).join('')}</tr>`;
    }
    if (model.anyCorr) {
      loads += `<tr><td colspan="${head.length}" style="padding:3pt 8pt;text-align:left;font-style:italic">Factor correlations</td></tr>`;
      model.corr.forEach((r, ri) => {
        loads += `<tr>${[{ t: lbl(p, r.fid) }, ...r.cells].map((c, i) => cell(c.t, { l: i === 0, heavy: ri === model.corr.length - 1 })).join('')}</tr>`;
      });
    }
    loads += `</table><p style="font-size:9pt;margin:2pt 0 6pt"><i>Note.</i> ${loadingsNote(p, model)}</p>`;
  }

  const proseParts = [...longiSets.flatMap(([set]) => invProseText(set, { longitudinal: true })), ...proseText(single), ...mgSets.flatMap(([set]) => invProseText(set))];
  const prose = proseParts.map((t) => `<p style="font-family:Calibri;font-size:11pt;line-height:1.5;margin:6pt 0">${t}</p>`).join('');
  return `<html><head><meta charset="utf-8"></head><body>${longi}${inv}${fit}${loads}<h3 style="font-family:Calibri">Suggested text</h3>${prose}</body></html>`;
}

export async function copyResultsToWord(models, opts) {
  const html = buildWordHtml(models, opts);
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })]);
    toast('Copied — paste into Word', 'ok');
  } catch {
    await navigator.clipboard.writeText(plain);
    toast('Copied as text (rich copy unavailable)', 'ok');
  }
}

// ----------------------------------------------------------------------------
// Prose (plain strings, shared by Word + .docx)
// ----------------------------------------------------------------------------
function verdict(f) {
  if (f.cfi == null || f.rmsea == null) return 'an estimable';
  if (f.cfi >= 0.95 && f.tli >= 0.95 && f.rmsea <= 0.06) return 'excellent';
  if (f.cfi >= 0.90 && f.rmsea <= 0.08) return 'acceptable';
  return 'poor';
}
function proseText(models) {
  const out = [];
  for (const m of models) {
    const reason = noFitReason(m.parsed);
    if (reason) { out.push(`The ${m.label} model could not be estimated (${reason}); inspect its Mplus output before interpreting any of its estimates.`); continue; }
    const f = m.parsed.fit;
    if (f.chi2 == null) { out.push(noChiSquareSentence(m.label, f)); continue; }
    const targets = m.parsed.items.map((it) => Math.abs(m.parsed.loadings[m.parsed.primaryFactor[it]]?.[it]?.est)).filter((v) => v != null && !Number.isNaN(v));
    const omegas = Object.values(m.parsed.omega).filter((x) => x != null);
    let s = `The ${m.label} model provided ${verdict(f)} fit to the data, χ²(${f.df}) = ${f2(f.chi2)}, p ${apaP(f.p)}, CFI = ${f3(f.cfi)}, TLI = ${f3(f.tli)}, RMSEA = ${f3(f.rmsea)} [90% CI ${f3(f.rmseaLo)}, ${f3(f.rmseaHi)}], SRMR = ${f3(f.srmr)}.`;
    if (targets.length) s += ` Target standardized loadings ranged from |λ| = ${f3(Math.min(...targets))} to ${f3(Math.max(...targets))}${omegas.length ? `, with composite reliabilities of ω = ${f3(Math.min(...omegas))} to ${f3(Math.max(...omegas))}` : ''}.`;
    out.push(s);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Real .docx via the `docx` UMD global
// ----------------------------------------------------------------------------
export async function exportDocx(models, opts = {}) {
  const blob = await buildDocxBlob(models, opts);
  if (blob) { downloadBlob(blob, opts.fileName || 'esem-results.docx'); toast('Downloaded .docx', 'ok'); }
}

export async function buildDocxBlob(models, { factorLabels = {} } = {}) {
  const D = window.docx;
  if (!D) { toast('Word export library not loaded', 'err'); return null; }
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = D;
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = (sz) => ({ style: BorderStyle.SINGLE, size: sz, color: '000000' });

  const tc = (text, { bold = false, italics = false, align = 'right', topB = false, botB = false, botThin = false } = {}) => new TableCell({
    borders: { top: topB ? LINE(12) : NONE, bottom: botB ? LINE(12) : botThin ? LINE(6) : NONE, left: NONE, right: NONE },
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align === 'left' ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(text), bold, italics, font: 'Calibri', size: 20 })] })],
  });
  const headCell = (text, align) => new TableCell({
    borders: { top: LINE(12), bottom: LINE(6), left: NONE, right: NONE },
    margins: { top: 30, bottom: 30, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align === 'left' ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(text), bold: true, font: 'Calibri', size: 20 })] })],
  });
  const tbl = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }, rows });
  const italic = (t) => new Paragraph({ spacing: { before: 160, after: 40 }, children: [new TextRun({ text: t, italics: true, font: 'Calibri', size: 22 })] });
  const note = (t) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: t, font: 'Calibri', size: 16 })] });
  const para = (t) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, font: 'Calibri', size: 22 })] });

  const groups = splitGroups(models), { single } = groups;
  const longiSets = chainSets(groups, true), mgSets = chainSets(groups, false);
  const mkTable = (rows) => {
    const header = new TableRow({ children: rows.head.map((h, i) => headCell(h, i ? 'right' : 'left')) });
    const body = rows.body.map((r, ri) => new TableRow({ children: r.map((c, i) => tc(c, { align: i ? 'right' : 'left', botB: ri === rows.body.length - 1 })) }));
    return tbl([header, ...body]);
  };

  const blocks = [new Paragraph({ children: [new TextRun({ text: 'ESEM results', bold: true, font: 'Calibri', size: 28 })], spacing: { after: 120 } })];

  // longitudinal invariance table(s) (single-group sequence, one per measurement model)
  const longiBlock = (set, modelLabel) => {
    if (!set.length) return;
    blocks.push(italic(`Table. Tests of longitudinal measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`), mkTable(invRows(set)), note(`Note. ${longiNote(set, modelLabel)}`));
  };
  for (const [set, label] of longiSets) longiBlock(set, longiSets.length > 1 ? label : '');

  // invariance table(s) (multi-group) — one per family; the two chains are not nested in each other
  const mgBlock = (set, modelLabel) => {
    if (!set.length) return;
    blocks.push(italic(`Table. Tests of measurement invariance${modelLabel ? ` (${modelLabel})` : ''}`), mkTable(invRows(set)), note(`Note. ${mgNote(set)}`));
  };
  for (const [set, label] of mgSets) mgBlock(set, mgSets.length > 1 ? label : '');

  // fit table (single-group)
  if (single.length) { const fr = fitRows(single); blocks.push(italic('Table. Goodness-of-fit statistics'), mkTable(fr), note(`Note. ${fitNote(single, fr)}`)); }

  // loadings tables (single-group) — same Morin layout as the Word-HTML path (shared model):
  // rule rows skipped, ω rows thin-underlined, heavy border on the last physical row.
  for (const m of single) {
    const p = m.parsed, model = buildLoadingsModel(p);
    const head = ['Item', ...model.factors.map((fid) => factorLabels[fid] || fid), 'δ'];
    const hRow = new TableRow({ children: head.map((h, i) => headCell(h, i ? 'right' : 'left')) });
    const omegas = model.rows.filter((r) => r.kind === 'omega');
    const rows = [];
    for (const r of model.rows) {
      if (r.kind === 'rule') continue;
      const heavy = r.kind === 'omega' && r === omegas[omegas.length - 1] && !model.anyCorr;
      const thin = r.kind === 'omega' && !heavy;
      rows.push(new TableRow({ children: r.cells.map((c, i) => tc(c.t, { bold: !!c.bold, italics: !!c.italic, align: i ? 'right' : 'left', botB: heavy, botThin: thin })) }));
    }
    if (model.anyCorr) {
      // no columnSpan (CDN docx version compatibility unverified): italic title in cell 1, rest empty
      rows.push(new TableRow({ children: head.map((_, i) => tc(i === 0 ? 'Factor correlations' : '', { italics: i === 0, align: 'left' })) }));
      model.corr.forEach((r, ri) => {
        rows.push(new TableRow({ children: [{ t: factorLabels[r.fid] || r.fid }, ...r.cells].map((c, i) => tc(c.t, { align: i ? 'right' : 'left', botB: ri === model.corr.length - 1 })) }));
      });
    }
    blocks.push(italic(`Table. Standardized factor loadings — ${m.label}`), tbl([hRow, ...rows]), note(`Note. ${loadingsNote(p, model)}`));
  }

  blocks.push(new Paragraph({ children: [new TextRun({ text: 'Suggested text', bold: true, font: 'Calibri', size: 24 })], spacing: { before: 200, after: 80 } }));
  for (const t of [...longiSets.flatMap(([set]) => invProseText(set, { longitudinal: true })), ...proseText(single), ...mgSets.flatMap(([set]) => invProseText(set))]) blocks.push(para(t));

  const doc = new Document({ sections: [{ children: blocks }] });
  return Packer.toBlob(doc);
}

// ----------------------------------------------------------------------------
// Zip generated .inp files
// ----------------------------------------------------------------------------
export async function buildZipBlob(files) {
  const J = window.JSZip;
  if (!J) { toast('Zip library not loaded', 'err'); return null; }
  const zip = new J();
  for (const f of files) zip.file(f.name, f.text);
  return zip.generateAsync({ type: 'blob' });
}

export async function zipInputs(files, fileName = 'esem-syntax.zip') {
  const blob = await buildZipBlob(files);
  if (blob) { downloadBlob(blob, fileName); toast('Downloaded syntax .zip', 'ok'); }
}
