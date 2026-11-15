// Kids mode: the rules that need no screen. A device is in "parent" or "kid" mode; leaving kid mode needs a
// 4-digit code that the parent set once. The code itself is never kept, only a salted digest of it.

export const validPin = (pin) => /^\d{4}$/.test(String(pin ?? ''));

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function digest(pin, salt) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}

/** What is saved for a code: {salt, hash}. */
export async function makePin(pin) {
  if (!validPin(pin)) throw new Error('a code is 4 digits');
  const salt = hex(crypto.getRandomValues(new Uint8Array(8)));
  return { salt, hash: await digest(pin, salt) };
}

export const isPinRecord = (rec) => !!rec && typeof rec === 'object' && /^[0-9a-f]{16}$/.test(rec.salt || '') && /^[0-9a-f]{64}$/.test(rec.hash || '');

export async function checkPin(pin, rec) {
  if (!validPin(pin) || !isPinRecord(rec)) return false;
  return (await digest(pin, rec.salt)) === rec.hash;
}

/** After 5 wrong tries the pad rests for 30 seconds, then 60, 120... up to 10 minutes. Returns ms to wait, 0 = may try. */
export function lockWait(fails, lastFailAt, now) {
  if (fails < 5) return 0;
  const rest = Math.min(600_000, 30_000 * 2 ** Math.floor((fails - 5) / 5));
  return Math.max(0, lastFailAt + rest - now);
}

/** What a child sees: things with a picture or a clip, the newest first. */
export function kidList(memories, childId) {
  return memories
    .filter((m) => (!childId || m.childId === childId) && (m.image || (m.type === 'video' && m.media)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
}

const NEW_DAYS = 14;
/** "New": added in the last two weeks and not opened on this device yet. */
export function isNew(m, seen, now) {
  if (!m.createdAt || now - m.createdAt > NEW_DAYS * 864e5) return false;
  return !(seen || []).includes(m.id);
}

/** Remembers that a drawing was opened; keeps the last 400. */
export function markSeen(seen, id) {
  const list = (seen || []).filter((x) => x !== id);
  list.push(id);
  return list.slice(-400);
}

/** The clip a child can play for a drawing: its animation first, otherwise a video attached to it. */
export function kidClip(m) {
  if (m.type === 'video' && m.media) return m.media;
  const atts = m.attachments || [];
  const a = atts.find((x) => x.kind === 'animation') || atts.find((x) => x.kind === 'video');
  return a ? a.blob : null;
}

export const kidVoices = (m) => (m.attachments || []).filter((a) => a.kind === 'voice');
