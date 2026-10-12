// autorun-ui.js — "Run in Mplus — auto mode" card on the Syntax step. Writes the generated
// file set into a user-picked working folder, tells the user to double-click RUN-ALL.bat,
// and imports the .out files live as Mplus finishes them (js/autorun.js does the watching).
import { el, toast, downloadText } from './ui.js';
import { supportsFolderMode, pickWorkFolder, restoreWorkFolder, reRequestPermission, writeRunSet, clearStaleOuts, watchForOuts } from './autorun.js';
import { buildRunAllBat, buildRunAllSh, expectedOutName } from './run-scripts.js';
import { card, callout, btn } from './shell.js';

// One watch survives step navigation (renderSyntaxStep rebuilds this card on every visit);
// module-level state lets a re-rendered card re-attach to the live run.
let active = null; // { handle, watcher, statuses: Map<key,state>, expected, folderName, done }

/** True while a folder watch is running (the progress track shows the step as "Mplus running"). */
export const autoRunActive = () => !!(active && !active.done);
const announce = () => document.dispatchEvent(new CustomEvent('autorun:sync'));

export function renderAutoRunCard(host, ctx) {
  const n = ctx.n ?? null;
  if (!supportsFolderMode()) {
    host.append(card(n, 'Run in Mplus — auto mode', 'Chrome or Edge on desktop only', [
      el('p', { class: 'small muted', style: { margin: '0' } }, 'Needs Chrome or Edge on desktop (File System Access API). In this browser, use the download buttons above — everything else works the same.'),
    ]));
    return;
  }

  const intro = el('p', { class: 'small', style: { color: 'var(--ink-2)', margin: '0' } }, [
    'Pick a working folder: the app writes every .inp, the Mplus-ready data file, and a ',
    el('code', {}, 'RUN-ALL.bat'),
    ' there. Double-click that file once — results fill in automatically as each model finishes. Nothing is uploaded; the folder is on this computer.',
  ]);
  const dyn = el('div');
  host.append(card(n, 'Run in Mplus — auto mode', 'Write the files, run them, watch the outputs arrive', [intro, dyn]));

  let handle = active?.handle || null;
  let needsPermission = false;
  const expected = ctx.models.map((m) => ({ key: m.key, label: m.label, inp: m.file, out: expectedOutName(m.file) }));

  const stateLabel = { pending: 'waiting for .out', running: 'Mplus writing…', imported: 'imported ✓' };
  function statusRows() {
    const box = el('div', { class: 'flex flex-col gap-1.5 mt-3' });
    for (const m of active.expected) {
      const s = active.statuses.get(m.key) || 'pending';
      box.append(el('div', { class: 'flex items-center gap-2.5 small' }, [
        el('span', { class: `run-dot ${s}` }),
        el('span', { class: 'flex-1', style: { color: 'var(--ink)' } }, m.label),
        el('span', { class: 'mono', style: { fontSize: '13px', color: s === 'imported' ? 'var(--ok)' : 'var(--ink-3)' } }, stateLabel[s] || s),
      ]));
    }
    return box;
  }

  async function startRun() {
    try {
      if (!handle) { handle = await pickWorkFolder(); needsPermission = false; }
      else if (needsPermission) {
        if (!(await reRequestPermission(handle))) { toast('Folder permission denied', 'err'); return; }
        needsPermission = false;
      }
      const files = ctx.buildFiles();
      const inpNames = files.filter((f) => /\.inp$/i.test(f.name)).map((f) => f.name);
      await clearStaleOuts(handle, expected.map((e) => e.out));
      await writeRunSet(handle, files);
      const scripts = [
        { name: 'RUN-ALL.bat', text: buildRunAllBat(inpNames) },
        { name: 'run-all.sh', text: buildRunAllSh(inpNames) },
      ];
      try { await writeRunSet(handle, scripts); }
      catch { // script writes can be blocked by browser/enterprise policy — hand them over as downloads
        for (const s of scripts) downloadText(s.text, s.name, 'text/plain');
        toast('Could not write RUN-ALL scripts into the folder — downloaded instead; move them next to the .inp files', 'err');
      }
      active = { handle, statuses: new Map(expected.map((e) => [e.key, 'pending'])), expected, folderName: handle.name, watcher: null, done: false };
      active.watcher = watchForOuts(handle, expected, {
        onStatus: (m, s) => { active.statuses.set(m.key, s); sync(); },
        onOut: (m, text) => ctx.onOutText(m.out, text),
        onDone: () => { active.done = true; sync(); toast('All models imported', 'ok'); },
        onError: (why) => {
          if (why === 'permission') { needsPermission = true; toast('Folder permission lost — reconnect and watch again', 'err'); }
          else toast('Auto mode stopped: ' + why, 'err');
          active = null;
          sync();
        },
      });
      // paint 'running' updates through the shared statuses map
      active.watcher && sync();
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the picker
      toast('Auto mode: ' + ((e && e.message) || e), 'err');
    }
  }

  function stopRun() {
    active?.watcher?.stop();
    active = null;
    sync();
  }

  function sync() {
    dyn.innerHTML = '';
    if (active) {
      // live run view — folder line, per-model status, stop/results actions
      dyn.append(el('div', { class: 'row' }, [
        el('span', { class: 'small muted' }, 'Working folder:'),
        el('span', { class: 'mono', style: { fontWeight: '700' } }, active.folderName),
        el('span', { class: 'flex-1' }),
        active.done
          ? btn('View results', { size: 'btn-sm', kind: 'btn-primary', icon: 'arrow', onclick: () => ctx.openResults() })
          : btn('Stop watching', { size: 'btn-sm', onclick: stopRun }),
      ]));
      if (!active.done) {
        dyn.append(el('div', { class: 'mt-3' }, callout('info', 'Now open the folder and double-click RUN-ALL.bat (first run: if SmartScreen appears, choose “More info → Run anyway”; macOS: run “sh run-all.sh” in Terminal). Keep this tab visible — imports may pause while it is in the background.')));
      }
      dyn.append(statusRows());
    } else {
      const row = el('div', { class: 'row' });
      row.append(btn(handle ? 'Write files & watch' : 'Choose working folder…', { size: 'btn-sm', kind: 'btn-primary', icon: 'folder', onclick: startRun }));
      if (handle) {
        row.append(el('span', { class: 'small muted' }, [
          'folder: ', el('span', { class: 'mono', style: { fontWeight: '700', color: 'var(--ink)' } }, handle.name),
          needsPermission ? ' (permission needed — the button will ask)' : '',
        ]));
        row.append(btn('Change folder', { size: 'btn-sm', kind: 'btn-ghost', onclick: async () => { try { handle = await pickWorkFolder(); needsPermission = false; sync(); } catch {} } }));
      }
      dyn.append(row);
      dyn.append(el('p', { class: 'hint' }, 'Existing files with the same names in that folder are overwritten; leftover .out files from a previous run are cleared before watching.'));
    }
    announce();
  }

  // a live run from an earlier visit re-attaches; otherwise try to restore last session's folder
  if (active) sync();
  else {
    sync();
    restoreWorkFolder().then((r) => {
      if (!r || active || handle) return;
      handle = r.handle;
      needsPermission = r.state !== 'granted';
      sync();
    });
  }
}
