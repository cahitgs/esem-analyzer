// serve.mjs — local server for "ESEM Analyzer": serves the app and, when Mplus is installed on
// this computer, runs the generated models here so nothing has to be downloaded or uploaded.
//   node serve.mjs              → http://localhost:3001   (PORT=… or a port argument changes it)
//   node serve.mjs --open       → also opens the browser
//   MPLUS_PATH=...\Mplus.exe    → Mplus location if it is not under Program Files
//   MPLUS_RUNS=...              → where run folders are written (default ./mplus-runs)
// Runs live in ./mplus-runs/<stamp>-<data>/ (the .inp files, the data file and the .out files).
// No external dependencies. The server listens on the loopback address only.
// Packaged as a single executable (tools/build-exe.mjs) this same file runs inside ESEM-Analyzer.exe:
// the app is served from embedded assets, runs are written next to the exe, the browser opens itself.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Inside the single-executable build the entry sets globalThis.__SEA__ = { assets: Map<path, () => Buffer> }
const SEA = globalThis.__SEA__ || null;
const ROOT = SEA ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.resolve(process.env.MPLUS_RUNS || path.join(ROOT, 'mplus-runs'));
const argPort = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const PREFERRED_PORT = Number(process.env.PORT || argPort || 3001);
const OPEN = process.argv.includes('--open') || (!!SEA && !process.argv.includes('--no-open'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.dat': 'text/plain; charset=utf-8', '.out': 'text/plain; charset=utf-8', '.inp': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const FILE_EXT = new Set(['.inp', '.out', '.dat', '.csv', '.txt']);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

// ---------------- Mplus detection ----------------
const mplus = { path: null, version: null, ok: false, error: null, checked: false };

function candidatePaths() {
  const list = [];
  if (process.env.MPLUS_PATH) list.push(process.env.MPLUS_PATH);
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) list.push(path.join(base, 'Mplus', 'Mplus.exe'));
    }
  } else {
    list.push('/Applications/Mplus/mplus', '/opt/mplus/mplus', '/usr/local/bin/mplus');
  }
  return [...new Set(list)];
}

async function detectMplus() {
  for (const p of candidatePaths()) if (fss.existsSync(p)) { mplus.path = p; break; }
  if (!mplus.path) { mplus.error = 'Mplus was not found. Set the path to Mplus.exe with the MPLUS_PATH environment variable.'; mplus.checked = true; return; }
  // a tiny probe model confirms the licence and reads the version from its output
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-structure-'));
  try {
    await fs.writeFile(path.join(dir, 'p.dat'), '1 2\n2 1\n3 4\n4 3\n5 5\n');
    await fs.writeFile(path.join(dir, 'p.inp'), 'TITLE: probe;\nDATA: FILE = p.dat;\nVARIABLE: NAMES = a b;\nANALYSIS: TYPE = BASIC;\n');
    await new Promise((resolve) => execFile(mplus.path, ['p.inp', 'p.out'], { cwd: dir, timeout: 30000, windowsHide: true }, () => resolve()));
    const out = await fs.readFile(path.join(dir, 'p.out'), 'utf8').catch(() => '');
    const m = out.match(/Mplus VERSION ([\d.]+)( DEMO)?/);
    if (m) { mplus.version = m[1] + (m[2] ? ' (DEMO)' : ''); mplus.ok = true; }
    else mplus.error = 'Mplus could not be run (possibly a licence or installation problem).';
  } finally {
    mplus.checked = true;
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------- job queue (one Mplus process at a time: invariance steps chain DIFFTEST files) ----------------
const jobs = new Map(); // id → job
const queue = [];
let running = 0;
const CONCURRENCY = 1;
const clients = new Set();
let jobSeq = 0;

const publicJob = (j) => ({ id: j.id, run: j.run, name: j.name, out: j.out, status: j.status, queuedAt: j.queuedAt, startedAt: j.startedAt, endedAt: j.endedAt, exitCode: j.exitCode, tail: j.tail.slice(-12), error: j.error });
function broadcast(evt) { const data = `data: ${JSON.stringify(evt)}\n\n`; for (const res of clients) res.write(data); }
const emitJob = (j) => broadcast({ type: 'job', job: publicJob(j) });

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const j = queue.shift();
    if (j.status !== 'queued') continue;
    startJob(j);
  }
}

