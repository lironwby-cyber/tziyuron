import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileName, folderName, safe, sweep, describe, INDEX_NAME } from '../../supabase/functions/art-backup/core.js';

const CHILD = '11111111-1111-1111-1111-111111111111';
const NOW = Date.parse('2026-11-15T12:00:00Z');
const OLD = '2026-11-15T10:00:00Z';

/** A pCloud that keeps what it gets, and a store over plain objects, with the same claim rules as the database. */
function world({ token = 'tok', objects = {}, memories = [], children = [{ id: CHILD, name: 'נועה', avatar_path: null }], jobs = {} } = {}) {
  const w = {
    cfg: { access_token: token, api_host: 'eapi.pcloud.com', root_folder_id: 10, last_error: null },
    rows: {}, folders: {}, indexAt: {}, cloud: { folders: {}, files: [] }, calls: [], objects, memories, children, jobs,
    nextFolder: 100, nextFile: 1000, breakAuth: false, shrink: false, misname: false,
  };
  w.store = {
    config: async () => w.cfg,
    setConfig: async (p) => Object.assign(w.cfg, p),
    claim: async (n) => {
      const out = [];
      for (const [path, o] of Object.entries(w.objects)) {
        if (out.length >= n) break;
        const r = w.rows[path];
        if (r && !(r.status === 'working' && r.stale)) continue;
        w.rows[path] = { status: 'working', attempts: (r ? r.attempts : 0) + 1 };
        out.push({ path, bytes: o.bytes.length, uploaded_at: o.at || OLD });
      }
      return out;
    },
    mark: async (path, p) => Object.assign(w.rows[path], p),
    postpone: async (path) => { w.rows[path].postponed = true; },
    release: async (paths) => { for (const p of paths) delete w.rows[p]; },
    child: async (id) => w.children.find((c) => c.id === id) || null,
    children: async () => w.children,
    folder: async (id) => w.folders[id] || null,
    saveFolder: async (id, f) => { w.folders[id] = f; },
    indexAt: async (id) => w.indexAt[id] || null,
    setIndexAt: async (id, at) => { w.indexAt[id] = at; },
    memoryOfFile: async (child, id) => w.memories.find((m) => m.child_id === child && m.files && m.files[id]) || null,
    memoryOfJob: async (id) => w.memories.find((m) => m.id === w.jobs[id]) || null,
    lastChange: async (child) => w.memories.filter((m) => m.child_id === child).map((m) => m.updated_at).sort().pop() || null,
    memories: async (child) => w.memories.filter((m) => m.child_id === child),
    download: async (path) => (w.objects[path].gone ? null : new Blob([w.objects[path].bytes], { type: w.objects[path].type || '' })),
  };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = u.pathname.slice(1);
    w.calls.push({ host: u.host, method, auth: init.headers.Authorization });
    const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (w.breakAuth || init.headers.Authorization !== 'Bearer tok') return reply({ result: 2000 });
    if (method === 'createfolderifnotexists') {
      const key = u.searchParams.get('folderid') + '/' + u.searchParams.get('name');
      w.cloud.folders[key] ??= w.nextFolder++;
      return reply({ result: 0, metadata: { folderid: w.cloud.folders[key] } });
    }
    if (method === 'uploadfile') {
      const file = init.body.get('file');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const rec = { folder: Number(u.searchParams.get('folderid')), name: w.misname ? 'x.bin' : file.name, bytes, fileid: w.nextFile++ };
      w.cloud.files.push(rec);
      return reply({ result: 0, fileids: [rec.fileid], metadata: [{ fileid: rec.fileid, name: rec.name, size: w.shrink ? bytes.length - 1 : bytes.length }] });
    }
    if (method === 'renamefile') {
      w.cloud.files.find((f) => f.fileid === Number(u.searchParams.get('fileid'))).name = u.searchParams.get('toname');
      return reply({ result: 0 });
    }
    return reply({ result: 1 });
  };
  w.run = (opts = {}) => sweep(w.store, w.fetch, { now: () => NOW, ...opts });
  return w;
}
const bytes = (n, v = 7) => new Uint8Array(n).fill(v);
const memory = (id, title, files, extra = {}) => ({ id, child_id: CHILD, title, date: '2026-01-01', files, updated_at: OLD, ...extra });

test('file names: date, title, what it is, short id, the right ending', () => {
  assert.equal(fileName({ date: '2026-01-01', title: 'טיל', role: 'image', id: '1a2b3c4d-9999', type: 'image/jpeg' }), '2026-01-01 טיל 1a2b3c4d.jpg');
  assert.equal(fileName({ date: '2026-01-01', title: 'טיל', role: 'original', id: 'abcdef12', type: 'image/png' }), '2026-01-01 טיל (מקור) abcdef12.png');
  assert.equal(fileName({ date: '2026-01-01', title: '', role: 'voice', id: 'abcdef12', type: 'audio/mp4; codecs=x' }), '2026-01-01 ללא שם (הקלטה) abcdef12.m4a');
  assert.equal(fileName({ role: 'avatar', id: 'abcdef12', type: 'image/jpeg' }), '(תמונת פרופיל) abcdef12.jpg');
  assert.equal(fileName({ date: 'x', title: 'a', role: 'media', id: 'q', type: 'weird/type' }), 'a (קובץ) q.bin');
});

