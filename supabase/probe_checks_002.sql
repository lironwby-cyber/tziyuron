-- Checks for 002. State left by probe_checks.sql: child 1111 with members A and B, memory 'טיל', one queued job.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare n int; begin
  -- A member's request wakes the task: exactly one "start" call with the job id.
  insert into public.art_animation_jobs (id, memory_id, child_id, source_path)
    select '33333333-3333-3333-3333-333333333333', id, child_id, child_id || '/a.jpg' from public.art_memories where title = 'טיל';
  -- A member cannot pre-fill the new fields.
  begin
    insert into public.art_animation_jobs (memory_id, child_id, source_path, result_url) select id, child_id, 'p', 'https://x/y.mp4' from public.art_memories where title = 'טיל';
    raise exception 'member forged a clip address';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.art_animation_jobs (memory_id, child_id, source_path, fired_at) select id, child_id, 'p', now() from public.art_memories where title = 'טיל';
    raise exception 'member forged fired_at';
  exception when insufficient_privilege then null; end;
  update public.art_animation_jobs set result_url = 'https://x/y.mp4'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'member wrote a clip address'; end if;
  begin perform public.art_job_notify(); raise exception 'member may call art_job_notify';
  exception when insufficient_privilege then null; when others then if sqlstate <> '0A000' and sqlstate <> '42501' then raise; end if; end;
end $$;
reset request.jwt.claim.sub;
reset role;
do $$ declare n int; begin
  select count(*) into n from net.calls where body = '{"action":"start","job_id":"33333333-3333-3333-3333-333333333333"}'::jsonb
    and url = 'https://tgulcckyhotwenurtztg.supabase.co/functions/v1/art-animate';
  if n <> 1 then raise exception 'start call count is %', n; end if;
  if (select count(*) from net.calls) <> 1 then raise exception 'forged inserts made calls'; end if;
  -- The task (service role) reports progress: no call. Then the clip address: one "collect" call.
  set local role service_role;
  update public.art_animation_jobs set status = 'processing', kling_generation_id = 'g1' where id = '33333333-3333-3333-3333-333333333333';
  if (select count(*) from net.calls) <> 1 then raise exception 'progress update made a call'; end if;
  update public.art_animation_jobs set result_url = 'https://x/y.mp4' where id = '33333333-3333-3333-3333-333333333333';
  if (select count(*) from net.calls where body->>'action' = 'collect') <> 1 then raise exception 'no collect call'; end if;
  -- Same address again, or closing the job: no further call.
  update public.art_animation_jobs set result_url = 'https://x/y.mp4' where id = '33333333-3333-3333-3333-333333333333';
  update public.art_animation_jobs set status = 'done', result_path = 'p.mp4' where id = '33333333-3333-3333-3333-333333333333';
  if (select count(*) from net.calls) <> 2 then raise exception 'extra calls: %', (select count(*) from net.calls); end if;
  reset role;
end $$;
truncate net.calls;
