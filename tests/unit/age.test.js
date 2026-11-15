import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, ageAt, ageLabel, ageGroupLabel, formatDate, formatDateWords, todayStr } from '../../js/age.js';

test('parseDate rejects invalid dates', () => {
  assert.equal(parseDate('2025-02-31'), null);
  assert.equal(parseDate('nope'), null);
  assert.equal(parseDate(''), null);
  assert.ok(parseDate('2024-02-29'));
});

test('ageAt counts whole months', () => {
  assert.deepEqual(ageAt('2020-05-15', '2024-05-15'), { years: 4, months: 0 });
  assert.deepEqual(ageAt('2020-05-15', '2024-05-14'), { years: 3, months: 11 });
  assert.deepEqual(ageAt('2020-05-15', '2024-08-20'), { years: 4, months: 3 });
  assert.deepEqual(ageAt('2024-01-31', '2024-02-29'), { years: 0, months: 0 });
  assert.equal(ageAt('2024-01-01', '2023-12-31'), null, 'date before birth');
  assert.equal(ageAt('', '2024-01-01'), null, 'no birth date');
});

test('Hebrew labels', () => {
  assert.equal(ageLabel({ years: 4, months: 3 }), 'גיל 4 ו-3 חודשים');
  assert.equal(ageLabel({ years: 2, months: 0 }), 'גיל שנתיים');
  assert.equal(ageLabel({ years: 1, months: 1 }), 'גיל שנה וחודש');
  assert.equal(ageLabel({ years: 0, months: 2 }), 'חודשיים');
  assert.equal(ageLabel(null), '');
  assert.equal(ageGroupLabel({ years: 5, months: 2 }), 'גיל 5');
  assert.equal(ageGroupLabel(null), 'בלי גיל');
  assert.equal(formatDate('2026-01-20'), 'יום שלישי 20/01/2026');
  assert.equal(formatDate('2021-06-27'), 'יום ראשון 27/06/2021');
  assert.equal(formatDate('2021-06-26'), 'שבת 26/06/2021');
  assert.equal(formatDate('2025-03-05'), 'יום רביעי 05/03/2025');
  assert.equal(formatDateWords('2026-01-20'), '20 בינואר 2026');
  assert.equal(todayStr(new Date(2026, 10, 3)), '2026-11-03');
});
