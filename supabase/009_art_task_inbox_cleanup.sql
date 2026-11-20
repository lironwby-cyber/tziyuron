-- ציורון: the inbox empties itself, so a request the task could not remove never blocks newer ones.
-- (The task's own safety check may refuse its "delete" step.) A request goes away when:
--   - its drawing got a name or movements (art_memories changed),
--   - its animation job was taken (status left 'queued'),
--   - it is older than 5 minutes (a run takes about a minute), checked whenever a new request arrives.

create or replace function public.art_inbox_done_memory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title or (new.details->'motions') is distinct from (old.details->'motions') then
    delete from public.art_task_inbox where memory_id = new.id and kind in ('title', 'motions');
  end if;
  return new;
end $$;
create trigger art_inbox_done_memory after update on public.art_memories
  for each row execute function public.art_inbox_done_memory();

create or replace function public.art_inbox_done_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'queued' and new.status <> 'queued' then
    delete from public.art_task_inbox where job_id = new.id;
  end if;
  return new;
end $$;
create trigger art_inbox_done_job after update on public.art_animation_jobs
  for each row execute function public.art_inbox_done_job();

create or replace function public.art_inbox_expire() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.art_task_inbox where created_at < now() - interval '5 minutes';
  return new;
end $$;
create trigger art_inbox_expire before insert on public.art_task_inbox
  for each statement execute function public.art_inbox_expire();

revoke all on function public.art_inbox_done_memory(), public.art_inbox_done_job(), public.art_inbox_expire() from public, anon, authenticated;
