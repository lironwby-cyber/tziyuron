// ציורון: the rules of the backup to pCloud, with no Supabase or Deno in them, so that they are tested in Node.
// index.ts hands in a `store` (the database and the private bucket) and the network `fetch`.

export const HOSTS = ['api.pcloud.com', 'eapi.pcloud.com'];
export const ROOT_NAME = 'ציורון';
export const INDEX_NAME = 'רשימת הזיכרונות.json';
const WAIT_FOR_NAME_MS = 15 * 60 * 1000; // a file may arrive a little before its memory; wait before naming it "no name"
const MAX_FILE_BYTES = 150 * 1024 * 1024;

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf',
};
const ROLE_WORD = { original: 'מקור', video: 'הנפשה', voice: 'הקלטה', media: 'קובץ', avatar: 'תמונת פרופיל' };

/** A name that every file system accepts: no slashes, colons, quotes or control characters. */
export function safe(text, max = 60) {
  return String(text ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, max).replace(/[. ]+$/, '');
}

/** "2026-01-01 טיל (מקור) 1a2b3c4d.jpg": the date sorts the folder, the short id keeps two files apart. */
export function fileName({ date, title, role, id, type }) {
  const day = /^\d{4}-\d{2}-\d{2}/.test(String(date ?? '')) ? String(date).slice(0, 10) : '';
  const word = ROLE_WORD[role] || '';
  const name = safe(title) || (role === 'avatar' ? '' : 'ללא שם');
  const short = String(id ?? '').replace(/[^0-9a-z]/gi, '').slice(0, 8);
  const ext = EXT[String(type ?? '').split(';')[0].trim().toLowerCase()] || 'bin';
  return [day, name, word && `(${word})`, short].filter(Boolean).join(' ') + '.' + ext;
}

/** The folder of a child: its name and a short id, so that two children with one name stay apart. */
export const folderName = (child) => `${safe(child.name, 40) || 'ילד'} ${String(child.id).slice(0, 4)}`;

