import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, readZip, crc32 } from '../../js/zip.js';

test('crc32 known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round trip with Hebrew names', () => {
  const entries = [
    { name: 'נועה/2026-01-20 טיל.jpg', data: new Uint8Array([1, 2, 3, 255, 0]) },
    { name: 'גיבוי-ציורון.json', data: new TextEncoder().encode('{"a":1}') },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ];
  const back = readZip(createZip(entries));
  assert.equal(back.length, 3);
  back.forEach((e, i) => {
    assert.equal(e.name, entries[i].name);
    assert.deepEqual([...e.data], [...entries[i].data]);
  });
});

test('zip opens with the system unzip tool', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zt-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, createZip([{ name: 'תיקייה/קובץ.txt', data: new TextEncoder().encode('שלום') }]));
  const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(z.namelist()[0]);print(z.read(z.namelist()[0]).decode())`;
  const out = execFileSync('python3', ['-c', py, file]).toString().trim().split('\n');
  assert.deepEqual(out, ['תיקייה/קובץ.txt', 'שלום']);
});

test('readZip rejects garbage and corrupt data', () => {
  assert.throws(() => readZip(new Uint8Array(100)), /not a zip/);
  const z = createZip([{ name: 'a', data: new Uint8Array([1, 2, 3]) }]);
  z[30 + 1] ^= 0xff; // flip a data byte
  assert.throws(() => readZip(z), /corrupt/);
});
