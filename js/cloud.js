// Family archive: sign-in, two-way sync and sharing per child, over Supabase's plain HTTP API.
// The device stays the working copy. Every local change is noted in the outbox and sent when possible;
// changes made by other family members are pulled in. Everyone attached to a child has the same rights.
import * as db from './db.js';
import { childToRow, rowToChild, memoryToRow, rowToMemory, memoryBlobIds, blobPath } from './model.js';

const config = {
  url: 'https://tgulcckyhotwenurtztg.supabase.co',
  key: 'sb_publishable_tLBBh_y4ZaGZnXXUAVcbwQ_sAcKa4ip', // public key: access is decided by the signed-in user
  bucket: 'art',
};
if (globalThis.__tziyuronCloud) Object.assign(config, globalThis.__tziyuronCloud); // tests point at a stand-in server
const SESSION_KEY = 'tziyuron-session';
const SYNCED_STORES = new Set(['children', 'memories', 'blobs']);
const EAGER_ROLES = new Set(['thumb', 'avatar']);

let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }

const listeners = new Set();
const status = { syncing: false, pending: 0, error: '', lastSyncAt: 0 };
function emit(change = {}) { for (const fn of listeners) fn({ ...status, ...change }); }
/** fn({syncing, pending, error, lastSyncAt, dataChanged?}) after every sync step. */
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getStatus() { return { ...status }; }

/** Tests point the client at a stand-in server. */
export function configure(patch) { Object.assign(config, patch); }
export function user() { return session ? session.user : null; }
export function signedIn() { return !!session; }

// ---------- HTTP ----------
export class CloudError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

function saveSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked */ }
}

function sessionFrom(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user.id, email: data.user.email },
  };
}

async function parse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || `HTTP ${res.status}`;
    throw new CloudError(String(msg), res.status, data && (data.error_code || data.code));
  }
  return data;
}

async function authCall(path, body, token = null) {
  const res = await fetch(config.url + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return parse(res);
}

let refreshing = null;
async function freshToken() {
  if (!session) throw new CloudError('not signed in', 401);
  if (session.expires_at - Date.now() > 60000) return session.access_token;
  if (!refreshing) {
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((data) => { saveSession(sessionFrom(data)); })
      .catch((err) => { if (err.status && err.status < 500) saveSession(null); throw err; })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  return session.access_token;
}

async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await freshToken();
  const isBlob = body instanceof Blob;
  const res = await fetch(config.url + path, {
    method,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !isBlob ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (isBlob ? body : JSON.stringify(body)),
  });
  if (raw) {
    if (!res.ok) await parse(res);
    return res;
  }
  return parse(res);
}

const rest = (path, opts) => call('/rest/v1/' + path, opts);
const REP = { Prefer: 'return=representation' };
const enc = encodeURIComponent;
const storagePath = (path) => path.split('/').map(enc).join('/');

// ---------- Account ----------
export async function signIn(email, password) {
  const data = await authCall('token?grant_type=password', { email, password });
  saveSession(sessionFrom(data));
  await seedOutbox();
  return session.user;
}

/** Returns {user} when the account is ready, or {confirm: true} when the email must be confirmed first. */
export async function signUp(email, password, backTo = '') {
  const data = await authCall(backTo ? `signup?redirect_to=${encodeURIComponent(backTo)}` : 'signup', { email, password });
  if (data && data.access_token) {
    saveSession(sessionFrom(data));
    await seedOutbox();
    return { user: session.user };
  }
  return { confirm: true };
}

/** Sends the account's email a link that opens `backTo` with a one-time recovery token. Says nothing about whether the account exists. */
export async function recoverPassword(email, backTo) {
  await authCall(`recover?redirect_to=${encodeURIComponent(backTo)}`, { email });
}

/**
 * What an email link brought back in the address: '#access_token=…&type=recovery' or '#error=…'.
 * Returns { type, access_token, refresh_token, expires_in } | { error } | null.
 */
export function readAuthHash(hash) {
  const h = String(hash || '').replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error|error_code)=/.test(h)) return null;
  const q = new URLSearchParams(h);
  if (q.get('error') || q.get('error_code')) return { error: q.get('error_code') || q.get('error') };
  if (!q.get('access_token')) return null;
  return { type: q.get('type') || '', access_token: q.get('access_token'), refresh_token: q.get('refresh_token') || '', expires_in: Number(q.get('expires_in')) || 3600 };
}

