// ציורון: the server side of an animation job.
//   start   - a member asked for an animation: wake the scheduled Claude task at once.
//   collect - the task wrote the finished clip's address: copy the clip into the private bucket.
// Called by database triggers with only { action, job_id }. Everything else is read from the job row,
// which only a member (insert, through RLS) or the service role (updates) can write.
// Secrets, set by the owner in the dashboard: ART_ROUTINE_ID (trig_...), ART_ROUTINE_TOKEN.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'art';
const MAX_CLIP_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fail(jobId: string, message: string, patch: Record<string, unknown> = {}) {
  await db.from('art_animation_jobs')
    .update({ error: message.slice(0, 500), updated_at: new Date().toISOString(), ...patch })
    .eq('id', jobId);
  return json({ ok: false, error: message }, 502);
}

async function start(jobId: string) {
  // Claim the job, so that a repeated call never wakes the task twice (each wake is a paid run).
  const { data: job } = await db.from('art_animation_jobs')
    .update({ fired_at: new Date().toISOString(), error: null })
    .eq('id', jobId).eq('status', 'queued').is('fired_at', null)
    .select('id, child_id, source_path').maybeSingle();
  if (!job) return json({ ok: true, skipped: true });

  if (!job.source_path.startsWith(job.child_id + '/')) {
    return fail(jobId, 'the drawing is not in this child\'s folder', { status: 'failed' });
  }
  const signed = await db.storage.from(BUCKET).createSignedUrl(job.source_path, 2 * 60 * 60);
  if (signed.error || !signed.data) return fail(jobId, 'the drawing was not found', { status: 'failed' });

  // The movement the member chose ("fly: הפרפר עף"), when the request carries one. Read separately, so that a
  // database without the column yet behaves as before. Only the fixed shape is passed on.
  const extra = await db.from('art_animation_jobs').select('hint').eq('id', jobId).maybeSingle();
  const hint = extra.error ? '' : String((extra.data as { hint?: string } | null)?.hint ?? '');
  const motion = /^[a-z]{3,8}: [א-ת ]{2,30}$/.test(hint) ? hint : '';

  const routine = Deno.env.get('ART_ROUTINE_ID');
  const token = Deno.env.get('ART_ROUTINE_TOKEN');
  if (!routine || !token) return fail(jobId, 'the scheduled task is not connected yet', { fired_at: null });

  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routine}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01', 'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: `job_id: ${job.id}\nimage_url: ${signed.data.signedUrl}${motion ? `\nmotion: ${motion}` : ''}` }),
  });
  if (!res.ok) return fail(jobId, `the scheduled task did not start (${res.status})`, { fired_at: null });
  return json({ ok: true });
}

async function collect(jobId: string) {
  const { data: job } = await db.from('art_animation_jobs')
    .select('id, child_id, memory_id, result_url, result_path').eq('id', jobId).maybeSingle();
  if (!job || !job.result_url || job.result_path) return json({ ok: true, skipped: true });

  let url: URL;
  try { url = new URL(job.result_url); } catch { return fail(jobId, 'the clip address is not valid', { status: 'failed' }); }
  if (url.protocol !== 'https:') return fail(jobId, 'the clip address is not valid', { status: 'failed' });

  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('video/')) return fail(jobId, `the clip could not be downloaded (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIP_BYTES) return fail(jobId, 'the clip has an unexpected size');

  const path = `${job.child_id}/anim/${job.id}.mp4`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true });
  if (up.error) return fail(jobId, 'the clip could not be saved');

  const now = new Date().toISOString();
  const done = await db.from('art_animation_jobs')
    .update({ status: 'done', result_path: path, error: null, updated_at: now }).eq('id', jobId);
  if (done.error) return fail(jobId, 'the job could not be closed');
  return json({ ok: true, path });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  let body: { action?: string; job_id?: string };
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }
  if (!body.job_id || !UUID.test(body.job_id)) return json({ ok: false }, 400);
  if (body.action === 'start') return start(body.job_id);
  if (body.action === 'collect') return collect(body.job_id);
  return json({ ok: false }, 400);
});