async function startJob(j) {
  running++;
  j.status = 'running';
  j.startedAt = Date.now();
  emitJob(j);
  const dir = path.join(RUNS, j.run);
  await fs.rm(path.join(dir, j.out), { force: true }).catch(() => {});
  let child;
  try {
    child = spawn(mplus.path, [j.name, j.out], { cwd: dir, windowsHide: true });
  } catch (e) {
    finish(j, 'error', -1, String(e.message || e));
    return;
  }
  j.child = child;
  let buf = '', lastEmit = 0;
  const onData = (chunk) => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const p of parts) if (p.trim()) { j.tail.push(p.trimEnd()); if (j.tail.length > 60) j.tail.shift(); }
    const now = Date.now();
    if (now - lastEmit > 700) { lastEmit = now; emitJob(j); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => finish(j, 'error', -1, String(e.message || e)));
  child.on('close', (code) => {
    if (j.status === 'cancelled') return finish(j, 'cancelled', code);
    const has = fss.existsSync(path.join(dir, j.out));
    finish(j, has ? 'done' : 'error', code, has ? null : 'Mplus did not produce an output file.');
  });
}

function finish(j, status, code, error) {
  if (j.endedAt) return;
  j.status = status; j.exitCode = code; j.endedAt = Date.now();
  if (error) j.error = error;
  j.child = null;
  running = Math.max(0, running - 1);
  emitJob(j);
  pump();
}

function cancelJob(j) {
  if (j.status === 'queued') { j.status = 'cancelled'; j.endedAt = Date.now(); emitJob(j); return; }
  if (j.status !== 'running' || !j.child) return;
  j.status = 'cancelled';
  const pid = j.child.pid;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else j.child.kill('SIGTERM');
}

// ---------------- CORS: the published page may use this runner on localhost as its engine ----------------
// Allowed: the GitHub Pages origin (or ALLOW_ORIGINS=a,b) and any localhost origin. Same-origin needs nothing.
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS ? process.env.ALLOW_ORIGINS.split(',') : ['https://cahitgs.github.io']).map((s) => s.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const ok = ALLOW_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600',
  };
}

