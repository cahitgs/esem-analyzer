// shoot.mjs — CDP screenshotter that WAITS for content before capturing (no puppeteer dep).
// Unlike `--screenshot`, this connects over the DevTools protocol, waits for a CSS selector
// (or a timeout), then captures the full page height. Fixes the async-render / stale-paint race.
//
// Usage: node shoot.mjs <url> [label] [width] [waitSelector] [extraWaitMs]
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const url   = process.argv[2] || 'http://localhost:3001';
const label = process.argv[3] || '';
const width = parseInt(process.argv[4] || '1400', 10);
const waitSel = process.argv[5] || '';
const extraWait = parseInt(process.argv[6] || '500', 10);
const evalBefore = process.argv[7] || '';
const scale = Number(process.env.SCALE || 2);
const PORT = 9333 + Math.floor((Date.now() / 1000) % 400);

function findChrome() {
  const base = join(process.env.USERPROFILE || process.env.HOME, '.cache', 'puppeteer', 'chrome');
  const ver = d => (d.match(/win64-(.+)$/)?.[1] || '0').split('.').map(Number);
  const cmp = (a, b) => { const A = ver(a), B = ver(b); for (let i = 0; i < Math.max(A.length, B.length); i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0); } return 0; };
  const dirs = readdirSync(base).filter(d => d.startsWith('win64-')).sort(cmp);
  return join(base, dirs[dirs.length - 1], 'chrome-win64', 'chrome.exe');
}

const outDir = join(ROOT, 'temporary screenshots');
mkdirSync(outDir, { recursive: true });
let n = 1;
for (const f of readdirSync(outDir)) { const m = f.match(/^screenshot-(\d+)/); if (m) n = Math.max(n, parseInt(m[1], 10) + 1); }
const out = join(outDir, `screenshot-${n}${label ? '-' + label : ''}.png`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--hide-scrollbars',
  `--user-data-dir=${join(tmpdir(), 'ss-cdp-' + PORT)}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try { const j = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(150);
  }
  throw new Error('CDP not reachable');
}

function cdp(ws) {
  let id = 0; const pend = new Map(); const evs = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { send };
}

(async () => {
  const browserWs = await getWs();
  const bws = new WebSocket(browserWs);
  await new Promise(r => bws.addEventListener('open', r, { once: true }));
  const b = cdp(bws);
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  // route session messages on same socket
  const s = { send: (method, params = {}) => b.send(method, params, sessionId) };
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: scale, mobile: false });
  await s.send('Page.navigate', { url });
  await sleep(700);
  // wait for selector (or readiness)
  const expr = waitSel
    ? `!!document.querySelector(${JSON.stringify(waitSel)})`
    : `document.readyState === 'complete'`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result && r.result.value) { ready = true; break; }
    await sleep(150);
  }
  if (evalBefore) { await s.send('Runtime.evaluate', { expression: evalBefore }); await sleep(300); }
  await sleep(extraWait);
  const dim = await s.send('Runtime.evaluate', { expression: `({w: Math.max(document.documentElement.scrollWidth, ${width}), h: document.documentElement.scrollHeight})`, returnByValue: true });
  const { w, h } = dim.result.value;
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(h, 20000), deviceScaleFactor: scale, mobile: false });
  await sleep(200);
  const shot = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 20000), scale: 1 } });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`OK -> ${out} (${w}x${h}, ready=${ready})`);
  bws.close(); chrome.kill();
  process.exit(0);
})().catch(e => { console.error('shoot failed:', e.message); chrome.kill(); process.exit(1); });
