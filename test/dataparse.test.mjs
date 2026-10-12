import { parseDataFile } from '../js/data-parse.js';
let pass=0,fail=0; const ok=(n,c,g)=>{c?(pass++,console.log('  ok  '+n)):(fail++,console.log('  XX  '+n+' got '+JSON.stringify(g)));};

// whitespace .dat, no header, leading spaces + CRLF
const dat = "  0.66 0.45 0.46 1\r\n -1.2 0.88 1.13 2\r\n 0.51 0.38 0.49 1\r\n";
const d = parseDataFile(dat, 'ESEM.dat');
ok('dat nCols=4', d.nCols===4, d.nCols);
ok('dat nRows=3', d.nRows===3, d.nRows);
ok('dat no header', d.hasHeader===false, d.hasHeader);
ok('dat names V1..V4', JSON.stringify(d.varNames)===JSON.stringify(['V1','V2','V3','V4']), d.varNames);
ok('dat whitespace', d.delimiter==='whitespace', d.delimiter);

// csv with header
const csv = "age,score,grp\n23,1.4,1\n45,2.1,2\n";
const c = parseDataFile(csv, 'data.csv');
ok('csv header detected', c.hasHeader===true, c.hasHeader);
ok('csv names', JSON.stringify(c.varNames)===JSON.stringify(['age','score','grp']), c.varNames);
ok('csv nRows=2', c.nRows===2, c.nRows);
ok('csv comma', c.delimiter==='comma', c.delimiter);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