test('names are safe for a file system', () => {
  assert.equal(safe('  מה/זה\\: "כן"? <a|b>*\n '), 'מה זה כן a b');
  assert.equal(safe('סוף...  '), 'סוף');
  assert.equal(safe('א'.repeat(100)).length, 60);
  assert.equal(fileName({ date: '2026-01-01', title: '../../etc/passwd', role: 'image', id: 'abcdef12', type: 'image/jpeg' }), '2026-01-01 .. .. etc passwd abcdef12.jpg');
  assert.equal(folderName({ id: CHILD, name: 'נועה/..' }), 'נועה 1111');
  assert.equal(folderName({ id: CHILD, name: '' }), 'ילד 1111');
});

test('a run copies every file into the child folder, byte for byte, and skips thumbnails', async () => {
  const w = world({
    objects: {
      [`${CHILD}/aaaaaaaa-1`]: { bytes: bytes(500, 1) },
      [`${CHILD}/bbbbbbbb-2`]: { bytes: bytes(900, 2) },
      [`${CHILD}/cccccccc-3`]: { bytes: bytes(50, 3) },
      [`${CHILD}/dddddddd-4`]: { bytes: bytes(70, 4), type: 'audio/mp4' },
      [`${CHILD}/anim/eeeeeeee-5.mp4`]: { bytes: bytes(300, 5) },
      [`${CHILD}/ffffffff-6`]: { bytes: bytes(20, 6) },
    },
    memories: [memory('m1', 'טיל', {
      'aaaaaaaa-1': { role: 'image', type: 'image/jpeg' }, 'bbbbbbbb-2': { role: 'original', type: 'image/png' },
      'cccccccc-3': { role: 'thumb', type: 'image/jpeg' }, 'dddddddd-4': { role: 'voice' },
    })],
    jobs: { 'eeeeeeee-5': 'm1' },
    children: [{ id: CHILD, name: 'נועה', avatar_path: `${CHILD}/ffffffff-6` }],
  });
  const out = await w.run();
  assert.deepEqual(out, { ok: true, copied: 5, failed: 0, skipped: 1, waiting: 0 });
  const folder = w.cloud.folders['10/נועה 1111'];
  assert.ok(folder, 'the child folder is made under the root');
  const names = w.cloud.files.filter((f) => f.name !== INDEX_NAME).map((f) => f.name).sort();
  assert.deepEqual(names, [
    '(תמונת פרופיל) ffffffff.jpg', '2026-01-01 טיל (הנפשה) eeeeeeee.mp4', '2026-01-01 טיל (הקלטה) dddddddd.m4a',
    '2026-01-01 טיל (מקור) bbbbbbbb.png', '2026-01-01 טיל aaaaaaaa.jpg',
  ]);
  for (const f of w.cloud.files) assert.equal(f.folder, folder);
  assert.deepEqual([...w.cloud.files.find((f) => f.name.includes('(מקור)')).bytes], [...bytes(900, 2)]);
  assert.equal(w.rows[`${CHILD}/cccccccc-3`].status, 'skipped');
  assert.equal(w.rows[`${CHILD}/aaaaaaaa-1`].status, 'done');
  assert.ok(w.rows[`${CHILD}/aaaaaaaa-1`].remote_id >= 1000);
  // The list of memories goes along, so that the copy can be read without the app.
  const index = w.cloud.files.find((f) => f.name === INDEX_NAME);
  const list = JSON.parse(new TextDecoder().decode(index.bytes));
  assert.equal(list.memories[0].title, 'טיל');
  assert.equal(list.child.name, 'נועה');
  assert.equal(w.cfg.last_error, null);
  assert.ok(w.calls.every((c) => c.host === 'eapi.pcloud.com' && c.auth === 'Bearer tok'), 'every call goes to the stored host');
  // A second run has nothing to do and uploads nothing.
  const before = w.cloud.files.length;
  assert.deepEqual(await w.run(), { ok: true, copied: 0, failed: 0, skipped: 0, waiting: 0 });
  assert.equal(w.cloud.files.length, before);
});

test('not connected: nothing is claimed and nothing is sent', async () => {
  const w = world({ token: null, objects: { [`${CHILD}/a`]: { bytes: bytes(5) } } });
  assert.deepEqual(await w.run(), { ok: false, reason: 'not connected' });
  assert.equal(w.calls.length, 0);
  assert.deepEqual(w.rows, {});
});

