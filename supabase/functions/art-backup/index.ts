// ציורון: keeps a second copy of everything the family uploads in the owner's own pCloud.
//   POST { action: 'sweep' }      - copy the files that are not in pCloud yet. Called every 5 minutes by the
//                                   database, and by the app after an upload. Carries no data. With a member's
//                                   token and { retry: true } the files that failed are tried again.
//   POST { action: 'connect' }    - the owner (their token) asks to connect: returns pCloud's approval page.
//   POST { action: 'disconnect' } - the owner removes the connection. The copies stay in pCloud.
//   GET  ?code=&state=            - pCloud sends the owner back here after the approval; the access is stored
//                                   and the browser goes back to the app.
// Secrets, set by the owner in the dashboard: PCLOUD_CLIENT_ID, PCLOUD_CLIENT_SECRET (from the owner's pCloud
// app). Optional: ART_SITE_URL (where to send the browser back to).
// The pCloud access is kept in a table that only this function can read. It never reaches the app.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { HOSTS, ROOT_NAME, pcloud, sweep } from './core.js';

const BUCKET = 'art';
const SITE = Deno.env.get('ART_SITE_URL') ?? 'https://lironwby-cyber.github.io/tziyuron/';
const SELF = `${Deno.env.get('SUPABASE_URL')}/functions/v1/art-backup`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) => {
  // Counts and reasons only: never a file name, a title or the access.
  console.log(`art-backup: ${JSON.stringify(body).slice(0, 300)}`);
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
};
const back = (state: string) => new Response(null, { status: 302, headers: { Location: `${SITE}#/settings/backup-${state}` } });
const nowIso = () => new Date().toISOString();

const store = {
  async config() { return (await db.from('art_backup_config').select('*').eq('id', 1).maybeSingle()).data; },
  async setConfig(patch: Record<string, unknown>) { await db.from('art_backup_config').update(patch).eq('id', 1); },
  async claim(n: number) {
    const { data, error } = await db.rpc('art_backup_claim', { n });
    if (error) throw new Error('claim failed');
    return data ?? [];
  },
  async mark(path: string, patch: Record<string, unknown>) {
    await db.from('art_backup_files').update({ ...patch, updated_at: nowIso() }).eq('path', path);
  },
  // Taken over again by the "run that died" rule (10 minutes), so: offered again in about 5 minutes.
  async postpone(path: string) {
    await db.from('art_backup_files').update({ updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }).eq('path', path);
  },
  async release(paths: string[]) {
    if (paths.length) await db.from('art_backup_files').delete().in('path', paths).eq('status', 'working');
  },
  async child(id: string) {
    if (!UUID.test(id)) return null;
    return (await db.from('art_children').select('id, name, birth_date, avatar_path').eq('id', id).maybeSingle()).data;
  },
  async children() { return (await db.from('art_children').select('id, name, birth_date, avatar_path')).data ?? []; },
  async folder(childId: string) {
    return (await db.from('art_backup_folders').select('folder_id').eq('child_id', childId).maybeSingle()).data?.folder_id ?? null;
  },
  async saveFolder(childId: string, folderId: number) {
    await db.from('art_backup_folders').upsert({ child_id: childId, folder_id: folderId });
  },
  async indexAt(childId: string) {
    return (await db.from('art_backup_folders').select('index_at').eq('child_id', childId).maybeSingle()).data?.index_at ?? null;
  },
  async setIndexAt(childId: string, at: string) { await db.from('art_backup_folders').update({ index_at: at }).eq('child_id', childId); },
  async memoryOfFile(childId: string, fileId: string) {
    return (await db.from('art_memories').select('id, title, date, files')
      .eq('child_id', childId).contains('files', { [fileId]: {} }).limit(1).maybeSingle()).data;
  },
  async memoryOfJob(jobId: string) {
    if (!UUID.test(jobId)) return null;
    const job = (await db.from('art_animation_jobs').select('memory_id').eq('id', jobId).maybeSingle()).data;
    if (!job) return null;
    return (await db.from('art_memories').select('id, title, date').eq('id', job.memory_id).maybeSingle()).data;
  },
  async lastChange(childId: string) {
    return (await db.from('art_memories').select('updated_at').eq('child_id', childId)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()).data?.updated_at ?? null;
  },
  async memories(childId: string) {
    return (await db.from('art_memories').select('id, type, title, caption, date, details, files, created_at, updated_at')
      .eq('child_id', childId).order('date')).data ?? [];
  },
  async download(path: string) {
    const { data, error } = await db.storage.from(BUCKET).download(path);
    return error ? null : data;
  },
};

/** The signed-in user behind a call, or null. */
async function caller(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.split('.').length !== 3) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