// ---------------- helpers ----------------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(res.cors || {}) });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readBody(req, limit = 200 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('The request body is too large.'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
function checkFile(name) {
  if (!FILE_RE.test(name) || !FILE_EXT.has(path.extname(name).toLowerCase())) throw fail(`Invalid file name: ${name}`);
  return name;
}
function runDir(id) {
  if (!ID_RE.test(id)) throw fail('Invalid run id.');
  const dir = path.join(RUNS, id);
  if (!fss.existsSync(dir)) throw fail('Run not found.', 404);
  return dir;
}
const slug = (s) => String(s || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'run';
function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

async function writeFiles(dir, files) {
  for (const f of files || []) {
    checkFile(f.name);
    await fs.writeFile(path.join(dir, f.name), String(f.text ?? ''), 'utf8');
  }
}
function queueModels(id, dir, names) {
  const created = [];
  for (const name of names || []) {
    checkFile(name);
    if (path.extname(name).toLowerCase() !== '.inp' || !fss.existsSync(path.join(dir, name))) continue;
    const dup = [...jobs.values()].find((x) => x.run === id && x.name === name && (x.status === 'queued' || x.status === 'running'));
    if (dup) { created.push(publicJob(dup)); continue; }
    const j = { id: `j${++jobSeq}`, run: id, name, out: name.replace(/\.inp$/i, '.out'), status: 'queued', queuedAt: Date.now(), startedAt: null, endedAt: null, exitCode: null, tail: [], child: null, error: null };
    jobs.set(j.id, j);
    queue.push(j);
    created.push(publicJob(j));
    emitJob(j);
  }
  pump();
  return created;
}

// ---------------- API ----------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const method = req.method;
  res.cors = corsHeaders(req);
  if (method === 'OPTIONS') { res.writeHead(204, res.cors); return res.end(); }

  if (parts[0] === 'health') {
    return send(res, 200, { mplus: { path: mplus.path, version: mplus.version, ok: mplus.ok, error: mplus.error, checked: mplus.checked }, cpus: os.cpus().length, platform: process.platform, runsDir: RUNS });
  }
  if (parts[0] === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...res.cors });
    res.write(`data: ${JSON.stringify({ type: 'hello', jobs: [...jobs.values()].map(publicJob) })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (parts[0] === 'jobs') {
    if (parts.length === 1) return send(res, 200, [...jobs.values()].map(publicJob));
    const j = jobs.get(parts[1]);
    if (!j) return send(res, 404, { error: 'Job not found.' });
    if (parts[2] === 'cancel' && method === 'POST') { cancelJob(j); return send(res, 200, publicJob(j)); }
    return send(res, 200, publicJob(j));
  }
  if (parts[0] === 'runs') {
    if (parts.length === 1 && method === 'POST') {
      if (!mplus.ok) return send(res, 409, { error: mplus.error || 'Mplus is not ready yet.' });
      const body = JSON.parse(await readBody(req) || '{}');
      await fs.mkdir(RUNS, { recursive: true });
      let id = `${stamp()}-${slug(body.label)}`, n = 2;
      while (fss.existsSync(path.join(RUNS, id))) id = `${stamp()}-${slug(body.label)}-${n++}`;
      const dir = path.join(RUNS, id);
      await fs.mkdir(dir, { recursive: true });
      await writeFiles(dir, body.files);
      return send(res, 201, { id, dir, jobs: queueModels(id, dir, body.run) });
    }
    const id = parts[1];
    const dir = runDir(id);
    if (parts[2] === 'run' && method === 'POST') {
      if (!mplus.ok) return send(res, 409, { error: mplus.error || 'Mplus is not ready yet.' });
      const body = JSON.parse(await readBody(req) || '{}');
      await writeFiles(dir, body.files);
      return send(res, 200, { id, dir, jobs: queueModels(id, dir, body.run) });
    }
    if (parts[2] === 'files') {
      if (parts.length === 3) {
        const files = [];
        for (const f of await fs.readdir(dir)) {
          if (!FILE_EXT.has(path.extname(f).toLowerCase())) continue;
          const st = await fs.stat(path.join(dir, f));
          files.push({ name: f, size: st.size, mtime: st.mtimeMs });
        }
        return send(res, 200, files);
      }
      const name = checkFile(parts[3]);
      if (method === 'GET') {
        const txt = await fs.readFile(path.join(dir, name)).catch(() => null);
        return txt ? send(res, 200, txt, MIME[path.extname(name).toLowerCase()] || 'text/plain; charset=utf-8') : send(res, 404, { error: 'File not found.' });
      }
    }
    return send(res, 200, { id, dir });
  }
  return send(res, 404, { error: 'Unknown endpoint.' });
}

// ---------------- static files (+ the dev-only /save helper used by the export self-test) ----------------
async function serveStatic(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name');
    if (!name || !/^[\w.\-]+$/.test(name)) return send(res, 400, 'bad name', 'text/plain');
    await fs.writeFile(path.join(ROOT, name), Buffer.from(await readBody(req), 'utf8'));
    res.setHeader('Access-Control-Allow-Origin', '*');
    return send(res, 200, 'saved', 'text/plain');
  }
  let urlPath = decodeURIComponent(url.pathname);
  if (urlPath === '/') urlPath = '/index.html';
  if (SEA) {
    const key = urlPath.replace(/^\/+/, '');
    const get = SEA.assets.get(key);
    if (!get) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(key).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return res.end(get());
  }
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
  const info = await fs.stat(filePath).catch(() => null);
  if (!info || !info.isFile()) return send(res, 404, 'Not found', 'text/plain');
  const data = await fs.readFile(filePath);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    send(res, e.status || 500, { error: String(e.message || e) });
  }
}

// Is the port free on the loopback address? (another app may already own it)
function portFree(port) {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
async function pickPort(start) {
  for (let p = start; p < start + 30; p++) if (await portFree(p)) return p;
  throw new Error(`No free port between ${start} and ${start + 29}.`);
}

async function main() {
  const PORT = await pickPort(PREFERRED_PORT);
  if (PORT !== PREFERRED_PORT) console.log(`  Note: port ${PREFERRED_PORT} is busy; using ${PORT}.`);
  detectMplus().then(() => {
    console.log(mplus.ok ? `  Mplus ${mplus.version} → ${mplus.path}` : `  Note: ${mplus.error}`);
  });
  const server = http.createServer(handler);
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    if (SEA) {
      console.log('');
      console.log('  ESEM Analyzer — Mplus runner');
      console.log(`  The app opens in your browser at ${url} (open that address yourself if it did not).`);
      console.log('  Leave this window open: it runs Mplus for the app. There is nothing to type here.');
      console.log('  Close this window to stop the runner.');
      console.log('');
    } else {
      console.log(`ESEM Analyzer -> ${url}  (Ctrl+C to stop)`);
    }
    if (OPEN) {
      if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
      else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
    }
  });
  const server6 = http.createServer(handler);
  server6.on('error', () => { /* IPv4 only when there is no IPv6 loopback */ });
  server6.listen(PORT, '::1');
}
main().catch((e) => { console.error(String(e.message || e)); process.exitCode = 1; });
