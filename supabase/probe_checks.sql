-- Behaviour checks. Each DO block raises when a rule does not hold.
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
set role authenticated;

-- A (parent) creates a child, adds a memory and an invite.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.art_children (id, name, birth_date) values ('11111111-1111-1111-1111-111111111111', 'נועה', '2020-03-10') returning id;
insert into public.art_memories (child_id, type, title, date) values ('11111111-1111-1111-1111-111111111111', 'artwork', 'טיל', '2026-01-01');
insert into public.art_invites (code, child_id) values ('code-b', '11111111-1111-1111-1111-111111111111'), ('code-old', '11111111-1111-1111-1111-111111111111');
insert into storage.objects (bucket_id, name) values ('art', '11111111-1111-1111-1111-111111111111/a.jpg');
do $$ begin
  if (select count(*) from public.art_child_members) <> 1 then raise exception 'creator is not the first member'; end if;
end $$;

-- B is not attached yet: sees nothing and can do nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ declare n int; begin
  if (select count(*) from public.art_children) <> 0 then raise exception 'stranger sees the child'; end if;
  if (select count(*) from public.art_memories) <> 0 then raise exception 'stranger sees memories'; end if;
  if (select count(*) from public.art_invites) <> 0 then raise exception 'stranger sees invites'; end if;
  if (select count(*) from storage.objects) <> 0 then raise exception 'stranger sees files'; end if;
  begin
    insert into public.art_memories (child_id, type, date) values ('11111111-1111-1111-1111-111111111111', 'note', '2026-01-02');
    raise exception 'stranger added a memory';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.art_child_members (child_id, user_id) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');
    raise exception 'stranger attached themself without an invite';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('art', '11111111-1111-1111-1111-111111111111/x.jpg');
    raise exception 'stranger uploaded a file';
  exception when insufficient_privilege then null; end;
  update public.art_memories set title = 'x'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'stranger edited'; end if;
end $$;

-- B accepts the invite: from now on exactly the same rights as A.
select public.art_accept_invite('code-b', 'סבתא');
do $$ declare n int; begin
  if (select count(*) from public.art_children) <> 1 then raise exception 'member does not see the child'; end if;
  insert into public.art_memories (child_id, type, title, date) values ('11111111-1111-1111-1111-111111111111', 'note', 'מסבתא', '2026-01-03');
  update public.art_memories set caption = 'ערוך' where title = 'טיל'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'member cannot edit another member''s memory'; end if;
  update public.art_children set name = 'נועה ב'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'member cannot edit the child'; end if;
  insert into storage.objects (bucket_id, name) values ('art', '11111111-1111-1111-1111-111111111111/b.jpg');
  if (select count(*) from storage.objects) <> 2 then raise exception 'member does not see the files'; end if;
  insert into public.art_invites (code, child_id) values ('code-c', '11111111-1111-1111-1111-111111111111');
  insert into public.art_animation_jobs (memory_id, child_id, source_path) select id, child_id, 'p' from public.art_memories where title = 'טיל';
  begin
    insert into public.art_animation_jobs (memory_id, child_id, source_path, status) select id, child_id, 'p', 'done' from public.art_memories where title = 'טיל';
    raise exception 'member forged a finished job';
  exception when insufficient_privilege then null; end;
  update public.art_animation_jobs set status = 'done'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'member changed a job (only the scheduled task may)'; end if;
  delete from public.art_memories where title = 'מסבתא'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'member cannot delete'; end if;
end $$;

-- A used invite cannot be used again; files of another child are out of reach.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  begin perform public.art_accept_invite('code-b'); raise exception 'used invite worked twice';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
  begin perform public.art_accept_invite('nope'); raise exception 'unknown invite worked';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
  if (select count(*) from public.art_children) <> 0 then raise exception 'C sees the child'; end if;
end $$;
-- C creates their own child; A and B do not see it.
insert into public.art_children (id, name) values ('22222222-2222-2222-2222-222222222222', 'יובל');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.art_children) <> 1 then raise exception 'B sees a child they are not attached to'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('art', '22222222-2222-2222-2222-222222222222/b.jpg');
    raise exception 'B uploaded into another child';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('art', 'not-a-uuid/b.jpg');
    raise exception 'bad path accepted';
  exception when insufficient_privilege then null; end;
end $$;
-- Signed-out visitors get nothing.
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin perform count(*) from public.art_children; if found then null; end if;
    if (select count(*) from public.art_children) <> 0 then raise exception 'anon sees children'; end if;
  exception when insufficient_privilege then null; end;
  begin perform public.art_is_member('11111111-1111-1111-1111-111111111111'); raise exception 'anon may call art_is_member';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
