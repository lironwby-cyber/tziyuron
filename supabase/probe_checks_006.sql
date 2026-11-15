-- Checks for 006, with their own users: D invites, E joins, G is a stranger.
insert into auth.users values ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e'),
  ('00000000-0000-0000-0000-00000000000f'), ('00000000-0000-0000-0000-000000000010');
set role authenticated;

-- A signed-in user with no child cannot invite.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  begin
    insert into public.art_family_invites (invitee_name) values ('סבתא');
    raise exception 'an invitation was made with no child';
  exception when insufficient_privilege then null; end;
end $$;

-- D has three children and invites two people.
insert into public.art_children (id, name) values
  ('d1111111-1111-1111-1111-111111111111', 'א'), ('d2222222-2222-2222-2222-222222222222', 'ב'), ('d3333333-3333-3333-3333-333333333333', 'ג');
insert into public.art_family_invites (code, invitee_name) values ('Fone', 'סבתא'), ('Ftwo', 'דוד'), ('Fold', 'ישן');
do $$ begin
  if (select count(*) from public.art_family_invites where code ~ '^F') <> 3 then raise exception 'the inviter does not see the invitations'; end if;
  if not exists (select 1 from public.art_family_invites where expires_at between now() + interval '6 days' and now() + interval '7 days 1 minute') then raise exception 'not valid for a week'; end if;
  -- No invitation that is already used, by someone else's name, or valid for longer than a week.
  begin insert into public.art_family_invites (invitee_name, used_at) values ('x', now()); raise exception 'a used invitation was made';
  exception when insufficient_privilege then null; end;
  begin insert into public.art_family_invites (invitee_name, created_by) values ('x', '00000000-0000-0000-0000-00000000000e'); raise exception 'an invitation in another name';
  exception when insufficient_privilege then null; end;
  begin insert into public.art_family_invites (invitee_name, expires_at) values ('x', now() + interval '1 year'); raise exception 'a year-long invitation';
  exception when insufficient_privilege then null; end;
  begin insert into public.art_family_invites (invitee_name) values (''); raise exception 'an invitation with no name';
  exception when check_violation then null; end;
  -- An invitation cannot be changed, only cancelled.
  begin update public.art_family_invites set expires_at = now() + interval '1 year'; raise exception 'an invitation was changed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.art_family_invites set expires_at = now() - interval '1 minute' where code = 'Fold';
set role authenticated;

-- A stranger sees no invitation, cannot cancel one, and a wrong or old code does nothing.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000010';
do $$ declare n int; begin
  if (select count(*) from public.art_family_invites) <> 0 then raise exception 'a stranger sees invitations'; end if;
  delete from public.art_family_invites; get diagnostics n = row_count;
  if n <> 0 then raise exception 'a stranger cancelled an invitation'; end if;
  begin perform public.art_accept_family_invite('Fnone', 'x'); raise exception 'a wrong code worked';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
  begin perform public.art_accept_family_invite('Fold', 'x'); raise exception 'an old code worked';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
  if (select count(*) from public.art_children) <> 0 then raise exception 'a stranger sees a child'; end if;
end $$;

-- E joins with the code: attached to all three children at once, under the name they typed.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ declare kids uuid[]; begin
  kids := public.art_accept_family_invite('Fone', '  סבתא רותי ');
  if array_length(kids, 1) <> 3 then raise exception 'not all the children: %', kids; end if;
  if (select count(*) from public.art_children where id::text like 'd%') <> 3 then raise exception 'the new member does not see three children'; end if;
  if (select count(*) from public.art_child_members where user_id = '00000000-0000-0000-0000-00000000000e' and display_name = 'סבתא רותי') <> 3 then raise exception 'the name was not kept'; end if;
  -- The same code a second time, by the same person or another, does nothing.
  begin perform public.art_accept_family_invite('Fone', 'x'); raise exception 'a used code worked again';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
  -- A family member sees the inviter's invitations and who joined.
  if (select count(*) from public.art_family_invites where code = 'Fone' and used_by is not null and used_at is not null) <> 1 then raise exception 'the list does not show who joined'; end if;
  if (select count(*) from public.art_family_invites) <> 3 then raise exception 'a family member does not see the invitations'; end if;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000010';
do $$ begin
  begin perform public.art_accept_family_invite('Fone', 'x'); raise exception 'a used code worked for another person';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
end $$;

-- F joins with no name typed: listed under the name the inviter gave. A child added after the invitation is included.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into public.art_children (id, name) values ('d4444444-4444-4444-4444-444444444444', 'ד');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
do $$ declare kids uuid[]; begin
  kids := public.art_accept_family_invite('Ftwo');
  if array_length(kids, 1) <> 4 then raise exception 'the later child is missing: %', kids; end if;
  if (select count(*) from public.art_child_members where user_id = '00000000-0000-0000-0000-00000000000f' and display_name = 'דוד') <> 4 then raise exception 'the inviter''s name for the guest was not used'; end if;
end $$;

-- A family member (E) cancels an invitation of D that was not used; the people who joined stay.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into public.art_family_invites (code, invitee_name) values ('Fopen', 'שכן');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ declare n int; begin
  delete from public.art_family_invites where code = 'Fopen'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'a family member could not cancel'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000010';
do $$ begin
  begin perform public.art_accept_family_invite('Fopen', 'x'); raise exception 'a cancelled code worked';
  exception when raise_exception then if sqlerrm <> 'invite is not valid' then raise; end if; end;
end $$;
reset request.jwt.claim.sub;

-- Not signed in: nothing at all.
set role anon;
do $$ begin
  begin perform 1 from public.art_family_invites; raise exception 'anon reads invitations';
  exception when insufficient_privilege then null; end;
  begin perform public.art_accept_family_invite('Ftwo', 'x'); raise exception 'anon accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