/** Signs in with the token of a confirmation link (a new account whose email was just confirmed). */
export async function adoptLink(link) {
  const res = await fetch(config.url + '/auth/v1/user', { headers: { apikey: config.key, Authorization: `Bearer ${link.access_token}` } });
  const me = await parse(res);
  saveSession(sessionFrom({ access_token: link.access_token, refresh_token: link.refresh_token, expires_in: link.expires_in, user: me }));
  await seedOutbox();
  return session.user;
}

/** Sets a new password with the token of a recovery link, and only then signs in on this device. */
export async function finishRecovery(link, password) {
  const res = await fetch(config.url + '/auth/v1/user', {
    method: 'PUT',
    headers: { apikey: config.key, Authorization: `Bearer ${link.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const me = await parse(res);
  saveSession(sessionFrom({ access_token: link.access_token, refresh_token: link.refresh_token, expires_in: link.expires_in, user: me }));
  await seedOutbox();
  return session.user;
}

/** Is this the signed-in account's password? Changes nothing: used to let a parent reset a forgotten kids-mode code. */
export async function verifyPassword(password) {
  if (!session || !session.user.email) return false;
  try { await authCall('token?grant_type=password', { email: session.user.email, password }); return true; } catch (err) {
    if (err instanceof TypeError) throw err;
    return false;
  }
}

export async function signOut() {
  const token = session && session.access_token;
  saveSession(null);
  status.error = '';
  emit();
  if (token) { try { await authCall('logout', {}, token); } catch { /* already signed out */ } }
}

/** First sign-in on this device: everything already saved here goes to the family archive. */
async function seedOutbox() {
  const flag = `tziyuron-seeded-${session.user.id}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* ignore */ }
  const [children, memories, blobs, synced] = await Promise.all(
    [db.getAll('children'), db.getAll('memories'), db.getAll('blobs'), db.getAll('synced')]);
  const known = new Set(synced.map((s) => s.id));
  const items = [];
  for (const [store, list] of [['children', children], ['memories', memories], ['blobs', blobs]]) {
    for (const rec of list) if (!known.has(`${store}:${rec.id}`)) items.push([store, rec]);
  }
  await note('put', items);
  try { localStorage.setItem(flag, '1'); } catch { /* ignore */ }
}

// ---------- Outbox ----------
const keyOf = (store, id) => `${store}:${id}`;

async function childOfBlob(rec) {
  if (rec.childId) return rec.childId;
  const m = rec.memoryId ? await db.get('memories', rec.memoryId) : null;
  return m ? m.childId : null;
}

async function note(kind, items) {
  if (kind === 'wipe') { saveSession(null); return; }
  const entries = [];
  for (const [store, value] of items) {
    if (!SYNCED_STORES.has(store)) continue;
    if (kind === 'put') {
      entries.push(['outbox', { id: keyOf(store, value.id), store, rid: value.id, op: 'put', at: Date.now() }]);
    } else {
      const entry = { id: keyOf(store, value), store, rid: value, op: 'del', at: Date.now() };
      if (store === 'blobs') {
        const rec = await db.get('blobs', value);
        entry.path = rec ? blobPath(rec, await childOfBlob(rec)) : null;
      }
      entries.push(['outbox', entry]);
    }
  }
  if (!entries.length) return;
  await db.putMany(entries, { silent: true });
  status.pending = (await db.getAll('outbox')).length;
  emit();
  scheduleSync();
}
db.setHook(note);

let timer = null;
function scheduleSync(delay = 1500) {
  if (!session) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync().catch(() => {}); }, delay);
}