export function pcloud(fetchFn, host, token) {
  if (!HOSTS.includes(host)) throw new Error('unknown pCloud host');
  const call = async (method, params, init = {}) => {
    const q = new URLSearchParams(params).toString();
    const res = await fetchFn(`https://${host}/${method}?${q}`, { ...init, headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { result: -res.status };
    try { return await res.json(); } catch { return { result: -1 }; }
  };
  return {
    folder: (parent, name) => call('createfolderifnotexists', { folderid: String(parent), name }),
    rename: (fileid, name) => call('renamefile', { fileid: String(fileid), toname: name }),
    upload(folderId, name, blob) {
      const form = new FormData();
      form.append('file', blob, name);
      return call('uploadfile', { folderid: String(folderId), nopartial: '1' }, { method: 'POST', body: form });
    },
  };
}

/** pCloud's "who are you" refusals: the connection itself is broken, the files are fine. */
export const isAuthError = (code) => [1000, 2000, 2094, 2095, -401, -403].includes(code);

/** What a file in the bucket is: which memory it belongs to and what to call it. Null = not known yet. */
export async function describe(store, path) {
  const parts = path.split('/');
  const childId = parts[0];
  if (parts.length === 3 && parts[1] === 'anim') {
    const jobId = parts[2].replace(/\.mp4$/, '');
    const m = await store.memoryOfJob(jobId);
    return { childId, role: 'video', id: jobId, type: 'video/mp4', title: m?.title, date: m?.date, known: !!m };
  }
  if (parts.length !== 2) return { childId, role: 'media', id: parts[parts.length - 1], type: '', known: true, odd: true };
  const id = parts[1];
  const child = await store.child(childId);
  if (child && child.avatar_path === path) return { childId, role: 'avatar', id, type: 'image/jpeg', known: true };
  const m = await store.memoryOfFile(childId, id);
  const f = m ? (m.files || {})[id] || {} : {};
  return { childId, role: f.role || 'media', id, type: f.type || '', title: m?.title, date: m?.date, known: !!m };
}

/**
 * One run: copies the next files to pCloud until none are left or the time is up.
 * Returns { ok, copied, failed, skipped, waiting, reason? }.
 */
export async function sweep(store, fetchFn, { now = () => Date.now(), budgetMs = 100_000, batch = 3 } = {}) {
  const started = now();
  const cfg = await store.config();
  if (!cfg || !cfg.access_token || !cfg.api_host || !cfg.root_folder_id) return { ok: false, reason: 'not connected' };
  const api = pcloud(fetchFn, cfg.api_host, cfg.access_token);
  const out = { ok: true, copied: 0, failed: 0, skipped: 0, waiting: 0 };
  const folders = new Map();
  const touched = new Set();

  const folderOf = async (childId) => {
    if (folders.has(childId)) return folders.get(childId);
    let id = await store.folder(childId);
    if (!id) {
      const child = await store.child(childId);
      if (!child) return null;
      const made = await api.folder(cfg.root_folder_id, folderName(child));
      if (made.result !== 0) throw Object.assign(new Error(`folder ${made.result}`), { code: made.result });
      id = made.metadata.folderid;
      await store.saveFolder(childId, id);
    }
    folders.set(childId, id);
    return id;
  };

  const stop = async (code, pending) => {
    await store.release(pending);
    await store.setConfig({ last_error: `pCloud refused the connection (${code})`, last_run_at: new Date(now()).toISOString() });
    return { ...out, ok: false, reason: 'pcloud refused the connection' };
  };

  while (now() - started < budgetMs) {
    const files = await store.claim(batch);
    if (!files.length) break;
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const rest = files.slice(i).map((f) => f.path);
      try {
        const what = await describe(store, file.path);
        if (what.role === 'thumb') { await store.mark(file.path, { status: 'skipped', error: null }); out.skipped += 1; continue; }
        if (!what.known && now() - new Date(file.uploaded_at || 0).getTime() < WAIT_FOR_NAME_MS) {
          await store.postpone(file.path); out.waiting += 1; continue; // offered again in about 5 minutes
        }
        const folderId = await folderOf(what.childId);
        if (!folderId) { await store.mark(file.path, { status: 'skipped', error: 'the child is gone' }); out.skipped += 1; continue; }
        if (Number(file.bytes) > MAX_FILE_BYTES) { await store.mark(file.path, { status: 'failed', error: 'too large for one run' }); out.failed += 1; continue; }
        const blob = await store.download(file.path);
        if (!blob) { await store.mark(file.path, { status: 'failed', error: 'could not be read from the archive' }); out.failed += 1; continue; }
        const name = fileName({ ...what, type: what.type || blob.type });
        const up = await api.upload(folderId, name, blob);
        if (isAuthError(up.result)) return stop(up.result, rest);
        const meta = up.result === 0 && Array.isArray(up.metadata) ? up.metadata[0] : null;
        if (!meta || Number(meta.size) !== blob.size) {
          await store.mark(file.path, { status: 'failed', error: meta ? 'the copy has another size' : `pCloud answered ${up.result}` });
          out.failed += 1; continue;
        }
        if (meta.name && meta.name !== name) await api.rename(meta.fileid, name);
        await store.mark(file.path, { status: 'done', remote_id: meta.fileid, bytes: blob.size, error: null });
        out.copied += 1; touched.add(what.childId);
      } catch (err) {
        if (isAuthError(err && err.code)) return stop(err.code, rest);
        await store.mark(file.path, { status: 'failed', error: String((err && err.message) || err).slice(0, 200) });
        out.failed += 1;
      }
    }
  }

  // The list of memories (names, dates, texts) of every child that changed: without it the files are only files.
  for (const child of await store.children()) {
    if (now() - started > budgetMs + 20_000) break;
    try {
      const changed = await store.lastChange(child.id);
      const indexAt = await store.indexAt(child.id);
      if (!touched.has(child.id) && indexAt && (!changed || new Date(changed) <= new Date(indexAt))) continue;
      if (!changed && !touched.has(child.id)) continue;
      const folderId = await folderOf(child.id);
      if (!folderId) continue;
      const stamp = new Date(now()).toISOString();
      const list = { app: 'ציורון', saved_at: stamp, child, memories: await store.memories(child.id) };
      const blob = new Blob([JSON.stringify(list, null, 1)], { type: 'application/json' });
      const up = await api.upload(folderId, INDEX_NAME, blob);
      if (isAuthError(up.result)) return stop(up.result, []);
      if (up.result === 0) await store.setIndexAt(child.id, stamp);
    } catch { /* the list is tried again on the next run */ }
  }

  await store.setConfig({ last_run_at: new Date(now()).toISOString(), last_error: null });
  return out;
}