test('pCloud refuses the connection: the run stops, the files stay pending, the reason is kept', async () => {
  const w = world({
    objects: { [`${CHILD}/a1`]: { bytes: bytes(5) }, [`${CHILD}/a2`]: { bytes: bytes(5) }, [`${CHILD}/a3`]: { bytes: bytes(5) } },
    memories: [memory('m1', 'טיל', { a1: { role: 'image' }, a2: { role: 'image' }, a3: { role: 'image' } })],
  });
  w.folders[CHILD] = 55;
  w.breakAuth = true;
  const out = await w.run();
  assert.equal(out.ok, false);
  assert.equal(out.copied, 0);
  assert.deepEqual(w.rows, {}, 'no file is marked failed for a broken connection');
  assert.match(w.cfg.last_error, /refused the connection \(2000\)/);
  assert.equal(w.calls.length, 1, 'the run stops at the first refusal');
  // After a reconnect the same files are copied.
  w.breakAuth = false;
  assert.equal((await w.run()).copied, 3);
  assert.equal(w.cfg.last_error, null);
});

test('a copy with another size is not called a backup', async () => {
  const w = world({ objects: { [`${CHILD}/a1`]: { bytes: bytes(5) } }, memories: [memory('m1', 'טיל', { a1: { role: 'image' } })] });
  w.shrink = true;
  const out = await w.run();
  assert.equal(out.failed, 1);
  assert.equal(w.rows[`${CHILD}/a1`].status, 'failed');
  assert.match(w.rows[`${CHILD}/a1`].error, /another size/);
});

test('a file that cannot be read fails alone; the others are copied', async () => {
  const w = world({
    objects: { [`${CHILD}/a1`]: { bytes: bytes(5), gone: true }, [`${CHILD}/a2`]: { bytes: bytes(6) } },
    memories: [memory('m1', 'טיל', { a1: { role: 'image' }, a2: { role: 'image' } })],
  });
  const out = await w.run();
  assert.equal(out.failed, 1);
  assert.equal(out.copied, 1);
});

test('a file that arrived before its memory waits; an old one is copied as "no name"', async () => {
  const fresh = new Date(NOW - 60_000).toISOString();
  const w = world({ objects: { [`${CHILD}/new1`]: { bytes: bytes(5), at: fresh, type: 'image/jpeg' }, [`${CHILD}/old1`]: { bytes: bytes(6), type: 'image/jpeg' } } });
  const out = await w.run();
  assert.equal(out.waiting, 1);
  assert.equal(out.copied, 1);
  assert.equal(w.rows[`${CHILD}/new1`].postponed, true);
  assert.equal(w.cloud.files[0].name, 'ללא שם (קובץ) old1.jpg');
});

test('a name pCloud changed is put right', async () => {
  const w = world({ objects: { [`${CHILD}/a1`]: { bytes: bytes(5) } }, memories: [memory('m1', 'טיל', { a1: { role: 'image', type: 'image/jpeg' } })] });
  w.misname = true;
  await w.run();
  assert.equal(w.cloud.files[0].name, '2026-01-01 טיל a1.jpg');
});

test('a file of a child that is gone is skipped, not retried forever', async () => {
  const w = world({ objects: { ['22222222-2222-2222-2222-222222222222/a1']: { bytes: bytes(5) } } });
  const out = await w.run();
  assert.equal(out.skipped, 1);
});

test('the list of memories is sent again only when something changed', async () => {
  const w = world({ memories: [memory('m1', 'טיל', {})] });
  await w.run();
  assert.equal(w.cloud.files.filter((f) => f.name === INDEX_NAME).length, 1);
  await w.run();
  assert.equal(w.cloud.files.filter((f) => f.name === INDEX_NAME).length, 1, 'unchanged: not sent again');
  w.memories[0].title = 'חללית';
  w.memories[0].updated_at = '2026-11-15T12:30:00Z';
  await w.run();
  assert.equal(w.cloud.files.filter((f) => f.name === INDEX_NAME).length, 2);
});

test('the time budget ends the run between files', async () => {
  const objects = {};
  for (let i = 0; i < 9; i += 1) objects[`${CHILD}/f${i}`] = { bytes: bytes(5), type: 'image/jpeg' };
  const w = world({ objects });
  let t = NOW;
  const out = await sweep(w.store, w.fetch, { now: () => (t += 10_000), budgetMs: 30_000 });
  assert.ok(out.copied >= 3 && out.copied < 9, `copied ${out.copied}`);
  assert.equal(Object.values(w.rows).filter((r) => r.status === 'working').length, 0, 'no file is left taken');
});

test('describe: odd paths never throw', async () => {
  const w = world();
  assert.equal((await describe(w.store, 'a/b/c/d')).odd, true);
  assert.equal((await describe(w.store, `${CHILD}/zz`)).known, false);
});
