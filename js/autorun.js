// autorun.js — working-folder "auto mode": the browser writes the generated .inp set + data +
// RUN-ALL scripts into a user-picked local folder (File System Access API, Chromium desktop
// only), then watches that folder and imports each .out as Mplus finishes writing it.
// Everything stays on the user's machine — no uploads, ever.
import { hasEndingMarker } from './run-scripts.js';

export const supportsFolderMode = () => 'showDirectoryPicker' in window;

// ---- tiny IndexedDB KV (directory handles are structured-cloneable) ----
const DB = 'esem-toolkit', STORE = 'kv', KEY = 'workdirHandle';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
}

export async function pickWorkFolder() {
  const h = await window.showDirectoryPicker({ id: 'esem-workdir', mode: 'readwrite' });
  try { await idbSet(KEY, h); } catch { /* persistence is best-effort */ }
  return h;
}

/** Stored handle from a previous session (or null). state 'granted' | 'prompt' — a 'prompt'
 *  handle needs reRequestPermission() from inside a click gesture before use. */
export async function restoreWorkFolder() {
  try {
    const h = await idbGet(KEY);
    if (!h) return null;
    return { handle: h, state: await h.queryPermission({ mode: 'readwrite' }) };
  } catch { return null; }
}

export async function reRequestPermission(handle) {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeRunSet(handle, files) {
  for (const f of files) {
    const fh = await handle.getFileHandle(f.name, { create: true });
    const w = await fh.createWritable();
    await w.write(f.text);
    await w.close();
  }
}

/** Remove leftovers of a previous run so the watcher can't import stale results. */
export async function clearStaleOuts(handle, outNames) {
  for (const n of outNames) { try { await handle.removeEntry(n); } catch { /* not there — fine */ } }
}

/** Poll the folder for the expected .out files. expected: [{ key, label, inp, out }].
 *  Per-model states: pending → running (file appeared) → imported (footer written or size
 *  stable across two polls). Extra tick on tab focus/visibility — Chrome throttles interval
 *  timers hard in background tabs. Returns { stop }. */
export function watchForOuts(handle, expected, { onStatus = () => {}, onOut = () => {}, onDone = () => {}, onError = () => {} } = {}) {
  const runStart = Date.now();
  const st = new Map(expected.map((m) => [m.out, { model: m, state: 'pending', lastSize: -1 }]));
  let busy = false, stopped = false, iv = null;

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const s of st.values()) {
        if (s.state === 'imported') continue;
        let file;
        try {
          const fh = await handle.getFileHandle(s.model.out);
          file = await fh.getFile();
        } catch (e) {
          if (e && e.name === 'NotAllowedError') throw e;
          continue; // NotFoundError → still pending
        }
        if (file.lastModified < runStart - 2000) continue; // stale from an earlier run
        if (s.state === 'pending') { s.state = 'running'; onStatus(s.model, 'running'); }
        const text = await file.text();
        const ready = hasEndingMarker(text) || (file.size > 0 && file.size === s.lastSize);
        s.lastSize = file.size;
        if (!ready) continue;
        s.state = 'imported';
        onOut(s.model, text);
        onStatus(s.model, 'imported');
      }
      if ([...st.values()].every((s) => s.state === 'imported')) { stop(); onDone(); }
    } catch (e) {
      stop();
      onError(e && e.name === 'NotAllowedError' ? 'permission' : (e && e.message) || 'error');
    } finally {
      busy = false;
    }
  };

  const onWake = () => { if (document.visibilityState === 'visible') tick(); };
  function stop() {
    if (stopped) return;
    stopped = true;
    if (iv) clearInterval(iv);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
  }
  iv = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  tick();
  return { stop };
}
