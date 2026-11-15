// IndexedDB storage. Everything is kept on the device; js/cloud.js copies it to the family archive when signed in.
const DB_NAME = 'tziyuron';
const VERSION = 2;
const DATA_STORES = ['children', 'memories', 'blobs', 'settings'];
// outbox: local changes not yet sent. synced: what the family archive is known to hold.
const STORES = [...DATA_STORES, 'outbox', 'synced'];

/** Called before every non-silent write: hook('put' | 'del', items). Set by the sync engine. */
let hook = null;
export function setHook(fn) { hook = fn; }

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, id) {
  if (!id) return undefined;
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(id));
}

export async function put(store, value, { silent = false } = {}) {
  if (hook && !silent) await hook('put', [[store, value]]);
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
  return value;
}

/** Write several records across stores in one transaction: [[store, value], ...]. */
export async function putMany(items, { silent = false } = {}) {
  if (hook && !silent && items.length) await hook('put', items);
  const db = await open();
  const stores = [...new Set(items.map(([s]) => s))];
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  for (const [s, v] of items) tx.objectStore(s).put(v);
  await done(tx);
}

/** Delete several records across stores in one transaction: [[store, id], ...]. */
export async function delMany(items, { silent = false } = {}) {
  if (hook && !silent && items.length) await hook('del', items);
  const db = await open();
  const stores = [...new Set(items.map(([s]) => s))];
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  for (const [s, id] of items) tx.objectStore(s).delete(id);
  await done(tx);
}

export async function clearAll() {
  const db = await open();
  if (hook) await hook('wipe', []);
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await done(tx);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* not supported */ }
  return null;
}
