import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waPhone, nameList, inviteMessage, waLink, inviteState, pickedContact } from '../../js/share.js';

test('phone numbers become what WhatsApp expects', () => {
  assert.equal(waPhone('054-123 4567'), '972541234567');
  assert.equal(waPhone('0541234567'), '972541234567');
  assert.equal(waPhone('+972 54-123-4567'), '972541234567');
  assert.equal(waPhone('+972 054 1234567'), '972541234567');
  assert.equal(waPhone('972541234567'), '972541234567');
  assert.equal(waPhone('00972541234567'), '972541234567');
  assert.equal(waPhone('541234567'), '972541234567');
  assert.equal(waPhone('+1 (415) 555-0100'), '14155550100');
  assert.equal(waPhone('03-6123456'), '97236123456');
});

test('what is not a phone number is refused', () => {
  for (const bad of ['', '   ', 'abc', '12345', '0541', '+', '1234567890123456789', null, undefined]) assert.equal(waPhone(bad), null, String(bad));
});

test('names are joined the Hebrew way', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['נועה']), 'נועה');
  assert.equal(nameList(['נועה', 'יובל']), 'נועה ויובל');
  assert.equal(nameList(['נועה', ' יובל ', '', 'תמר']), 'נועה, יובל ותמר');
});

test('the message has the name, the children, the link once and the steps', () => {
  const link = 'https://example.com/app/#/join/F0123456789abcdef0123456789abcdef';
  const text = inviteMessage({ name: ' סבתא רותי ', kids: ['נועה', 'יובל', 'תמר'], link });
  assert.ok(text.startsWith('היי סבתא רותי,'));
  assert.ok(text.includes('של נועה, יובל ותמר.'));
  assert.equal(text.split(link).length, 2, 'the link appears once');
  assert.ok(text.includes(`\n${link}\n`), 'the link stands on a line of its own, so that WhatsApp makes it a link');
  for (const step of ['1. פותחים את הקישור.', '2. נכנסים, או פותחים חשבון', 'באייפון: כפתור השיתוף ואז "הוספה למסך הבית".', 'באנדרואיד: תפריט כרום ואז "התקנת אפליקציה".']) assert.ok(text.includes(step), step);
  assert.ok(!text.includes('undefined') && !text.includes('null'));
  assert.ok(inviteMessage({ name: 'דוד', kids: [], link }).includes('של הילדים.'));
});

test('the link carries only the code: no name, no child, no phone', () => {
  const link = 'https://example.com/app/#/join/Fabc';
  const text = inviteMessage({ name: 'סבתא', kids: ['נועה'], link });
  const inMessage = text.split('\n').find((l) => l.startsWith('https://'));
  assert.equal(inMessage, link);
  assert.ok(!/[֐-׿]|%D7/.test(inMessage));
});

test('the WhatsApp address holds the number and the whole message', () => {
  const text = 'שלום\nקישור: https://example.com/#/join/Fabc & עוד';
  const url = new URL(waLink('972541234567', text));
  assert.equal(url.origin + url.pathname, 'https://wa.me/972541234567');
  assert.equal(url.searchParams.get('text'), text);
  const open = new URL(waLink(null, text));
  assert.equal(open.pathname, '/');
  assert.equal(open.searchParams.get('text'), text);
});

test('an invitation is open, joined or expired', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(inviteState({ expires_at: '2026-11-20T00:00:00Z', used_at: null }, now), 'open');
  assert.equal(inviteState({ expires_at: '2026-11-15T11:59:59Z', used_at: null }, now), 'expired');
  assert.equal(inviteState({ expires_at: '2026-11-10T00:00:00Z', used_at: '2026-11-09T00:00:00Z' }, now), 'joined');
});

test('the contact picker gives a name and a number, or nothing', () => {
  assert.deepEqual(pickedContact([{ name: ['סבתא רותי'], tel: ['054-1234567', '03-1'] }]), { name: 'סבתא רותי', tel: '054-1234567' });
  assert.deepEqual(pickedContact([{ name: [], tel: ['0541234567'] }]), { name: '', tel: '0541234567' });
  assert.equal(pickedContact([]), null);
  assert.equal(pickedContact(undefined), null);
  assert.equal(pickedContact([{ name: [], tel: [] }]), null);
});
