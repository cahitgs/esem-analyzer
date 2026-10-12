// diagram.js — Mplus-style path diagram (SVG), faithful to the abbreviated factor-loading
// diagrams in Swami, Maïano & Morin (2023), Body Image 47, Fig. 1.
//
// Two layouts, chosen automatically by model structure:
//   • Standard (CFA / ESEM) — Fig. 1(a)/(b): factor ellipses on the LEFT, item rectangles on
//     the RIGHT, reflective loading arrows factor→item (target solid/ochre, cross-loadings
//     dashed/grey), factor-correlation curves on the far left, optional residual (δ) stubs right.
//   • Bifactor (a general factor present) — Fig. 1(e)/(f): the SPECIFIC factors on the LEFT,
//     items in the CENTER, and the single GLOBAL factor on the RIGHT reaching every item.
//
// Two modes: estimated (numbers shown) and theoretical (`theoretical:true` — pure structure,
// no numbers, every modelled path drawn — like Fig. 1 itself, which omits estimates and errors).
//
// Source is either a ParsedModel (`pathDiagramSVG`) or a ModelSpec (`conceptDiagramSVG`, always
// theoretical). Both are normalised to one interface, then one renderer per layout draws it.

// Colour carries meaning only (design language of the app): ink = asserted target paths,
// amber = specific / first-order factors, navy = the general factor, grey = cross-loadings.
const PAL = {
  ink: '#15191E', soft: '#434B55', faint: '#8E97A1', line: '#C4CBC7', surface: '#FFFFFF',
  target: '#15191E',
  petrol: '#C98212', petrolL: '#8E97A1', ochre: '#2C5D9E', ochreD: '#1F4373',
  sWash: '#F6EBD6', gWash: '#E1E9F4',
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const f1 = (x) => Number(x).toFixed(1);
const fnum = (x) => { if (x == null || Number.isNaN(x)) return ''; let s = Number(x).toFixed(2); if (Math.abs(x) < 1) s = s.replace(/^(-?)0\./, '$1.'); return s; };

// ───────────────────────── public entry points ─────────────────────────

/** Path diagram from a ParsedModel (.out). Pass {theoretical:true} for a number-less version. */
export function pathDiagramSVG(parsed, opts = {}) {
  return renderDiagram(modelFromParsed(parsed, opts), opts);
}

/** Conceptual (theoretical) diagram from a ModelSpec, before any .out exists. */
export function conceptDiagramSVG(spec, modelType, opts = {}) {
  return renderDiagram(modelFromSpec(spec, modelType, opts), { ...opts, theoretical: true });
}

// ───────────────────────── normalisation ─────────────────────────

function isTargetForParsed(p, it, f) {
  if (p.generalFactor) return f === p.generalFactor || p.specificFactor[it] === f;
  return p.primaryFactor[it] === f;
}

function modelFromParsed(p, opts) {
  const labels = opts.factorLabels || {};
  return {
    items: (p.items || []).slice(),
    factors: (p.factorOrder || []).slice(),
    generalFactor: p.generalFactor || null,
    label: (f) => labels[f] || f,
    hasPath: (f, it) => p.loadings?.[f]?.[it]?.est != null,
    isTarget: (f, it) => isTargetForParsed(p, it, f),
    value: (f, it) => { const v = p.loadings?.[f]?.[it]?.est; return v == null ? null : v; },
    corr: (p.factorCorr || []).map((c) => ({ a: c.a, b: c.b, est: c.est })),
    delta: (it) => (p.uniqueness?.[it] == null ? null : p.uniqueness[it]),
  };
}

function modelFromSpec(spec, modelType, opts) {
  const labels = opts.factorLabels || {};
  const isEsem = /esem/i.test(modelType || '');
  const isBi = /bifactor/i.test(modelType || '');
  const specIds = spec.factors.map((f) => f.id);
  const factors = isBi ? ['G', ...specIds] : specIds;
  const items = (spec.items || []).slice();
  const main = (f, it) => f !== 'G' && spec.target?.[it]?.[f] === true;
  const oblique = spec.rotation?.oblique !== false;
  return {
    items, factors,
    generalFactor: isBi ? 'G' : null,
    label: (f) => labels[f] || (f === 'G' ? 'G' : (spec.factors.find((x) => x.id === f)?.label || f)),
    hasPath: (f, it) => (f === 'G' ? true : (isEsem ? true : main(f, it))),
    isTarget: (f, it) => (f === 'G' ? true : main(f, it)),
    value: () => null,
    corr: (!isBi && oblique && specIds.length > 1)
      ? specIds.flatMap((a, i) => specIds.slice(i + 1).map((b) => ({ a, b, est: null })))
      : [],
    delta: () => null,
  };
}

// ───────────────────────── shared geometry / primitives ─────────────────────────

const ITEM_W = 58, ITEM_H = 30, MARGIN = 28, FRX = 46, FRY = 26;

function layoutItems(n, rowGap) {
  const height = Math.max(232, MARGIN * 2 + n * ITEM_H + (n - 1) * rowGap);
  const ys = [];
  for (let i = 0; i < n; i++) ys.push(MARGIN + ITEM_H / 2 + i * (ITEM_H + rowGap));
  return { height, ys };
}

/** Grow the canvas (and re-centre the items) so k factor ellipses can spread out without ever
 *  overlapping — otherwise a model with more factors than items would clamp them on top of each
 *  other. Returns the (possibly taller) height and shifted item y-positions. */
function fitFactors(height, ys, k) {
  const need = 2 * (MARGIN + FRY) + Math.max(0, k - 1) * (2 * FRY + 16);
  if (need <= height) return { height, ys };
  const pad = (need - height) / 2;
  return { height: need, ys: ys.map((y) => y + pad) };
}

/** Factor y = centroid of its target items, then a bounded two-pass spread so ellipses keep at
 *  least `minGap` apart AND stay inside [lo, hi]. With fitFactors guaranteeing hi−lo ≥ (k−1)·minGap,
 *  this never compresses factors into an overlap (the old single-pass clamp could). */
function factorYs(model, items, itemY, factors, height) {
  const lo = MARGIN + FRY, hi = height - MARGIN - FRY, minGap = 2 * FRY + 16;
  const fy = {};
  factors.forEach((f) => {
    const t = items.filter((it) => model.isTarget(f, it) && model.hasPath(f, it));
    const ys = (t.length ? t : items).map((it) => itemY[it]);
    fy[f] = ys.reduce((a, b) => a + b, 0) / ys.length;
  });
  const order = [...factors].sort((a, b) => fy[a] - fy[b]);
  let prev = -Infinity;                                   // forward: enforce lower bound + minGap
  for (const f of order) { fy[f] = Math.max(fy[f], lo, prev + minGap); prev = fy[f]; }
  let next = Infinity;                                    // backward: enforce upper bound + minGap
  for (let i = order.length - 1; i >= 0; i--) { const f = order[i]; fy[f] = Math.min(fy[f], hi, next - minGap); next = fy[f]; }
  return fy;
}

function loadingLine(x1, y1, x2, y2, target) {
  const col = target ? PAL.target : PAL.faint;
  const w = target ? 1.8 : 1;
  const dash = target ? '' : 'stroke-dasharray="4 3"';
  const head = target ? 'ahO' : 'ahG';
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${col}" stroke-width="${w}" ${dash} marker-end="url(#${head})"/>`;
}

function itemRectSVG(x, yTop, name) {
  return `<rect x="${f1(x)}" y="${f1(yTop)}" width="${ITEM_W}" height="${ITEM_H}" rx="6" fill="${PAL.surface}" stroke="${PAL.line}" stroke-width="1.3"/>`
    + `<text x="${f1(x + ITEM_W / 2)}" y="${f1(yTop + ITEM_H / 2 + 4)}" text-anchor="middle" font-family="'Courier Prime','Courier New',monospace" font-size="12" fill="${PAL.ink}">${esc(name)}</text>`;
}

// A factor node = ellipse + label, wrapped in a draggable group (data-factor) the UI can grab.
function factorNodeSVG(fid, cx, cy, rx, ry, text, general) {
  const fill = general ? PAL.gWash : PAL.sWash;
  const stroke = general ? PAL.ochre : PAL.petrol;
  const tcol = general ? PAL.ochreD : '#8A5807';
  return `<g data-factor="${esc(fid)}" data-cx="${f1(cx)}" data-cy="${f1(cy)}" style="cursor:grab;touch-action:none">`
    + `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.7"/>`
    + `<text x="${f1(cx)}" y="${f1(cy + 4)}" text-anchor="middle" font-family="'Familjen Grotesk','Segoe UI',sans-serif" font-weight="600" font-size="13" fill="${tcol}" style="pointer-events:none;user-select:none">${esc(text)}</text></g>`;
}

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Point on an ellipse's boundary in the direction of (tx,ty) — so loading arrows attach cleanly
 *  to a factor wherever it has been dragged, instead of always leaving the same fixed edge. */
function edgePoint(cx, cy, rx, ry, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  const denom = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  if (!denom) return { x: cx + rx, y: cy };
  const t = 1 / denom;
  return { x: cx + dx * t, y: cy + dy * t };
}

function valLabel(x, y, text, color, bold, anchor = 'middle') {
  if (!text) return '';
  const w = text.length * 6.3 + 6;
  const rx = anchor === 'start' ? x - 2 : anchor === 'end' ? x - w + 2 : x - w / 2;
  return `<g><rect x="${f1(rx)}" y="${f1(y - 9)}" width="${f1(w)}" height="13" rx="3" fill="#FFFFFFdd"/>`
    + `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" font-family="'Familjen Grotesk','Segoe UI',sans-serif" font-size="11" font-weight="${bold ? 700 : 500}" fill="${color}">${esc(text)}</text></g>`;
}

function svgWrap(width, height, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${Math.round(height)}" width="${width}" height="${Math.round(height)}" style="max-width:100%;height:auto;font-family:sans-serif">`
    + `<defs>`
    + `<marker id="ahO" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto-start-reverse"><path d="M0,0 L7,3 L0,6 Z" fill="${PAL.target}"/></marker>`
    + `<marker id="ahG" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto-start-reverse"><path d="M0,0 L7,3 L0,6 Z" fill="${PAL.faint}"/></marker>`
    + `<marker id="ahC" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto-start-reverse"><path d="M6,0 L0,3 L6,6" fill="none" stroke="${PAL.petrolL}" stroke-width="1.2"/></marker>`
    + `</defs>${parts.join('')}</svg>`;
}

// ───────────────────────── renderer dispatch ─────────────────────────

/** Order items by their PRIMARY factor (following factor order) so each factor's target arrows
 *  land on a contiguous block and never cross another factor's block — like Morin's Fig. 1,
 *  where items are always grouped by subscale. Purely cosmetic: only the drawing order changes,
 *  never the model, the data, or the syntax. Stable within a block (original order kept);
 *  items with no target factor sink to the bottom. G targets everything, so it is ignored. */
function orderItemsByFactor(model) {
  const specifics = model.factors.filter((f) => f !== model.generalFactor);
  const groupOf = (it) => {
    const i = specifics.findIndex((f) => model.isTarget(f, it) && model.hasPath(f, it));
    return i < 0 ? specifics.length : i;
  };
  return model.items
    .map((it, i) => ({ it, i, g: groupOf(it) }))
    .sort((a, b) => (a.g - b.g) || (a.i - b.i))
    .map((x) => x.it);
}

function renderDiagram(model, opts = {}) {
  const n = (model.items || []).length, k = (model.factors || []).length;
  if (!n || !k) return '<p style="color:#66707B;font-family:sans-serif">No model structure to draw.</p>';
  model = { ...model, items: orderItemsByFactor(model) };
  const bifactor = model.generalFactor && model.factors.includes(model.generalFactor);
  return bifactor ? renderBifactor(model, opts) : renderStandard(model, opts);
}

// ── standard: factors left, items right (Fig. 1a/1b) ──
function renderStandard(model, opts) {
  const { theoretical = false, showCross = true, crossThreshold = 0.10, showResiduals = true, positions = {} } = opts;
  const hidden = new Set(opts.hiddenFactors || []);
  const items = model.items, factors = model.factors.filter((f) => !hidden.has(f));
  const rowGap = 18;
  let { height, ys } = layoutItems(items.length, rowGap);
  ({ height, ys } = fitFactors(height, ys, factors.length));
  const itemY = {}; items.forEach((it, i) => itemY[it] = ys[i]);

  const corrPad = model.corr.length ? 26 : 4;
  const width = opts.width || 660;
  const fcx = MARGIN + FRX + corrPad;          // default factor centre (left column)
  const rightPad = showResiduals ? 46 : 10;
  const itemX = width - rightPad - ITEM_W;      // item left edge (right column)
  const itemRight = itemX + ITEM_W;
  const fy = factorYs(model, items, itemY, factors, height);

  // factor centres: drag override (clamped on-canvas) or the default column position
  const drawn = (f, it) => model.hasPath(f, it) && (theoretical || model.isTarget(f, it) || (showCross && (() => { const v = model.value(f, it); return v == null || Math.abs(v) >= crossThreshold; })()));
  const pos = {}; const attach = {};
  for (const f of factors) {
    const p = positions[f];
    pos[f] = p ? { x: clampN(p.x, FRX, width - FRX), y: clampN(p.y, FRY, height - FRY) } : { x: fcx, y: fy[f] };
    const conn = items.filter((it) => drawn(f, it)); const cy = (conn.length ? conn : items).map((it) => itemY[it]).reduce((a, b) => a + b, 0) / (conn.length || items.length);
    attach[f] = edgePoint(pos[f].x, pos[f].y, FRX, FRY, itemX, cy);     // arrows leave the ellipse edge toward the items
  }

  const parts = [];
  for (const f of factors) for (const it of items) {
    if (!model.hasPath(f, it)) continue;
    const target = model.isTarget(f, it);
    const v = model.value(f, it);
    if (!target && !theoretical && (!showCross || (v != null && Math.abs(v) < crossThreshold))) continue;
    parts.push(loadingLine(attach[f].x, attach[f].y, itemX - 1, itemY[it], target));
    if (!theoretical && v != null) {
      const t = 0.62, lx = attach[f].x + (itemX - attach[f].x) * t, ly = attach[f].y + (itemY[it] - attach[f].y) * t - 4;
      parts.push(valLabel(lx, ly, fnum(v), target ? PAL.ink : PAL.faint, target));
    }
  }
  // factor correlations — a curved double-headed arrow between the two factor ellipses
  const seen = new Set();
  for (const c of model.corr) {
    if (!factors.includes(c.a) || !factors.includes(c.b)) continue;
    const key = [c.a, c.b].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    if (c.est != null && Math.abs(c.est) < 0.001) continue;
    const A = pos[c.a], B = pos[c.b];
    const e1 = edgePoint(A.x, A.y, FRX, FRY, B.x, B.y), e2 = edgePoint(B.x, B.y, FRX, FRY, A.x, A.y);
    const mx = (e1.x + e2.x) / 2, my = (e1.y + e2.y) / 2;
    const dx = e2.x - e1.x, dy = e2.y - e1.y, len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len; if (nx > 0) { nx = -nx; ny = -ny; }   // bulge to the left, away from items
    const b = 16 + Math.min(34, len * 0.18), ctrlx = mx + nx * b, ctrly = my + ny * b;
    parts.push(`<path d="M ${f1(e1.x)} ${f1(e1.y)} Q ${f1(ctrlx)} ${f1(ctrly)} ${f1(e2.x)} ${f1(e2.y)}" fill="none" stroke="${PAL.petrolL}" stroke-width="1.3" marker-start="url(#ahC)" marker-end="url(#ahC)"/>`);
    if (!theoretical && c.est != null) parts.push(valLabel(ctrlx + nx * 9, ctrly + ny * 9, fnum(c.est), PAL.petrol, false, 'middle'));
  }
  // residual (δ) stubs on the far right, arrow into item
  if (showResiduals) for (const it of items) {
    const y = itemY[it], outer = itemRight + rightPad - 8;
    parts.push(`<circle cx="${f1(outer + 4)}" cy="${f1(y)}" r="2.6" fill="none" stroke="${PAL.line}" stroke-width="1.1"/>`);
    parts.push(`<line x1="${f1(outer)}" y1="${f1(y)}" x2="${f1(itemRight + 1)}" y2="${f1(y)}" stroke="${PAL.line}" stroke-width="1.1" marker-end="url(#ahG)"/>`);
    if (!theoretical) { const d = model.delta(it); if (d != null) parts.push(valLabel(itemRight + 5, y - 5, fnum(d), PAL.faint, false, 'start')); }
  }
  // nodes
  for (const it of items) parts.push(itemRectSVG(itemX, itemY[it] - ITEM_H / 2, it));
  for (const f of factors) parts.push(factorNodeSVG(f, pos[f].x, pos[f].y, FRX, FRY, model.label(f), false));
  return svgWrap(width, height, parts);
}

// ── bifactor: specific factors left, items centre, global factor right (Fig. 1e/1f) ──
function renderBifactor(model, opts) {
  const { theoretical = false, showCross = true, crossThreshold = 0.10, positions = {} } = opts;
  const hidden = new Set(opts.hiddenFactors || []);
  const items = model.items;
  const g = model.generalFactor;
  const gVisible = !hidden.has(g);
  const specifics = model.factors.filter((f) => f !== g && !hidden.has(f));
  const rowGap = 16, gRx = 52, gRy = 36;
  let { height, ys } = layoutItems(items.length, rowGap);
  ({ height, ys } = fitFactors(height, ys, specifics.length));
  const itemY = {}; items.forEach((it, i) => itemY[it] = ys[i]);

  const width = opts.width || 800;
  const fcxL = MARGIN + FRX + 4;                 // default specific-factor column (left)
  const itemX = Math.round(width / 2 - ITEM_W / 2); // items centred
  const itemRight = itemX + ITEM_W;
  const gcxDefault = width - MARGIN - gRx;        // default global-factor column (right)
  const gcyDefault = ys.reduce((a, b) => a + b, 0) / items.length;
  const fy = factorYs(model, items, itemY, specifics, height);

  const drawn = (f, it) => model.hasPath(f, it) && (theoretical || model.isTarget(f, it) || (showCross && (() => { const v = model.value(f, it); return v == null || Math.abs(v) >= crossThreshold; })()));
  const pos = {}; const attach = {};
  for (const f of specifics) {
    const p = positions[f];
    pos[f] = p ? { x: clampN(p.x, FRX, width - FRX), y: clampN(p.y, FRY, height - FRY) } : { x: fcxL, y: fy[f] };
    const conn = items.filter((it) => drawn(f, it)); const cy = (conn.length ? conn : items).map((it) => itemY[it]).reduce((a, b) => a + b, 0) / (conn.length || items.length);
    attach[f] = edgePoint(pos[f].x, pos[f].y, FRX, FRY, itemX, cy);
  }
  const gp0 = positions[g];
  const gp = gp0 ? { x: clampN(gp0.x, gRx, width - gRx), y: clampN(gp0.y, gRy, height - gRy) } : { x: gcxDefault, y: gcyDefault };
  const gAttach = edgePoint(gp.x, gp.y, gRx, gRy, itemRight, gcyDefault);

  const parts = [];
  // specific → item (left side)
  for (const f of specifics) for (const it of items) {
    if (!model.hasPath(f, it)) continue;
    const target = model.isTarget(f, it);
    const v = model.value(f, it);
    if (!target && !theoretical && (!showCross || (v != null && Math.abs(v) < crossThreshold))) continue;
    parts.push(loadingLine(attach[f].x, attach[f].y, itemX - 1, itemY[it], target));
    if (!theoretical && v != null) {
      const t = 0.6, lx = attach[f].x + (itemX - attach[f].x) * t, ly = attach[f].y + (itemY[it] - attach[f].y) * t - 4;
      parts.push(valLabel(lx, ly, fnum(v), target ? PAL.ink : PAL.faint, target));
    }
  }
  // global → item (right side)
  if (gVisible) for (const it of items) {
    if (!model.hasPath(g, it)) continue;
    const v = model.value(g, it);
    parts.push(loadingLine(gAttach.x, gAttach.y, itemRight + 1, itemY[it], true));
    if (!theoretical && v != null) {
      const t = 0.58, lx = gAttach.x + (itemRight - gAttach.x) * t, ly = gAttach.y + (itemY[it] - gAttach.y) * t - 4;
      parts.push(valLabel(lx, ly, fnum(v), PAL.ink, true));
    }
  }
  // nodes
  for (const it of items) parts.push(itemRectSVG(itemX, itemY[it] - ITEM_H / 2, it));
  for (const f of specifics) parts.push(factorNodeSVG(f, pos[f].x, pos[f].y, FRX, FRY, model.label(f), false));
  if (gVisible) parts.push(factorNodeSVG(g, gp.x, gp.y, gRx, gRy, model.label(g), true));
  return svgWrap(width, height, parts);
}