// ---------- Push ----------
/**
 * Update the row, or create it when the archive never had it. A row the archive did have and no longer
 * shows was deleted by another family member: the deletion wins, and null is returned.
 */
async function upsert(table, row, known) {
  const stamped = { ...row, updated_at: new Date().toISOString() };
  const { id, ...patch } = stamped;
  let rows = await rest(`${table}?id=eq.${enc(id)}`, { method: 'PATCH', body: patch, headers: REP });
  if (rows && rows.length) return rows[0];
  if (known) return null;
  rows = await rest(table, { method: 'POST', body: stamped, headers: REP });
  return rows[0];
}

async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  await call(`/storage/v1/object/${config.bucket}`, { method: 'DELETE', body: { prefixes: list } });
}

async function listFiles(prefix) {
  const out = [];
  for (const folder of [prefix, `${prefix}/anim`]) {
    for (let offset = 0; ; offset += 1000) {
      const rows = await call(`/storage/v1/object/list/${config.bucket}`, { method: 'POST', body: { prefix: folder, limit: 1000, offset } });
      for (const r of rows || []) if (r.id) out.push(`${folder}/${r.name}`);
      if (!rows || rows.length < 1000) break;
    }
  }
  return out;
}

// ---------- Files follow their drawing ----------
// A file lives in the folder of its drawing's child. When a drawing is moved to another child, its files have to
// move too, or everyone else looks in the new folder and finds a drawing with no picture (found 20/11/2026: two
// drawings moved right after saving). The same pass sends again a file that this device holds and the archive lacks.
let mendWanted = true; // once per opening of the app, and after every drawing that was sent

async function mendFiles() {
  const [children, memories, outbox] = await Promise.all([db.getAll('children'), db.getAll('memories'), db.getAll('outbox')]);
  const pending = new Set(outbox.map((e) => e.id));
  const where = new Map(); // file id -> the child folder it is in
  for (const c of children) {
    if (pending.has(keyOf('children', c.id))) continue; // not in the archive yet
    for (const path of await listFiles(c.id)) {
      const [folder, name, deeper] = path.split('/');
      if (!deeper) where.set(name, folder);
    }
  }
  const known = new Set(children.map((c) => c.id));
  const again = [];
  let moved = 0;
  for (const m of memories) {
    if (!known.has(m.childId) || pending.has(keyOf('memories', m.id))) continue;
    for (const id of memoryBlobIds(m)) {
      const rec = await db.get('blobs', id);
      if (!rec || rec.path || rec.childId || pending.has(keyOf('blobs', id))) continue;
      const at = where.get(id);
      if (at === m.childId) continue;
      if (at) {
        try {
          await call('/storage/v1/object/move', { method: 'POST', body: { bucketId: config.bucket, sourceKey: `${at}/${id}`, destinationKey: `${m.childId}/${id}` } });
          moved += 1;
          continue;
        } catch (err) {
          if (!rec.blob) throw err; // nothing here to send instead: tried again on the next opening
        }
      }
      if (rec.blob) again.push(['blobs', rec]);
    }
  }
  if (moved) sentFiles += moved; // the backup copies them under the right child
  if (again.length) await note('put', again);
  return again.length > 0;
}

async function filesOf(m) {
  const files = {};
  for (const id of memoryBlobIds(m)) {
    const rec = await db.get('blobs', id);
    if (!rec) continue;
    files[id] = { type: rec.type, role: rec.role, ...(rec.path ? { path: rec.path } : {}) };
  }
  return files;
}

