// runner.js — the browser side of the local Mplus runner (serve.mjs / ESEM-Analyzer.exe): Mplus
// detection, runs in a folder on this computer, live job events over Server-Sent Events.
// Two ways to reach it: same origin (the page is served by the runner) or, from the published page,
// a runner on localhost that the user connects to explicitly (`runner.connect()`); that choice is
// remembered. Without any runner `state.server` is false and the app falls back to download / upload.

const PORTS = [3001, 3002, 3003, 3004, 3005];
const REMEMBER = 'ss-runner';

const state = {
  server: null,        // null = checking · true = a runner answered · false = none (static hosting)
  remote: false,       // true when the runner is a separate localhost origin (connected from the published page)
  base: '',            // '' for same origin, else e.g. http://localhost:3001
  health: null,        // { mplus: { ok, path, version, error, checked }, cpus, runsDir }
  jobs: new Map(),     // job id → { id, run, name, out, status, queuedAt, startedAt, endedAt, tail, error }
};
const listeners = new Set();
const emit = (type, job, prev) => { for (const fn of listeners) { try { fn(type, job, prev); } catch (e) { console.error(e); } } };

async function api(path, { method = 'GET', json, text = false, base = state.base, timeout = 0 } = {}) {
  const res = await fetch(base + '/api' + path, {
    method, headers: json ? { 'Content-Type': 'application/json' } : undefined, body: json ? JSON.stringify(json) : undefined,
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    // from the published (https) page the runner is a loopback address: say so, as the local-network rules ask
    ...(base ? { targetAddressSpace: 'loopback' } : {}),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); if (b && b.error) msg = b.error; } catch { /* keep the status text */ }
    throw new Error(msg);
  }
  return text ? res.text() : res.json();
}
// a health answer must look like ours (a static host returns its own 404/HTML page instead)
async function probe(base) {
  const h = await api('/health', { base, timeout: 2500 });
  if (!h || !h.mplus) throw new Error('not a runner');
  return h;
}

function onJob(job) {
  const prev = state.jobs.get(job.id) || null;
  state.jobs.set(job.id, job);
  emit('job', job, prev);
}

let es = null, recheckT = null, pollT = null;
function connectEvents() {
  if (es) return;
  es = new EventSource(state.base + '/api/events');
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'hello') m.jobs.forEach(onJob);
    else if (m.type === 'job') onJob(m.job);
  };
  es.onerror = () => { /* the browser reconnects on its own; a vanished remote runner is caught by the poll */ };
}
function closeEvents() { if (es) { es.close(); es = null; } clearTimeout(recheckT); clearInterval(pollT); recheckT = pollT = null; }

// Mplus detection runs a probe model at the runner's start-up; ask again until it has an answer
function recheckUntilReady() {
  let tries = 0;
  const again = async () => {
    if (!state.server || runner.ok() || (state.health && state.health.mplus.checked) || ++tries > 12) return;
    try { state.health = await api('/health'); emit('health'); } catch { /* ignore */ }
    recheckT = setTimeout(again, 2500);
  };
  recheckT = setTimeout(again, 2500);
}
// a remote runner can be closed at any time: notice it and fall back
function pollRemote() {
  pollT = setInterval(async () => {
    try { state.health = await api('/health', { timeout: 2500 }); }
    catch { runner.disconnect(true); }
  }, 8000);
}
function attach(base, health, remote) {
  state.base = base; state.health = health; state.server = true; state.remote = remote;
  connectEvents();
  if (!runner.ok() && !(health.mplus && health.mplus.checked)) recheckUntilReady();
  if (remote) pollRemote();
}

const ACTIVE = new Set(['queued', 'running']);

export const runner = {
  state,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Mplus is installed and licensed on the runner's computer. */
  ok: () => !!(state.health && state.health.mplus && state.health.mplus.ok),
  /** A job is queued or running. */
  active: () => [...state.jobs.values()].some((j) => ACTIVE.has(j.status)),
  /** The latest job for an input file in a run. */
  jobFor(runId, name) {
    return [...state.jobs.values()].filter((j) => j.run === runId && j.name === name).sort((a, b) => b.queuedAt - a.queuedAt)[0] || null;
  },
  jobsOf(runId) { return [...state.jobs.values()].filter((j) => j.run === runId); },
  /** Same-origin runner first; otherwise a remembered localhost connection; otherwise none. */
  async init() {
    try { attach('', await probe(''), false); }
    catch {
      state.server = false;
      let remembered = false;
      try { remembered = localStorage.getItem(REMEMBER) === 'on'; } catch { /* storage may be unavailable */ }
      if (remembered) await runner.connect({ quiet: true });
    }
    emit('health');
  },
  /** From the published page: look for ESEM-Analyzer.exe / node serve.mjs on localhost and use it. */
  async connect({ quiet = false } = {}) {
    if (state.server && state.remote) return true;
    for (const p of PORTS) {
      const base = `http://localhost:${p}`;
      try {
        const h = await probe(base);
        attach(base, h, true);
        try { localStorage.setItem(REMEMBER, 'on'); } catch { /* ignore */ }
        if (!quiet) emit('health');
        return true;
      } catch { /* try the next port */ }
    }
    return false;
  },
  /** Forget the remote runner (it was closed, or the user asked). */
  disconnect(lost = false) {
    if (!state.remote) return;
    closeEvents();
    state.server = false; state.remote = false; state.base = ''; state.health = null; state.jobs.clear();
    if (!lost) { try { localStorage.removeItem(REMEMBER); } catch { /* ignore */ } }
    emit('health', lost ? 'lost' : null);
  },
  /** New run folder: writes the files and queues the listed .inp files in order. */
  async start({ label, files, run }) {
    const r = await api('/runs', { method: 'POST', json: { label, files, run } });
    r.jobs.forEach(onJob);
    return r;
  },
  /** Adds files to an existing run folder and queues more models there. */
  async runMore(runId, { files = [], run }) {
    const r = await api(`/runs/${encodeURIComponent(runId)}/run`, { method: 'POST', json: { files, run } });
    r.jobs.forEach(onJob);
    return r;
  },
  fileText: (runId, name) => api(`/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`, { text: true }),
  cancel: (jobId) => api(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),
};
