// ui.js — shared DOM helpers, toast, element builder, number/format utilities.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny hyperscript: el('div', {class:'x', onclick:fn}, [children|string]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
export function toast(message, kind = '') {
  const host = $('#toast-host');
  if (!host) return;
  const node = el('div', { class: `toast ${kind}`.trim() }, message);
  host.append(node);
  clearTimeout(toastTimer);
  setTimeout(() => { node.style.transition = 'opacity .3s, transform .3s'; node.style.opacity = '0'; node.style.transform = 'translateY(8px)'; setTimeout(() => node.remove(), 320); }, 2600);
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** APA number: strip leading zero for |x|<1, fixed decimals. */
export function apaNum(x, dp = 2, stripZero = true) {
  if (x == null || Number.isNaN(x)) return '—';
  let s = Number(x).toFixed(dp);
  if (stripZero && Math.abs(Number(x)) < 1) s = s.replace(/^(-?)0\./, '$1.');
  return s;
}

/** APA p-value: '< .001' below threshold, else '= .0xx'. Returns just the number part. */
export function apaP(p) {
  if (p == null || Number.isNaN(p)) return '—';
  if (p < 0.001) return '< .001';
  return '= ' + apaNum(p, 3);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** Rasterize an SVG string to a PNG and download it (white background, 2× scale). */
export function downloadSvgAsPng(svgString, filename, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const w = img.width || 600, h = img.height || 360;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    canvas.toBlob((b) => { if (b) downloadBlob(b, filename); URL.revokeObjectURL(url); }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not render PNG', 'err'); };
  img.src = url;
}