async function connect(req: Request) {
  const user = await caller(req);
  const cfg = await store.config();
  if (!user || !cfg || cfg.owner !== user.id) return json({ ok: false, reason: 'only the owner connects the backup' }, 403);
  const client = Deno.env.get('PCLOUD_CLIENT_ID');
  if (!client || !Deno.env.get('PCLOUD_CLIENT_SECRET')) return json({ ok: false, reason: 'not configured: the pCloud app keys are missing' });
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await db.from('art_backup_oauth').delete().lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const saved = await db.from('art_backup_oauth').insert({ state, user_id: user.id });
  if (saved.error) return json({ ok: false, reason: 'failed' }, 500);
  const q = new URLSearchParams({ client_id: client, response_type: 'code', redirect_uri: SELF, state });
  return new Response(JSON.stringify({ ok: true, url: `https://my.pcloud.com/oauth2/authorize?${q}` }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function callback(url: URL) {
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (!/^[0-9a-f]{64}$/.test(state) || !code || code.length > 500) return back('refused');
  // The state is used once, within 15 minutes, and only the owner could have made it.
  const { data: asked } = await db.from('art_backup_oauth').delete().eq('state', state).select('user_id, created_at').maybeSingle();
  const cfg = await store.config();
  if (!asked || !cfg || asked.user_id !== cfg.owner || Date.now() - new Date(asked.created_at).getTime() > 15 * 60 * 1000) return back('refused');
  const named = url.searchParams.get('hostname') ?? '';
  const host = HOSTS.includes(named) ? named : url.searchParams.get('locationid') === '2' ? 'eapi.pcloud.com' : 'api.pcloud.com';
  const q = new URLSearchParams({
    client_id: Deno.env.get('PCLOUD_CLIENT_ID') ?? '', client_secret: Deno.env.get('PCLOUD_CLIENT_SECRET') ?? '', code,
  });
  let token = '';
  try {
    // As pCloud's guide shows it: the three values as the address's parameters.
    const res = await fetch(`https://${host}/oauth2_token?${q}`);
    const body = await res.json();
    if (body.result !== 0 && body.result !== undefined) console.log(`art-backup: token exchange answered ${body.result}`);
    token = typeof body.access_token === 'string' ? body.access_token : '';
  } catch { /* handled below */ }
  if (!token) return back('failed');
  const root = await pcloud(fetch, host, token).folder(0, ROOT_NAME);
  if (root.result !== 0 || !root.metadata?.folderid) {
    console.log(`art-backup: the folder could not be made (${root.result})`);
    return back('failed');
  }
  await store.setConfig({ access_token: token, api_host: host, root_folder_id: root.metadata.folderid, connected_at: nowIso(), last_error: null });
  // Files that gave up while the connection was broken get a fresh start.
  await db.from('art_backup_files').update({ attempts: 0, updated_at: new Date(0).toISOString() }).eq('status', 'failed');
  console.log('art-backup: connected');
  return back('ok');
}

async function disconnect(req: Request) {
  const user = await caller(req);
  const cfg = await store.config();
  if (!user || !cfg || cfg.owner !== user.id) return json({ ok: false, reason: 'only the owner disconnects the backup' }, 403);
  await store.setConfig({ access_token: null, api_host: null, root_folder_id: null, connected_at: null, last_error: null });
  return json({ ok: true });
}

async function runSweep(req: Request, retry: boolean) {
  if (retry) {
    const user = await caller(req);
    if (user) {
      const { data: mine } = await db.from('art_child_members').select('child_id').eq('user_id', user.id);
      const ids = (mine ?? []).map((m) => m.child_id);
      if (ids.length) {
        await db.from('art_backup_files').update({ attempts: 0, updated_at: new Date(0).toISOString() })
          .eq('status', 'failed').in('child_id', ids);
      }
    }
  }
  // The copy goes on after the answer, so that a caller that hangs up early (the database's timed job waits
  // 5 seconds) never cuts a file in the middle. The app reads the progress from the status.
  const cfg = await store.config();
  if (!cfg?.access_token) return json({ ok: false, reason: 'not connected' });
  const work = sweep(store, fetch, { budgetMs: 60_000 })
    .then((out) => console.log(`art-backup: ${JSON.stringify(out)}`))
    .catch((err) => console.log(`art-backup: sweep failed: ${String(err?.message ?? err).slice(0, 120)}`));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(work); return json({ ok: true, started: true }); }
  await work;
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method === 'GET') return callback(new URL(req.url));
  if (req.method !== 'POST') return json({ ok: false }, 405);
  let body: { action?: string; retry?: boolean } = {};
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }
  try {
    if (body.action === 'sweep') return await runSweep(req, body.retry === true);
    if (body.action === 'connect') return await connect(req);
    if (body.action === 'disconnect') return await disconnect(req);
  } catch (err) {
    return json({ ok: false, reason: 'failed', detail: String((err as Error)?.message ?? err).slice(0, 120) }, 500);
  }
  return json({ ok: false }, 400);
});
