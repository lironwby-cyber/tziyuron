import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMemories, groupByAge, backupPaths, safeName, normalize, extFor } from '../../js/model.js';

const children = [
  { id: 'c1', name: 'נועה', birthDate: '2020-03-10' },
  { id: 'c2', name: 'יובל', birthDate: '2022-07-01' },
];
const memories = [
  { id: 'm1', childId: 'c1', type: 'artwork', title: 'טיל לירח', caption: 'זה אבא בחלל', date: '2025-01-05', createdAt: 1 },
  { id: 'm2', childId: 'c1', type: 'artwork', title: 'בית', caption: '', date: '2024-02-01', createdAt: 2 },
  { id: 'm3', childId: 'c2', type: 'milestone', title: 'צעד ראשון', caption: '', date: '2023-07-15', createdAt: 3 },
  { id: 'm4', childId: 'c2', type: 'artwork', title: 'דינוזאור', caption: 'רקס כחול', date: '2025-01-05', createdAt: 4 },
];

test('search spans all children and fields, newest first', () => {
  assert.deepEqual(filterMemories(memories, children, { query: 'אבא' }).map((m) => m.id), ['m1']);
  assert.deepEqual(filterMemories(memories, children, { query: 'יובל' }).map((m) => m.id), ['m4', 'm3']);
  assert.deepEqual(filterMemories(memories, children, { query: 'אבן דרך' }).map((m) => m.id), ['m3']);
  assert.deepEqual(filterMemories(memories, children, { query: 'ינואר 2025' }).map((m) => m.id), ['m4', 'm1']);
  assert.deepEqual(filterMemories(memories, children, { childId: 'c1' }).map((m) => m.id), ['m1', 'm2']);
  assert.equal(filterMemories(memories, children, { query: 'אין כזה' }).length, 0);
});

test('search ignores niqqud and punctuation', () => {
  assert.equal(normalize('שָׁלוֹם, עוֹלָם!'), 'שלום עולם');
  assert.deepEqual(filterMemories(memories, children, { query: 'טִיל' }).map((m) => m.id), ['m1']);
});

test('timeline groups by age, newest group first', () => {
  const groups = groupByAge(memories.filter((m) => m.childId === 'c1'), children[0]);
  assert.deepEqual(groups.map((g) => g.label), ['גיל 4', 'גיל 3']);
  const none = groupByAge([{ id: 'x', childId: 'c9', date: '2025-01-01' }], { id: 'c9', birthDate: '' });
  assert.equal(none[0].label, 'בלי גיל');
});

test('backup paths are readable, per child and unique', () => {
  const blobs = [
    { id: 'b1', type: 'image/jpeg', role: 'image', memoryId: 'm1' },
    { id: 'b2', type: 'image/jpeg', role: 'original', memoryId: 'm1' },
    { id: 'b3', type: 'audio/webm;codecs=opus', role: 'voice', memoryId: 'm1' },
    { id: 'b4', type: 'audio/webm', role: 'voice', memoryId: 'm1' },
    { id: 'b5', type: 'image/jpeg', role: 'avatar', childId: 'c2' },
  ];
  const p = backupPaths(children, memories, blobs);
  assert.equal(p.b1, 'נועה/2025-01-05 טיל לירח.jpg');
  assert.equal(p.b2, 'נועה/2025-01-05 טיל לירח - מקור.jpg');
  assert.equal(p.b3, 'נועה/2025-01-05 טיל לירח - קול.webm');
  assert.equal(p.b4, 'נועה/2025-01-05 טיל לירח - קול (2).webm');
  assert.equal(p.b5, 'יובל/תמונת פרופיל.jpg');
  assert.equal(new Set(Object.values(p)).size, blobs.length);
});

test('safe names and extensions', () => {
  assert.equal(safeName('a/b:c*?'), 'a b c');
  assert.equal(safeName('   '), 'ללא שם');
  assert.equal(extFor('video/quicktime'), 'mov');
  assert.equal(extFor('weird/type'), 'bin');
});
