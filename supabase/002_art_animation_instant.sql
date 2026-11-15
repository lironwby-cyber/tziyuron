-- ציורון: instant start of an animation job and automatic delivery of the finished clip.
-- Touches only public.art_animation_jobs (2 new columns, 1 policy replaced, 2 triggers) and adds 1 function.
-- Needs the pg_net extension (already installed) and the Edge Function "art-animate".

alter table public.art_animation_jobs
  add column fired_at timestamptz,          -- when the scheduled task was woken for this job
  add column result_url text;               -- the clip's temporary address at Kling, written by the scheduled task

-- A member may still only ask: a new row is always empty and queued.
drop policy "art jobs: members ask" on public.art_animation_jobs;
create policy "art jobs: members ask" on public.art_animation_jobs for insert to authenticated
  with check (public.art_is_member(child_id) and requested_by = (select auth.uid()) and status = 'queued'
    and result_path is null and kling_generation_id is null and result_url is null and fired_at is null and error is null);

-- Tells the server function about a job. It carries only the job id and an action name; the function
-- reads everything else from the row itself, so a call from outside can do nothing a member could not.
create function public.art_job_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://tgulcckyhotwenurtztg.supabase.co/functions/v1/art-animate',
    body := jsonb_build_object('action', tg_argv[0], 'job_id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
  return new;
end $$;
revoke all on function public.art_job_notify() from public, anon, authenticated;

-- New request: wake the scheduled task at once.
create trigger art_jobs_start after insert on public.art_animation_jobs
  for each row when (new.status = 'queued') execute function public.art_job_notify('start');

-- Clip is ready at Kling: copy it into the private bucket.
create trigger art_jobs_collect after update of result_url on public.art_animation_jobs
  for each row when (new.result_url is not null and new.result_path is null and new.result_url is distinct from old.result_url)
  execute function public.art_job_notify('collect');
