-- Checks for 005. State: child 1111 (made by A, members A and B), child 2222 (made by C).
delete from storage.objects;
insert into storage.objects (bucket_id, name, metadata, created_at) values
  ('art', '11111111-1111-1111-1111-111111111111/f1', '{"size": 100}', now() - interval '3 hours'),
  ('art', '11111111-1111-1111-1111-111111111111/f2', '{"size": 200}', now() - interval '2 hours'),
  ('art', '11111111-1111-1111-1111-111111111111/anim/j.mp4', '{"size": 300}', now() - interval '1 hour'),
  ('art', '22222222-2222-2222-2222-222222222222/g1', '{"size": 400}', now()),
  ('other', '11111111-1111-1111-1111-111111111111/zz', '{"size": 1}', now());
do $$ begin
  if (select owner from public.art_backup_config) <> '00000000-0000-0000-0000-00000000000a' then raise exception 'the owner is not the one who opened the archive'; end if;
  if (select count(*) from cron.job where jobname = 'art-backup-sweep' and schedule = '*/5 * * * *') <> 1 then raise exception 'the timed job is missing'; end if;
end $$;
-- The timed job's text runs and makes exactly one call to the backup function, with no data in it.
do $$ declare c text; n int; begin
  select command into c from cron.job where jobname = 'art-backup-sweep';
  select count(*) into n from net.calls;
  execute c;
  if (select count(*) from net.calls) <> n + 1 then raise exception 'the job made no call'; end if;
  if (select body::text from net.calls order by id desc limit 1) <> '{"action": "sweep"}' then raise exception 'the job sent something else'; end if;
  if (select url from net.calls order by id desc limit 1) not like '%/functions/v1/art-backup' then raise exception 'wrong address'; end if;
end $$;

-- A family member: no table, no claim; the status tells only about their children.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare s jsonb; begin
  begin perform 1 from public.art_backup_config; raise exception 'member read the connection';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.art_backup_files; raise exception 'member read the list';
  exception when insufficient_privilege then null; end;
  begin insert into public.art_backup_oauth (state, user_id) values ('x', '00000000-0000-0000-0000-00000000000b'); raise exception 'member wrote a state';
  exception when insufficient_privilege then null; end;
  begin perform public.art_backup_claim(5); raise exception 'member claimed files';
  exception when insufficient_privilege then null; end;
  s := public.art_backup_status();
  if s <> '{"connected": false, "owner": false, "total": 3, "done": 0, "failed": 0, "last": null, "problem": false}'::jsonb then raise exception 'status before: %', s; end if;
end $$;
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin perform public.art_backup_status(); raise exception 'anon read the status';
  exception when insufficient_privilege then null; end;
end $$;

-- The server function: claims oldest first, never the same file twice.
set role service_role;
do $$ declare n int; begin
  select count(*) into n from public.art_backup_claim(2);
  if n <> 2 then raise exception 'first claim gave %', n; end if;
  if (select count(*) from public.art_backup_files where path like '%/f_' and status = 'working' and attempts = 1) <> 2 then raise exception 'oldest two were not taken'; end if;
  if (select bytes from public.art_backup_files where path like '%/f2') <> 200 then raise exception 'size not carried'; end if;
  select count(*) into n from public.art_backup_claim(50);
  if n <> 2 then raise exception 'second claim gave % (other bucket or a double claim)', n; end if;
  select count(*) into n from public.art_backup_claim(50);
  if n <> 0 then raise exception 'a taken file was handed out again'; end if;
  if (select child_id from public.art_backup_files where path like '%/g1') <> '22222222-2222-2222-2222-222222222222' then raise exception 'child not read from the path'; end if;

  update public.art_backup_files set status = 'done', remote_id = 7 where path like '%/f1';
  update public.art_backup_files set status = 'skipped' where path like '%/f2';
  update public.art_backup_files set status = 'failed', error = 'x' where path like '%/j.mp4';
  -- A fresh failure waits; after 5 minutes it is tried again; after 5 tries it rests.
  select count(*) into n from public.art_backup_claim(50);
  if n <> 0 then raise exception 'a fresh failure was retried at once'; end if;
  update public.art_backup_files set updated_at = now() - interval '6 minutes' where path like '%/j.mp4';
  select count(*) into n from public.art_backup_claim(50);
  if n <> 1 or (select attempts from public.art_backup_files where path like '%/j.mp4') <> 2 then raise exception 'the failure was not retried'; end if;
  update public.art_backup_files set status = 'failed', attempts = 5, updated_at = now() - interval '1 hour' where path like '%/j.mp4';
  select count(*) into n from public.art_backup_claim(50);
  if n <> 0 then raise exception 'a file was tried a sixth time'; end if;
  -- A run that died (still "working" after 10 minutes) is taken over.
  update public.art_backup_files set updated_at = now() - interval '11 minutes' where path like '%/g1';
  select count(*) into n from public.art_backup_claim(50);
  if n <> 1 then raise exception 'a dead run was not taken over'; end if;
  -- A file replaced after its copy is copied again; an untouched copy is left alone.
  update public.art_backup_files set status = 'done' where path like '%/g1';
  select count(*) into n from public.art_backup_claim(50);
  if n <> 0 then raise exception 'a finished copy was redone'; end if;
  update storage.objects set updated_at = now() + interval '1 minute', metadata = '{"size": 150}' where name like '%/f1';
  select count(*) into n from public.art_backup_claim(50);
  if n <> 1 or (select bytes from public.art_backup_files where path like '%/f1') <> 150 then raise exception 'a replaced file was not copied again'; end if;
  if (select uploaded_at from public.art_backup_claim(50)) is not null then raise exception 'claim after claim'; end if;
  update public.art_backup_files set status = 'done', updated_at = now() + interval '2 minutes' where path like '%/f1';
  begin perform 1 from public.art_backup_folders; exception when insufficient_privilege then raise exception 'the server cannot read the folders'; end;
  update public.art_backup_config set access_token = 'tok', api_host = 'eapi.pcloud.com';
  begin update public.art_backup_config set api_host = 'evil.example.com'; raise exception 'a foreign host was accepted';
  exception when check_violation then null; end;
  begin insert into public.art_backup_config (id) values (2); raise exception 'a second connection row';
  exception when check_violation then null; end;
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare s jsonb; begin
  s := public.art_backup_status();
  if (s - 'last') <> '{"connected": true, "owner": false, "total": 2, "done": 1, "failed": 1, "problem": false}'::jsonb or s->>'last' is null then raise exception 'status after: %', s; end if;
  if s::text like '%tok%' then raise exception 'the token leaked'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if not (public.art_backup_status()->>'owner')::boolean then raise exception 'the owner is not told so'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ declare s jsonb; begin
  s := public.art_backup_status();
  if (s->>'total')::int <> 1 or (s->>'done')::int <> 1 then raise exception 'C sees other numbers: %', s; end if;
end $$;
reset request.jwt.claim.sub;
reset role;
delete from storage.objects;