async function pushEntry(e) {
  const mark = (rev) => db.put('synced', { id: e.id, rev: rev || '' }, { silent: true });
  const unmark = () => db.delMany([['synced', e.id]], { silent: true });
  if (e.op === 'put') {
    const rec = await db.get(e.store, e.rid);
    if (!rec) return;
    const known = !!(await db.get('synced', e.id));
    if (e.store === 'children') {
      const row = await upsert('art_children', childToRow(rec), known);
      if (row) await mark(row.updated_at); // a child that is gone is cleared by the pull that follows
    } else if (e.store === 'memories') {
      if (memoryBlobIds(rec).some((id) => unsent.has(id))) throw new Error('the files of this drawing are not in the archive yet');
      const row = await upsert('art_memories', memoryToRow(rec, await filesOf(rec)), known);
      if (row) { await mark(row.updated_at); mendWanted = true; }
      else { await dropLocalMemory(rec); return true; }
    } else if (rec.blob) {
      const path = blobPath(rec, await childOfBlob(rec));
      if (!path) return;
      await call(`/storage/v1/object/${config.bucket}/${storagePath(path)}`, {
        method: 'POST', body: rec.blob, headers: { 'Content-Type': rec.type || 'application/octet-stream', 'x-upsert': 'true' },
      });
      await mark();
      sentFiles += 1;
    }
  } else if (e.store === 'memories') {
    await rest(`art_memories?id=eq.${enc(e.rid)}`, { method: 'DELETE' });
    await unmark();
  } else if (e.store === 'blobs') {
    await removeFiles([e.path]);
    await unmark();
  } else {
    try { await removeFiles(await listFiles(e.rid)); } catch { /* files of a child that is already gone */ }
    await rest(`art_children?id=eq.${enc(e.rid)}`, { method: 'DELETE' });
    await unmark();
  }
}

// Children first (files and memories need them), deletions last.
const ORDER = ['put:children', 'put:blobs', 'put:memories', 'del:memories', 'del:blobs', 'del:children'];

let sentFiles = 0; // files sent to the family archive since the backup was last told
let unsent = new Set(); // files whose sending failed in this round: their drawing waits for them

async function push() {
  const entries = await db.getAll('outbox');
  entries.sort((a, b) => ORDER.indexOf(`${a.op}:${a.store}`) - ORDER.indexOf(`${b.op}:${b.store}`) || a.at - b.at);
  let firstError = null;
  let changed = false;
  unsent = new Set();
  for (const e of entries) {
    try {
      if (await pushEntry(e)) changed = true;
      const now = await db.get('outbox', e.id);
      if (now && now.at === e.at) await db.delMany([['outbox', e.id]], { silent: true });
    } catch (err) {
      if (e.op === 'put' && e.store === 'blobs') unsent.add(e.rid);
      if (!firstError) firstError = err;
      if (!session || err.status === 401) break;
    }
  }
  if (firstError) throw firstError;
  return changed;
}

// ---------- Pull ----------
async function dropLocalMemory(m) {
  const ops = [['memories', m.id], ['synced', keyOf('memories', m.id)]];
  for (const b of memoryBlobIds(m)) ops.push(['blobs', b], ['synced', keyOf('blobs', b)]);
  await db.delMany(ops, { silent: true });
}

