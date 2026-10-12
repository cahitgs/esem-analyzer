// screenshot.mjs — headless-Chrome screenshot (uses cached puppeteer Chrome, no puppeteer dep).
// Usage: node screenshot.mjs http://localhost:3000 [label] [width] [height]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const url    = process.argv[2] || 'http://localhost:3000';
const label  = process.argv[3] || '';
const width  = parseInt(process.argv[4] || '1440', 10);
const height = parseInt(process.argv[5] || '1600', 10);

// locate newest cached Chrome
function findChrome(){
  const base = join(process.env.USERPROFILE || process.env.HOME, '.cache', 'puppeteer', 'chrome');
  if(!existsSync(base)) throw new Error('No puppeteer chrome cache at ' + base);
  const ver = d => (d.match(/win64-(.+)$/)?.[1] || '0').split('.').map(Number);
  const cmp = (a,b)=>{const A=ver(a),B=ver(b);for(let i=0;i<Math.max(A.length,B.length);i++){if((A[i]||0)!==(B[i]||0))return (A[i]||0)-(B[i]||0);}return 0;};
  const dirs = readdirSync(base).filter(d => d.startsWith('win64-')).sort(cmp);
  if(!dirs.length) throw new Error('No win64-* chrome in ' + base);
  const exe = join(base, dirs[dirs.length-1], 'chrome-win64', 'chrome.exe');
  if(!existsSync(exe)) throw new Error('chrome.exe missing at ' + exe);
  return exe;
}

const outDir = join(ROOT, 'temporary screenshots');
mkdirSync(outDir, { recursive: true });

// auto-increment index
let n = 1;
for(const f of readdirSync(outDir)){
  const m = f.match(/^screenshot-(\d+)/);
  if(m) n = Math.max(n, parseInt(m[1],10) + 1);
}
const name = `screenshot-${n}${label ? '-'+label : ''}.png`;
const out  = join(outDir, name);

const chrome = findChrome();
const userData = join(tmpdir(), 'simple-structure-chrome-profile');

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--hide-scrollbars',
  `--user-data-dir=${userData}`,
  `--window-size=${width},${height}`,
  '--force-device-scale-factor=2',
  '--virtual-time-budget=9000',
  `--screenshot=${out}`,
  url,
];

const r = spawnSync(chrome, args, { stdio: 'inherit', timeout: 60000 });
if(r.error) { console.error('Chrome failed:', r.error.message); process.exit(1); }
if(existsSync(out)) {
  const kb = (statSync(out).size/1024).toFixed(0);
  console.log(`OK -> ${out} (${kb} KB, ${width}x${height})`);
} else {
  console.error('No screenshot produced.'); process.exit(1);
}
