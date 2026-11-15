// A small in-memory stand-in for the Supabase HTTP API, with the same membership rules as the real policies:
// a user sees and changes only children they are attached to. Used by tests/e2e/cloud.mjs.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function startMock(port) {
  const users = new Map(); // email -> {id, password}
  const t = { art_children: [], art_child_members: [], art_memories: [], art_invites: [], art_animation_jobs: [] };
  const files = new Map(); // path -> {type, data}
  const log = [];
  const titles = []; // what the title function answers next (null = not recognised)
  const titleCalls = [];
  const freePictures = [];
  const turns = [];
  const motionSets = []; // movements the naming step answers next
  const wants = [];
  const flags = { hint: false }; // does art_animation_jobs have the hint column yet

  const isMember = (uid, childId) => t.art_child_members.some((m) => m.child_id === childId && m.user_id === uid);
  const childOf = { art_children: (r) => r.id, art_child_members: (r) => r.child_id, art_memories: (r) => r.child_id, art_invites: (r) => r.child_id, art_animation_jobs: (r) => r.child_id };
  const now = () => new Date().toISOString();

  function send(res, status, body, headers = {}) {
    const data = body === undefined ? '' : (Buffer.isBuffer(body) ? body : JSON.stringify(body));
    res.writeHead(status, {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
      'Content-Type': 'application/json', ...headers,
    });
    res.end(data);
  }
  const readBody = (req) => new Promise((resolve) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts))); });
  const tokenFor = (u, email) => ({ access_token: `tok-${u.id}`, refresh_token: `ref-${u.id}`, expires_in: 3600, user: { id: u.id, email } });

  function matcher(query) {
    const tests = [];
    for (const [k, v] of query) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v.startsWith('eq.')) tests.push((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',')); tests.push((r) => set.has(String(r[k]))); }
      else throw new Error('unsupported filter ' + k + '=' + v);
    }
    return (r) => tests.every((f) => f(r));
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      const raw = await readBody(req);
      const json = () => (raw.length ? JSON.parse(raw.toString()) : {});
      log.push(`${req.method} ${path}`);

      if (path === '/__test/state') return send(res, 200, { tables: t, files: [...files.keys()], users: [...users.keys()] });
      if (path === '/__test/user') { const b = json(); users.set(b.email, { id: randomUUID(), password: b.password }); return send(res, 200, {}); }
      if (path === '/__test/finish-job') {
        const b = json();
        const job = t.art_animation_jobs.find((j) => j.id === b.id);
        if (b.status === 'done') {
          job.result_path = `${job.child_id}/anim/${job.id}.mp4`;
          files.set(job.result_path, { type: 'video/mp4', data: Buffer.from(b.data, 'base64') });
        }
        job.status = b.status;
        return send(res, 200, job);
      }

      if (path === '/auth/v1/token') {
        const b = json();
        if (url.searchParams.get('grant_type') === 'password') {
          const u = users.get(b.email);
          if (!u || u.password !== b.password) return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return send(res, 200, tokenFor(u, b.email));
        }
        const entry = [...users].find(([, u]) => `ref-${u.id}` === b.refresh_token);
        return entry ? send(res, 200, tokenFor(entry[1], entry[0])) : send(res, 400, { msg: 'bad refresh token' });
      }
      if (path === '/auth/v1/signup') {
        const b = json();
        if (users.has(b.email)) return send(res, 422, { msg: 'User already registered' });
        const u = { id: randomUUID(), password: b.password };
        users.set(b.email, u);
        return send(res, 200, tokenFor(u, b.email));
      }
      if (path === '/auth/v1/logout') return send(res, 204);

      const auth = (req.headers.authorization || '').replace('Bearer tok-', '');
      const uid = [...users.values()].some((u) => u.id === auth) ? auth : null;
      if (!uid) return send(res, 401, { message: 'JWT missing' });
      if (path === '/auth/v1/user') {
        const me = [...users.values()].find((u) => u.id === uid);
        if (req.method === 'PUT') me.meta = { ...(me.meta || {}), ...(json().data || {}) };
        return send(res, 200, { id: uid, user_metadata: me.meta || {} });
      }

      if (path === '/rest/v1/rpc/art_accept_invite') {
        const b = json();
        const inv = t.art_invites.find((i) => i.code === b.invite_code);
        if (!inv || inv.used_at) return send(res, 400, { message: 'invite is not valid' });
        if (!isMember(uid, inv.child_id)) t.art_child_members.push({ child_id: inv.child_id, user_id: uid, display_name: b.my_name, created_at: now() });
        inv.used_at = now(); inv.used_by = uid;
        return send(res, 200, inv.child_id);
      }

      if (path.startsWith('/rest/v1/')) {
        const name = path.slice('/rest/v1/'.length);
        const rows = t[name];
        if (!rows) return send(res, 404, { message: 'no table ' + name });
        const visible = (r) => isMember(uid, childOf[name](r));
        const match = matcher(url.searchParams);
        const want = req.headers.prefer === 'return=representation';
        if (req.method === 'GET') {
          let out = rows.filter((r) => visible(r) && match(r));
          const off = Number(url.searchParams.get('offset') || 0);
          const lim = Number(url.searchParams.get('limit') || 1e9);
          out = out.slice(off, off + lim);
          const sel = url.searchParams.get('select');
          if (sel && sel !== '*') out = out.map((r) => Object.fromEntries(sel.split(',').map((k) => [k, r[k]])));
          return send(res, 200, out);
        }
        if (req.method === 'POST') {
          const b = json();
          const row = { created_at: now(), updated_at: now(), ...b };
          if (name === 'art_children') {
            if (rows.some((r) => r.id === row.id)) return send(res, 409, { code: '23505', message: 'duplicate key' });
            row.created_by = uid;
            rows.push(row);
            t.art_child_members.push({ child_id: row.id, user_id: uid, display_name: null, created_at: now() });
          } else {
            if (name === 'art_child_members' || !visible(row)) return send(res, 403, { code: '42501', message: 'row-level security' });
            if (name === 'art_invites') row.code = randomUUID().replace(/-/g, '');
            if (name === 'art_animation_jobs' && 'hint' in row && !flags.hint) return send(res, 400, { code: 'PGRST204', message: "Could not find the 'hint' column of 'art_animation_jobs' in the schema cache" });
            if (name === 'art_animation_jobs') { row.id = randomUUID(); row.status = 'queued'; row.requested_by = uid; }
            if (row.id && rows.some((r) => r.id === row.id)) return send(res, 409, { code: '23505', message: 'duplicate key' });
            rows.push(row);
          }
          return send(res, 201, want ? [row] : undefined);
        }
        if (req.method === 'PATCH') {
          if (name === 'art_animation_jobs' || name === 'art_child_members') return send(res, 200, []);
          const b = json();
          const hit = rows.filter((r) => visible(r) && match(r));
          for (const r of hit) Object.assign(r, b);
          return send(res, 200, want ? hit : undefined);
        }
        if (req.method === 'DELETE') {
          const hit = rows.filter((r) => visible(r) && match(r));
          t[name] = rows.filter((r) => !hit.includes(r));
          if (name === 'art_children') {
            const gone = new Set(hit.map((r) => r.id));
            for (const k of ['art_child_members', 'art_memories', 'art_invites', 'art_animation_jobs']) t[k] = t[k].filter((r) => !gone.has(r.child_id));
          }
          return send(res, 204);
        }
      }

      if (path === '/functions/v1/art-title') {
        const m = t.art_memories.find((r) => r.id === json().memory_id && isMember(uid, r.child_id));
        if (!m) return send(res, 404, { error: 'not found' });
        const image = m.details && m.details.image;
        const b = json();
        if ((m.title && b.want !== 'motions') || !files.has(`${m.child_id}/${image}`)) return send(res, 200, { title: null });
        titleCalls.push(m.id);
        wants.push(b.want || 'title');
        if (b.want === 'motions') {
          const motions = motionSets.length ? motionSets.shift() : [];
          if (b.route !== 'free') return send(res, 200, { title: null, motions });
          freePictures.push(b.picture);
          setTimeout(() => { Object.assign(m, { details: { ...m.details, motions }, updated_at: now() + '-task' }); }, 1500);
          return send(res, 200, { queued: true, eta_seconds: 60 });
        }
        if (b.route === 'free') {
          // The scheduled task: a moment later the title is written on the server.
          freePictures.push(b.picture);
          const title = titles.length ? titles.shift() : null;
          const turn = turns.length ? turns.shift() : 0;
          const motions = motionSets.length ? motionSets.shift() : null;
          setTimeout(() => { if (title && !m.title) Object.assign(m, { title, details: { ...m.details, autoTitle: true, ...(turn ? { turn } : {}), ...(motions ? { motions } : {}) }, updated_at: now() + '-task' }); }, 1500);
          return send(res, 200, { queued: true, eta_seconds: 60 });
        }
        return send(res, 200, { title: titles.length ? titles.shift() : null, turn: turns.length ? turns.shift() : 0, motions: motionSets.length ? motionSets.shift() : [] });
      }

      const BUCKET = '/storage/v1/object/';
      if (path.startsWith(BUCKET)) {
        const rest = decodeURIComponent(path.slice(BUCKET.length));
        const allowed = (p) => isMember(uid, p.split('/')[0]);
        if (rest === 'art' && req.method === 'DELETE') {
          for (const p of json().prefixes) if (allowed(p)) files.delete(p);
          return send(res, 200, []);
        }
        if (rest === 'list/art') {
          const prefix = json().prefix + '/';
          if (!allowed(prefix)) return send(res, 200, []);
          return send(res, 200, [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map((p) => ({ id: p, name: p.slice(prefix.length) })));
        }
        if (rest.startsWith('authenticated/art/')) {
          const p = rest.slice('authenticated/art/'.length);
          const f = files.get(p);
          if (!f || !allowed(p)) return send(res, 404, { message: 'Object not found' });
          return send(res, 200, f.data, { 'Content-Type': f.type });
        }
        if (rest.startsWith('art/') && req.method === 'POST') {
          const p = rest.slice(4);
          if (!allowed(p)) return send(res, 403, { message: 'row-level security' });
          files.set(p, { type: req.headers['content-type'], data: raw });
          return send(res, 200, { Key: 'art/' + p });
        }
      }
      send(res, 404, { message: 'not found: ' + path });
    } catch (err) {
      send(res, 500, { message: String(err && err.message) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, tables: t, files, users, log, titles, titleCalls, freePictures, turns, motionSets, wants, flags, users })));
}