async function pull() {
  let changed = false;
  const [outbox, syncedList] = await Promise.all([db.getAll('outbox'), db.getAll('synced')]);
  const pending = new Set(outbox.map((e) => e.id));
  const synced = new Map(syncedList.map((s) => [s.id, s.rev]));

  // Children.
  const childRows = await rest('art_children?select=*&order=created_at');
  const remoteChildren = new Set(childRows.map((r) => r.id));
  for (const r of childRows) {
    const key = keyOf('children', r.id);
    if (pending.has(key) || synced.get(key) === r.updated_at) continue;
    const prev = await db.get('children', r.id);
    const child = rowToChild(r, prev);
    const ops = [['children', child], ['synced', { id: key, rev: r.updated_at }]];
    if (child.avatar && !(await db.get('blobs', child.avatar))) {
      ops.push(['blobs', { id: child.avatar, type: 'image/jpeg', role: 'avatar', childId: child.id, blob: null }]);
    }
    await db.putMany(ops, { silent: true });
    changed = true;
  }

  // Memories: compare versions first, then fetch only what changed.
  const versions = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`art_memories?select=id,updated_at&order=id&limit=1000&offset=${from}`);
    versions.push(...page);
    if (page.length < 1000) break;
  }
  const remoteMemories = new Set(versions.map((v) => v.id));
  const wanted = versions.filter((v) => {
    const key = keyOf('memories', v.id);
    return !pending.has(key) && synced.get(key) !== v.updated_at;
  }).map((v) => v.id);
  for (let i = 0; i < wanted.length; i += 40) {
    const rows = await rest(`art_memories?select=*&id=in.(${wanted.slice(i, i + 40).join(',')})`);
    for (const r of rows) {
      const m = rowToMemory(r);
      const prev = await db.get('memories', m.id);
      const ops = [['memories', m], ['synced', { id: keyOf('memories', m.id), rev: r.updated_at }]];
      const keep = new Set(memoryBlobIds(m));
      for (const id of keep) {
        if (await db.get('blobs', id)) continue;
        const f = (r.files || {})[id] || {};
        ops.push(['blobs', { id, type: f.type || 'application/octet-stream', role: f.role || 'media', memoryId: m.id, ...(f.path ? { path: f.path } : {}), blob: null }]);
      }
      await db.putMany(ops, { silent: true });
      const gone = prev ? memoryBlobIds(prev).filter((id) => !keep.has(id)) : [];
      if (gone.length) await db.delMany(gone.flatMap((id) => [['blobs', id], ['synced', keyOf('blobs', id)]]), { silent: true });
      changed = true;
    }
  }

  // Removed by another family member (or the child is no longer shared with this account).
  const [localChildren, localMemories] = await Promise.all([db.getAll('children'), db.getAll('memories')]);
  const goneChildren = new Set(localChildren
    .filter((c) => synced.has(keyOf('children', c.id)) && !remoteChildren.has(c.id) && !pending.has(keyOf('children', c.id)))
    .map((c) => c.id));
  for (const m of localMemories) {
    const key = keyOf('memories', m.id);
    const removed = synced.has(key) && !remoteMemories.has(m.id) && !pending.has(key);
    if (removed || goneChildren.has(m.childId)) { await dropLocalMemory(m); changed = true; }
  }
  for (const c of localChildren) {
    if (!goneChildren.has(c.id)) continue;
    const ops = [['children', c.id], ['synced', keyOf('children', c.id)]];
    if (c.avatar) ops.push(['blobs', c.avatar]);
    await db.delMany(ops, { silent: true });
    changed = true;
  }

  if (await fetchEager()) changed = true;
  return changed;
}

async function download(rec) {
  const path = blobPath(rec, await childOfBlob(rec));
  if (!path) return null;
  const res = await call(`/storage/v1/object/authenticated/${config.bucket}/${storagePath(path)}`, { raw: true });
  const data = await res.blob();
  const type = rec.type && rec.type !== 'application/octet-stream' ? rec.type : (data.type || rec.type);
  const full = { ...rec, type, blob: data.type === type ? data : new Blob([data], { type }) };
  await db.put('blobs', full, { silent: true });
  await db.put('synced', { id: keyOf('blobs', rec.id), rev: '' }, { silent: true });
  return full;
}

