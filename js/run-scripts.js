// run-scripts.js — pure generators for the working-folder "auto mode": RUN-ALL scripts that
// batch every generated .inp through the user's local Mplus, plus the .out completion marker
// shared with the folder watcher. No DOM — unit-tested in node (test/runscripts.test.mjs).

export function expectedOutName(inpName) {
  return String(inpName).replace(/\.inp$/i, '.out');
}

/** Has Mplus finished WRITING this .out? Mplus prints the "Beginning Time/Ending Time" block
 *  only at the very end of a run — success or failure alike. Only the tail is scanned: the
 *  header also says MUTHEN & MUTHEN, so a just-started file must not match. A hard crash can
 *  truncate the file before the footer — the watcher's stable-size fallback covers that. */
export function hasEndingMarker(outText) {
  return /^\s*Ending Time:/m.test(String(outText).slice(-2000));
}

const norm = (files) => files.map((f) => (typeof f === 'string' ? f : f.file || f.name));

/** Windows batch runner. CRLF, pure ASCII, no BOM — cmd.exe mis-parses anything else.
 *  Mplus is probed in the standard install locations, then PATH; the `set "MPLUS=` line is
 *  deliberately the first thing a user can edit when their install lives elsewhere. */
export function buildRunAllBat(files) {
  const names = norm(files);
  const L = [
    '@echo off',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    'rem --- Locate Mplus (edit the next line if yours is installed elsewhere) ---',
    'set "MPLUS="',
    'if exist "C:\\Program Files\\Mplus\\Mplus.exe" set "MPLUS=C:\\Program Files\\Mplus\\Mplus.exe"',
    'if not defined MPLUS if exist "C:\\Program Files (x86)\\Mplus\\Mplus.exe" set "MPLUS=C:\\Program Files (x86)\\Mplus\\Mplus.exe"',
    "if not defined MPLUS for /f \"delims=\" %%P in ('where Mplus.exe 2^>nul') do if not defined MPLUS set \"MPLUS=%%P\"",
    'if not defined MPLUS (',
    '  echo Mplus.exe not found - open this file in Notepad and set MPLUS to your Mplus path.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo Using "%MPLUS%"',
  ];
  names.forEach((n, i) => {
    L.push(`echo [${i + 1}/${names.length}] ${n}`);
    L.push(`"%MPLUS%" "${n}" "${expectedOutName(n)}"`);
  });
  L.push('echo Done - return to the browser tab, results import automatically.');
  L.push('pause');
  return L.join('\r\n') + '\r\n';
}

/** macOS/Linux runner (no double-click story on macOS — Gatekeeper quarantines downloaded
 *  scripts; users run `sh run-all.sh` in Terminal). MPLUS env var overrides the probe. */
export function buildRunAllSh(files) {
  const names = norm(files);
  const L = [
    '#!/bin/sh',
    '# run with:  sh run-all.sh          (or:  MPLUS=/path/to/mplus sh run-all.sh)',
    'cd "$(dirname "$0")"',
    'MPLUS="${MPLUS:-}"',
    'if [ -z "$MPLUS" ]; then',
    '  if command -v mplus >/dev/null 2>&1; then MPLUS=mplus',
    '  elif [ -x "/Applications/Mplus/mplus" ]; then MPLUS="/Applications/Mplus/mplus"',
    '  elif [ -x "/opt/mplus/mplus" ]; then MPLUS="/opt/mplus/mplus"',
    '  else echo "mplus not found - run:  MPLUS=/path/to/mplus sh run-all.sh"; exit 1',
    '  fi',
    'fi',
  ];
  names.forEach((n, i) => {
    L.push(`echo "[${i + 1}/${names.length}] ${n}"`);
    L.push(`"$MPLUS" "${n}" "${expectedOutName(n)}"`);
  });
  L.push('echo "Done - return to the browser tab, results import automatically."');
  return L.join('\n') + '\n';
}
