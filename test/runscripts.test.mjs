// runscripts.test.mjs — auto-mode RUN-ALL script generators + the .out completion marker.
// Run: node test/runscripts.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRunAllBat, buildRunAllSh, expectedOutName, hasEndingMarker } from '../js/run-scripts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  XX  ${name}  (got: ${JSON.stringify(got)})`); }
}

console.log('\n— expectedOutName —');
check('CFA_3f.inp → CFA_3f.out', expectedOutName('CFA_3f.inp') === 'CFA_3f.out', expectedOutName('CFA_3f.inp'));
check('case-insensitive .INP', expectedOutName('X.INP') === 'X.out', expectedOutName('X.INP'));

const FILES = ['CFA_3f.inp', 'ESEM_target_3f.inp', 'Inv_1_configural.inp'];
const bat = buildRunAllBat(FILES);
const sh = buildRunAllSh(FILES);

console.log('\n— RUN-ALL.bat —');
check('pure ASCII', /^[\x00-\x7F]*$/.test(bat), bat.match(/[^\x00-\x7F]/)?.[0]);
check('no BOM', bat.charCodeAt(0) !== 0xFEFF, bat.charCodeAt(0));
check('CRLF line endings only', !/[^\r]\n/.test(bat) && bat.includes('\r\n'), null);
check('runs from its own folder (%~dp0)', bat.includes('cd /d "%~dp0"'), null);
check('editable MPLUS line + x86 + where fallbacks', bat.includes('set "MPLUS=') && bat.includes('Program Files (x86)') && bat.includes('where Mplus.exe'), null);
check('not-found message + pause', bat.includes('not found') && /\r\npause\r\n/.test(bat), null);
const batPos = FILES.map((f) => bat.indexOf(`"%MPLUS%" "${f}" "${expectedOutName(f)}"`));
check('every model quoted, in order', batPos.every((p, i) => p > 0 && (i === 0 || p > batPos[i - 1])), batPos);
check('progress echo [1/3]', bat.includes('echo [1/3] CFA_3f.inp') && bat.includes('echo [3/3] Inv_1_configural.inp'), null);

console.log('\n— run-all.sh —');
check('LF only (no CR)', !sh.includes('\r'), null);
check('cd to script dir', sh.includes('cd "$(dirname "$0")"'), null);
check('MPLUS env override + probes', sh.includes('MPLUS="${MPLUS:-}"') && sh.includes('/Applications/Mplus/mplus'), null);
const shPos = FILES.map((f) => sh.indexOf(`"$MPLUS" "${f}" "${expectedOutName(f)}"`));
check('every model quoted, in order', shPos.every((p, i) => p > 0 && (i === 0 || p > shPos[i - 1])), shPos);

console.log('\n— hasEndingMarker (real Mplus outputs) —');
const dirs = [join(HERE, 'fixtures'), join(HERE, '..', 'example-dataset')];
let outs = 0, marked = 0;
for (const d of dirs) {
  for (const f of readdirSync(d).filter((n) => n.endsWith('.out'))) {
    outs++;
    if (hasEndingMarker(readFileSync(join(d, f), 'utf8'))) marked++;
  }
}
check(`every complete fixture has the marker (${marked}/${outs})`, outs > 20 && marked === outs, `${marked}/${outs}`);
const full = readFileSync(join(HERE, 'fixtures', 'esem_target_data1.out'), 'utf8');
check('truncated copy (first 5000 chars) → false', !hasEndingMarker(full.slice(0, 5000)), null);
check('mid-write copy (all but last 400 chars) → false OK or true only if footer intact', !hasEndingMarker(full.slice(0, full.length - 400)) || full.slice(-2400, -400).includes('Ending Time:'), null);
check('empty → false', !hasEndingMarker(''), null);

console.log(`\nrunscripts.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