/** Small pictures (wall thumbnails, avatars) come down right away; the rest when first opened. */
async function fetchEager() {
  const todo = (await db.getAll('blobs')).filter((b) => !b.blob && EAGER_ROLES.has(b.role));
  let got = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const rec = todo[next++];
      try { if (await download(rec)) got++; } catch { /* stays a placeholder, tried again next sync */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return got > 0;
}

const inFlight = new Map();
/** The blob record with its data, fetched from the family archive when this device does not hold it yet. */
export async function ensureBlob(id) {
  const rec = await db.get('blobs', id);
  if (!rec || rec.blob || !session) return rec;
  if (!inFlight.has(id)) {
    inFlight.set(id, download(rec).catch(() => null).finally(() => inFlight.delete(id)));
  }
  return (await inFlight.get(id)) || rec;
}

// ---------- Sync ----------
let running = null;
let again = false;

function describe(err) {
  if (err instanceof TypeError) return 'אין חיבור לרשת';
  if (err && err.status === 401) return 'צריך להיכנס מחדש';
  return 'הסנכרון נתקע. ננסה שוב בעוד רגע';
}

/** Send local changes, then bring in the family's. Resolves to true when local data changed. */
export function sync() {
  if (!session) return Promise.resolve(false);
  if (running) { again = true; return running; }
  running = (async () => {
    let changed = false;
    status.syncing = true;
    emit();
    try {
      do {
        again = false;
        if (await push()) changed = true;
        if (await pull()) changed = true;
        if (mendWanted) {
          mendWanted = false;
          try { if (await mendFiles()) again = true; } catch (err) { mendWanted = true; console.warn('mend', err); }
        }
      } while (again);
      status.error = '';
      status.lastSyncAt = Date.now();
      // New files are in the archive: tell the backup now, instead of waiting for its 5-minute round.
      if (sentFiles) { sentFiles = 0; backupSweep().catch(() => {}); }
    } catch (err) {
      console.warn('sync', err);
      status.error = describe(err);
    } finally {
      status.syncing = false;
      status.pending = (await db.getAll('outbox')).length;
      running = null;
      emit({ dataChanged: changed });
    }
    return changed;
  })();
  return running;
}

// ---------- Family members of a child ----------
export function members(childId) {
  return rest(`art_child_members?select=user_id,display_name,created_at&child_id=eq.${enc(childId)}&order=created_at`);
}

export function removeMember(childId, userId) {
  return rest(`art_child_members?child_id=eq.${enc(childId)}&user_id=eq.${enc(userId)}`, { method: 'DELETE' });
}

/** A one-time invitation code for a child, valid for 7 days. */
export async function createInvite(childId) {
  const rows = await rest('art_invites', { method: 'POST', body: { child_id: childId }, headers: REP });
  return rows[0].code;
}

/** Attach the signed-in user to the invitation's child, or (a code that starts with F) to all the inviter's children. Returns the ids. */
export async function acceptInvite(code, myName) {
  const family = /^F/.test(code);
  const got = await rest(family ? 'rpc/art_accept_family_invite' : 'rpc/art_accept_invite', { method: 'POST', body: { invite_code: code, my_name: myName || null } });
  return Array.isArray(got) ? got : [got];
}

// ---------- One invitation for all the children ----------
/** A one-time invitation to all my children, valid for 7 days. Only the name is kept on the server. */
export async function createFamilyInvite(name) {
  const rows = await rest('art_family_invites', { method: 'POST', body: { invitee_name: name }, headers: REP });
  return rows[0];
}

/** Who was invited and who joined, newest first. Null when the server does not have this yet. */
export async function familyInvites() {
  try {
    return await rest('art_family_invites?select=code,invitee_name,created_at,expires_at,used_at&order=created_at.desc&limit=50');
  } catch (err) {
    if (err && (err.status === 404 || /PGRST20[25]|42P01/.test(String(err.code || '')))) return null;
    throw err;
  }
}

export function cancelFamilyInvite(code) {
  return rest(`art_family_invites?code=eq.${enc(code)}`, { method: 'DELETE' });
}

// ---------- Animation jobs ----------
/** Ask for an animation of a drawing that is already in the family archive. Returns the job row. */
export async function requestAnimation(memory, hint = '') {
  const body = { memory_id: memory.id, child_id: memory.childId, source_path: `${memory.childId}/${memory.image}` };
  if (hint) {
    // The chosen movement travels with the request. A server that does not have the column yet (PGRST204)
    // still gets the request, without it.
    try { return (await rest('art_animation_jobs', { method: 'POST', headers: REP, body: { ...body, hint } }))[0]; } catch (err) {
      if (!/PGRST204|hint/.test(String((err && (err.code || err.message)) || ''))) throw err;
    }
  }
  return (await rest('art_animation_jobs', { method: 'POST', headers: REP, body }))[0];
}

export function jobs(ids) {
  if (!ids.length) return Promise.resolve([]);
  return rest(`art_animation_jobs?select=id,status,result_path,error&id=in.(${ids.map(enc).join(',')})`);
}

// ---------- Preferences kept with the account (the same on every device) ----------
const PREFS_KEY = 'tziyuron';
export async function getPrefs() {
  const u = await call('/auth/v1/user');
  const p = u && u.user_metadata && u.user_metadata[PREFS_KEY];
  return p && typeof p === 'object' ? p : {};
}
export async function setPrefs(prefs) {
  await call('/auth/v1/user', { method: 'PUT', body: { data: { [PREFS_KEY]: prefs } } });
}

// ---------- Automatic title ----------
/**
 * A short Hebrew title for a drawing already in the family archive.
 * Paid route: resolves to {title} (null when the picture is not clear).
 * Free route (picture = small JPEG as base64): resolves to {queued: true, eta} and the title arrives by sync.
 */
export async function suggestTitle(memoryId, { route = 'paid', picture = null, want = 'title' } = {}) {
  const body = { memory_id: memoryId, ...(want === 'motions' ? { want } : {}), ...(route === 'free' ? { route, picture } : {}) };
  const data = (await call('/functions/v1/art-title', { method: 'POST', body })) || {};
  if (data.queued) return { queued: true, eta: Number(data.eta_seconds) || 60 };
  const turn = [90, 180, 270].includes(data.turn) ? data.turn : 0;
  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null, turn,
    motions: Array.isArray(data.motions) ? data.motions : [], reason: data.reason || '',
  };
}

