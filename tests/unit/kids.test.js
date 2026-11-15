import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validPin, makePin, checkPin, isPinRecord, lockWait, kidList, isNew, markSeen, kidClip, kidVoices } from '../../js/kids.js';

test('a code is exactly 4 digits', () => {
  for (const ok of ['0000', '1234', '9876']) assert.equal(validPin(ok), true);
  for (const bad of ['', '123', '12345', '12a4', ' 1234', null, undefined, 1.5]) assert.equal(validPin(bad), false);
});

test('the code is kept only as a salted digest, and checks only against the right code', async () => {
  const rec = await makePin('4821');
  assert.equal(isPinRecord(rec), true);
  assert.ok(!JSON.stringify(rec).includes('4821'));
  assert.equal(await checkPin('4821', rec), true);
  assert.equal(await checkPin('4822', rec), false);
  assert.equal(await checkPin('', rec), false);
  const other = await makePin('4821');
  assert.notEqual(other.salt, rec.salt, 'each code gets its own salt');
  assert.notEqual(other.hash, rec.hash);
  await assert.rejects(() => makePin('12'));
});

test('a damaged or missing record never opens', async () => {
  for (const rec of [null, {}, { salt: 'x', hash: 'y' }, { salt: '0'.repeat(16) }, 'abc']) {
    assert.equal(isPinRecord(rec), false);
    assert.equal(await checkPin('1234', rec), false);
  }
});

test('wrong tries: free up to 4, then a growing rest', () => {
  assert.equal(lockWait(4, 1000, 1000), 0);
  assert.equal(lockWait(5, 1000, 1000), 30_000);
  assert.equal(lockWait(5, 1000, 31_000), 0);
  assert.equal(lockWait(9, 0, 0), 30_000);
  assert.equal(lockWait(10, 0, 0), 60_000);
  assert.equal(lockWait(15, 0, 0), 120_000);
  assert.equal(lockWait(500, 0, 0), 600_000);
});

const mems = [
  { id: 'a', childId: 'k1', type: 'artwork', image: 'i1', date: '2026-01-01', createdAt: 5 },
  { id: 'b', childId: 'k1', type: 'note', date: '2026-03-01', createdAt: 6 },
  { id: 'c', childId: 'k2', type: 'photo', image: 'i3', date: '2026-02-01', createdAt: 7 },
  { id: 'd', childId: 'k1', type: 'video', media: 'v1', date: '2026-02-01', createdAt: 8 },
  { id: 'e', childId: 'k1', type: 'voice', media: 'r1', date: '2026-04-01', createdAt: 9 },
  { id: 'f', childId: 'k1', type: 'artwork', image: 'i6', date: '2026-02-01', createdAt: 9 },
];

test('a child sees pictures and clips of that child, the newest first', () => {
  assert.deepEqual(kidList(mems, 'k1').map((m) => m.id), ['f', 'd', 'a']);
  assert.deepEqual(kidList(mems, null).map((m) => m.id), ['f', 'd', 'c', 'a']);
  assert.deepEqual(kidList([], 'k1'), []);
});

test('"new" means added in the last two weeks and not opened here', () => {
  const now = 20 * 864e5;
  assert.equal(isNew({ id: 'a', createdAt: now - 864e5 }, [], now), true);
  assert.equal(isNew({ id: 'a', createdAt: now - 864e5 }, ['a'], now), false);
  assert.equal(isNew({ id: 'a', createdAt: now - 15 * 864e5 }, [], now), false);
  assert.equal(isNew({ id: 'a' }, [], now), false);
  assert.deepEqual(markSeen(['a', 'b'], 'a'), ['b', 'a']);
  assert.equal(markSeen(Array.from({ length: 450 }, (_, i) => 'x' + i), 'z').length, 400);
});

test('the clip of a drawing: its animation, else an attached video; recordings are listed', () => {
  assert.equal(kidClip({ type: 'video', media: 'v' }), 'v');
  assert.equal(kidClip({ attachments: [{ kind: 'video', blob: 'b1' }, { kind: 'animation', blob: 'b2' }] }), 'b2');
  assert.equal(kidClip({ attachments: [{ kind: 'voice', blob: 'b1' }] }), null);
  assert.equal(kidClip({}), null);
  assert.equal(kidVoices({ attachments: [{ kind: 'voice', blob: 'b1' }, { kind: 'video', blob: 'b2' }] }).length, 1);
});
