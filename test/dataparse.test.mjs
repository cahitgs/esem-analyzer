import { parseDataFile, parseNameList, detectMissingCode, detectLikertColumns } from '../js/data-parse.js';
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

// pasted name lists (Morin: names copied from SPSS, or an Mplus NAMES line)
ok('names: one per line', parseNameList('id\nitem1\nitem2\nsex\n').join() === 'id,item1,item2,sex', parseNameList('id\nitem1\nitem2\nsex\n'));
ok('names: Mplus NAMES ARE with ranges and semicolon', parseNameList('NAMES ARE id x1-x4 age sex;').join() === 'id,x1,x2,x3,x4,age,sex', parseNameList('NAMES ARE id x1-x4 age sex;'));
ok('names: commas/tabs, Mplus-safe truncation, duplicates made unique', parseNameList('a,\tb\tverylongname1, verylongname2').join() === 'a,b,verylong,verylon2', parseNameList('a,\tb\tverylongname1, verylongname2'));
ok('names: item10-item12 range keeps the prefix', parseNameList('item10-item12').join() === 'item10,item11,item12');

// missing-value code detection
const mk = (rows, names) => ({ varNames: names, _matrix: rows.map((r) => r.map(String)) });
const rows999 = Array.from({ length: 40 }, (_, i) => [i + 1, (i % 5) + 1, i % 7 === 0 ? 999 : (i % 4) + 1, i % 9 === 0 ? 999 : (i % 3) + 2, 1 + (i % 2)]);
const h = detectMissingCode(mk(rows999, ['id', 'a', 'b', 'c', 'g']));
ok('999 in two Likert columns → detected with column and cell counts', h && h.code === '999' && h.columns === 2 && h.cells === 11 && h.names.join() === 'b,c', h);
const rows99 = Array.from({ length: 40 }, (_, i) => [i + 1, 40 + (i * 7) % 61, 30 + (i * 11) % 70]);
ok('99 on a 0–100 scale is not a missing code', detectMissingCode(mk(rows99, ['id', 'score1', 'score2'])) === null, detectMissingCode(mk(rows99, ['id', 'score1', 'score2'])));
const rowsDot = Array.from({ length: 30 }, (_, i) => [i + 1, i % 6 === 0 ? '.' : (i % 5) + 1, i % 8 === 0 ? '.' : (i % 5) + 1]);
ok('"." in several columns → detected', detectMissingCode(mk(rowsDot, ['id', 'a', 'b']))?.code === '.', detectMissingCode(mk(rowsDot, ['id', 'a', 'b'])));
ok('a single column with 999 is not enough', detectMissingCode(mk(rows999.map((r) => [r[0], r[1], r[2], 3, r[4]]), ['id', 'a', 'b', 'c', 'g'])) === null);
ok('clean data → null', detectMissingCode(mk(rows999.map((r) => [r[0], r[1], (r[2] === 999 ? 2 : r[2]), (r[3] === 999 ? 2 : r[3]), r[4]]), ['id', 'a', 'b', 'c', 'g'])) === null);

// Likert detection
const lik = Array.from({ length: 60 }, (_, i) => [i + 1, (i % 5) + 1, (i % 4) + 1, (3.2 + (i % 7) * 0.37).toFixed(2), i % 2]);
ok('integer 1–5 / 1–4 columns look ordinal; the continuous score does not; id (60 levels) does not; a 0/1 column does', detectLikertColumns(mk(lik, ['id', 'a', 'b', 'score', 'sex'])).join() === 'a,b,sex', detectLikertColumns(mk(lik, ['id', 'a', 'b', 'score', 'sex'])));
ok('fewer than 20 rows → no suggestion', detectLikertColumns(mk(lik.slice(0, 10), ['id', 'a', 'b', 'score', 'sex'])).length === 0);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