// ---------- Backup to the owner's pCloud ----------
/**
 * How the automatic backup stands for the children this account is attached to:
 * {connected, owner, total, done, failed, last, problem}, or null when the server has no backup yet.
 */
export async function backupStatus() {
  try {
    const s = await rest('rpc/art_backup_status', { method: 'POST', body: {} });
    if (!s || typeof s !== 'object') return null;
    return {
      connected: !!s.connected, owner: !!s.owner, problem: !!s.problem,
      total: Number(s.total) || 0, done: Number(s.done) || 0, failed: Number(s.failed) || 0,
      last: s.last ? Date.parse(s.last) || 0 : 0,
    };
  } catch (err) {
    if (err && (err.status === 404 || err.code === 'PGRST202')) return null;
    throw err;
  }
}

const backupCall = (body) => call('/functions/v1/art-backup', { method: 'POST', body });

/** Asks the server to copy what is not in pCloud yet. With retry, files that failed are tried again. */
export async function backupSweep({ retry = false } = {}) {
  if (!session) return null;
  return backupCall({ action: 'sweep', ...(retry ? { retry: true } : {}) });
}

/** The owner starts the one-time connection: resolves to {url} (pCloud's approval page) or {reason}. */
export async function backupConnect() {
  const data = (await backupCall({ action: 'connect' })) || {};
  return typeof data.url === 'string' && data.url.startsWith('https://my.pcloud.com/') ? { url: data.url } : { reason: data.reason || 'failed' };
}

export async function backupDisconnect() {
  const data = (await backupCall({ action: 'disconnect' })) || {};
  return !!data.ok;
}
