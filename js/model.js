// Pure data helpers: types, search, grouping, backup paths.
import { ageAt, ageGroupLabel, formatDate } from './age.js';

export const TYPES = {
  artwork: { label: 'ציור', icon: '🎨' },
  photo: { label: 'תמונה', icon: '📷' },
  video: { label: 'וידאו', icon: '🎬' },
  voice: { label: 'הקלטה', icon: '🎙️' },
  milestone: { label: 'אבן דרך', icon: '⭐' },
  note: { label: 'זיכרון כתוב', icon: '✏️' },
};

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Normalise Hebrew/Latin text for search: lower case, no niqqud, no punctuation runs. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[\s\-_.,!?"'׳״]+/g, ' ')
    .trim();
}

/** Memories matching the filters, newest first. */
export function filterMemories(memories, children, { childId = null, query = '', type = null } = {}) {
  const byId = new Map(children.map((c) => [c.id, c]));
  const words = normalize(query).split(' ').filter(Boolean);
  return memories
    .filter((m) => !childId || m.childId === childId)
    .filter((m) => !type || m.type === type)
    .filter((m) => {
      if (!words.length) return true;
      const child = byId.get(m.childId);
      const hay = normalize([
        m.title, m.caption, TYPES[m.type]?.label, child?.name, formatDate(m.date),
      ].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .sort(compareMemories);
}

export function compareMemories(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

/** Group a child's memories into age buckets, youngest bucket last (newest first). */
export function groupByAge(memories, child) {
  const groups = [];
  const index = new Map();
  for (const m of [...memories].sort(compareMemories)) {
    const age = child ? ageAt(child.birthDate, m.date) : null;
    const key = age ? String(age.years) : 'none';
    if (!index.has(key)) {
      const g = { key, label: ageGroupLabel(age), items: [] };
      index.set(key, g);
      groups.push(g);
    }
    index.get(key).items.push(m);
  }
  return groups;
}

/** File-system-safe name that keeps Hebrew letters. */
export function safeName(s, fallback = 'ללא שם') {
  const clean = String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return clean || fallback;
}

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
};

export function extFor(mime) {
  const base = String(mime || '').split(';')[0].trim();
  return EXT[base] || 'bin';
}

/**
 * Human-readable path for every blob in the backup, e.g.
 * "נועה/2026-01-20 טיל - ציור.jpg". Paths are unique.
 * blobs: [{id, type, role, memoryId|childId}]
 */
export function backupPaths(children, memories, blobs) {
  const childName = new Map(children.map((c) => [c.id, safeName(c.name)]));
  const mem = new Map(memories.map((m) => [m.id, m]));
  const used = new Set();
  const paths = {};
  const ROLE = { image: '', original: ' - מקור', thumb: ' - ממוזער', voice: ' - קול', video: ' - וידאו', media: '', avatar: '' };
  for (const b of blobs) {
    let dir, base;
    if (b.childId && b.role === 'avatar') {
      dir = childName.get(b.childId) || 'ילדים';
      base = 'תמונת פרופיל';
    } else {
      const m = mem.get(b.memoryId);
      dir = (m && childName.get(m.childId)) || 'ללא ילד';
      base = m ? `${m.date} ${safeName(m.title, TYPES[m.type]?.label || 'פריט')}` : 'פריט';
    }
    const role = ROLE[b.role] ?? ` - ${b.role}`;
    let path = `${dir}/${base}${role}.${extFor(b.type)}`;
    let n = 2;
    while (used.has(path)) path = `${dir}/${base}${role} (${n++}).${extFor(b.type)}`;
    used.add(path);
    paths[b.id] = path;
  }
  return paths;
}

/** All blob ids that belong to a memory. */
export function memoryBlobIds(m) {
  const ids = [m.image, m.original, m.thumb, m.media, ...(m.attachments || []).map((a) => a.blob)];
  return ids.filter(Boolean);
}

// ---------- Family archive mapping (local record <-> server row) ----------
const str = (v, max) => String(v ?? '').slice(0, max);

export function childToRow(c) {
  return {
    id: c.id,
    name: str(c.name, 40) || 'ילד',
    birth_date: c.birthDate || null,
    animal: c.animal ?? null,
    color: Number.isInteger(c.color) ? c.color : null,
    avatar_path: c.avatar ? `${c.id}/${c.avatar}` : null,
  };
}

export function rowToChild(r, prev = null) {
  return {
    ...(prev || {}),
    id: r.id,
    name: r.name,
    birthDate: r.birth_date || '',
    animal: r.animal ?? undefined,
    color: r.color ?? undefined,
    avatar: r.avatar_path ? r.avatar_path.split('/').pop() : null,
    createdAt: prev?.createdAt ?? (Date.parse(r.created_at) || Date.now()),
  };
}

/** files: {blobId: {type, role, path?}} for every blob of the memory. */
export function memoryToRow(m, files = {}) {
  const { id, childId, type, title, caption, date, ...rest } = m;
  return { id, child_id: childId, type, title: str(title, 200), caption: str(caption, 4000), date, details: rest, files };
}

export function rowToMemory(r) {
  return { ...(r.details || {}), id: r.id, childId: r.child_id, type: r.type, title: r.title || '', caption: r.caption || '', date: r.date };
}

/** Where a blob lives in the family archive: "<child id>/<blob id>" unless the record names a path. */
export function blobPath(rec, childId) {
  if (rec.path) return rec.path;
  const owner = rec.childId || childId;
  return owner ? `${owner}/${rec.id}` : null;
}
