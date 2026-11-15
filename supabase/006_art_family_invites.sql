-- ציורון: one invitation for all the children together ("שיתוף כל המשפחה").
-- 001 has a one-time invitation to one child. This adds a one-time invitation to every child the inviter is
-- attached to at the moment it is accepted, and keeps the invitee's name so that the family sees who was
-- invited and who joined. No phone number is kept on the server. Codes start with "F" (never a hex digit),
-- so that the app tells the two kinds of link apart. Nothing in 001 to 005 changes.

create table public.art_family_invites (
  code text primary key default 'F' || encode(extensions.gen_random_bytes(16), 'hex'),
  invitee_name text not null check (char_length(invitee_name) between 1 and 40),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
create index art_family_invites_creator on public.art_family_invites (created_by, created_at desc);

-- Do the caller and this user share a child? Family members see and cancel one another's invitations.
create function public.art_shares_child(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.art_child_members mine
    join public.art_child_members theirs on theirs.child_id = mine.child_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = u);
$$;
revoke all on function public.art_shares_child(uuid) from public, anon;
grant execute on function public.art_shares_child(uuid) to authenticated;

-- Attaches the signed-in user to every child of the inviter. Returns the children's ids.
create function public.art_accept_family_invite(invite_code text, my_name text default null) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare inv public.art_family_invites; kids uuid[];
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  select * into inv from public.art_family_invites where code = invite_code for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then raise exception 'invite is not valid'; end if;
  select array_agg(m.child_id order by m.created_at) into kids from public.art_child_members m where m.user_id = inv.created_by;
  if kids is null then raise exception 'invite is not valid'; end if;
  insert into public.art_child_members (child_id, user_id, display_name, added_by)
    select k, (select auth.uid()), left(coalesce(nullif(btrim(my_name), ''), inv.invitee_name), 40), inv.created_by from unnest(kids) k
    on conflict (child_id, user_id) do nothing;
  update public.art_family_invites set used_by = (select auth.uid()), used_at = now() where code = invite_code;
  return kids;
end $$;
revoke all on function public.art_accept_family_invite(text, text) from public, anon;
grant execute on function public.art_accept_family_invite(text, text) to authenticated;

alter table public.art_family_invites enable row level security;
create policy "art family invites: family reads" on public.art_family_invites for select to authenticated
  using (created_by = (select auth.uid()) or public.art_shares_child(created_by));
create policy "art family invites: own add" on public.art_family_invites for insert to authenticated
  with check (created_by = (select auth.uid()) and used_at is null and used_by is null
    and expires_at <= now() + interval '7 days'
    and exists (select 1 from public.art_child_members m where m.user_id = (select auth.uid())));
create policy "art family invites: family cancels" on public.art_family_invites for delete to authenticated
  using (created_by = (select auth.uid()) or public.art_shares_child(created_by));

-- This project gives new tables no data privileges by default (see 003). Nothing is granted to anon.
grant select, insert, delete on public.art_family_invites to authenticated;
grant select, insert, update, delete on public.art_family_invites to service_role;
