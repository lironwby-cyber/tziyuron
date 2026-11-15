-- Undo of 002_art_animation_instant.sql.
drop trigger art_jobs_collect on public.art_animation_jobs;
drop trigger art_jobs_start on public.art_animation_jobs;
drop function public.art_job_notify();
drop policy "art jobs: members ask" on public.art_animation_jobs;
create policy "art jobs: members ask" on public.art_animation_jobs for insert to authenticated
  with check (public.art_is_member(child_id) and requested_by = (select auth.uid()) and status = 'queued'
    and result_path is null and kling_generation_id is null);
alter table public.art_animation_jobs drop column result_url, drop column fired_at;
