-- ציורון: shared archive, per-child family members, animation queue.
-- Adds only new objects: tables art_*, functions art_*, a private bucket "art" and its policies.
-- Touches no existing table, function, policy or bucket.

create table public.art_children (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  birth_date date,
  animal text,
  color smallint,
  avatar_path text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Everyone attached to a child has the same full rights for that child.
create table public.art_child_members (
  child_id uuid not null references public.art_children(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (child_id, user_id)
);
create index art_child_members_user on public.art_child_members (user_id);

create function public.art_is_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.art_child_members m where m.child_id = c and m.user_id = (select auth.uid()));
$$;
revoke all on function public.art_is_member(uuid) from public, anon;
grant execute on function public.art_is_member(uuid) to authenticated;

-- Whoever creates a child becomes its first member.
create function public.art_add_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.art_child_members (child_id, user_id, added_by) values (new.id, new.created_by, new.created_by);
  return new;
end $$;
revoke all on function public.art_add_creator() from public, anon, authenticated;
create trigger art_children_creator after insert on public.art_children
  for each row execute function public.art_add_creator();

create table public.art_memories (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.art_children(id) on delete cascade,
  type text not null check (type in ('artwork', 'photo', 'video', 'voice', 'milestone', 'note')),
  title text not null default '' check (char_length(title) <= 200),
  caption text not null default '' check (char_length(caption) <= 4000),
  date date not null,
  details jsonb not null default '{}'::jsonb,   -- crop corners, attachments list, durations
  files jsonb not null default '{}'::jsonb,     -- storage paths: image, original, thumb, media
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index art_memories_child on public.art_memories (child_id, date desc);

-- One-time invitation links to a child.
create table public.art_invites (
  code text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  child_id uuid not null references public.art_children(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz
);

create function public.art_accept_invite(invite_code text, my_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.art_invites;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  select * into inv from public.art_invites where code = invite_code for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then raise exception 'invite is not valid'; end if;
  insert into public.art_child_members (child_id, user_id, display_name, added_by)
    values (inv.child_id, (select auth.uid()), left(my_name, 40), inv.created_by)
    on conflict (child_id, user_id) do nothing;
  update public.art_invites set used_by = (select auth.uid()), used_at = now() where code = invite_code;
  return inv.child_id;
end $$;
revoke all on function public.art_accept_invite(text, text) from public, anon;
grant execute on function public.art_accept_invite(text, text) to authenticated;

-- Animation queue: the app adds a row, the scheduled task fills in the result.
create table public.art_animation_jobs (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.art_memories(id) on delete cascade,
  child_id uuid not null references public.art_children(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  source_path text not null,
  result_path text,
  kling_generation_id text,
  error text,
  requested_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index art_animation_jobs_open on public.art_animation_jobs (status, created_at) where status in ('queued', 'processing');

-- Web push subscriptions ("a new artwork by ... was added").
create table public.art_push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.art_children enable row level security;
alter table public.art_child_members enable row level security;
alter table public.art_memories enable row level security;
alter table public.art_invites enable row level security;
alter table public.art_animation_jobs enable row level security;
alter table public.art_push_subs enable row level security;

create policy "art children: members read" on public.art_children for select to authenticated
  using (public.art_is_member(id) or created_by = (select auth.uid()));
create policy "art children: signed-in adds own" on public.art_children for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "art children: members edit" on public.art_children for update to authenticated
  using (public.art_is_member(id)) with check (public.art_is_member(id));
create policy "art children: members delete" on public.art_children for delete to authenticated
  using (public.art_is_member(id));

-- Members are added only through an invitation (art_accept_invite); any member may remove a member.
create policy "art members: members read" on public.art_child_members for select to authenticated
  using (public.art_is_member(child_id));
create policy "art members: members remove" on public.art_child_members for delete to authenticated
  using (public.art_is_member(child_id));

create policy "art memories: members all" on public.art_memories for all to authenticated
  using (public.art_is_member(child_id)) with check (public.art_is_member(child_id));

create policy "art invites: members read" on public.art_invites for select to authenticated
  using (public.art_is_member(child_id));
create policy "art invites: members add" on public.art_invites for insert to authenticated
  with check (public.art_is_member(child_id) and created_by = (select auth.uid()) and used_at is null and used_by is null);
create policy "art invites: members cancel" on public.art_invites for delete to authenticated
  using (public.art_is_member(child_id));

create policy "art jobs: members read" on public.art_animation_jobs for select to authenticated
  using (public.art_is_member(child_id));
create policy "art jobs: members ask" on public.art_animation_jobs for insert to authenticated
  with check (public.art_is_member(child_id) and requested_by = (select auth.uid()) and status = 'queued'
    and result_path is null and kling_generation_id is null);

create policy "art push: own rows" on public.art_push_subs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Private bucket. Files live under <child id>/..., and only that child's members reach them.
insert into storage.buckets (id, name, public, file_size_limit) values ('art', 'art', false, 209715200);

create function public.art_path_child(name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(name, '/', 1)::uuid;
exception when others then return null;
end $$;

create policy "art: members read" on storage.objects for select to authenticated
  using (bucket_id = 'art' and public.art_is_member(public.art_path_child(name)));
create policy "art: members add" on storage.objects for insert to authenticated
  with check (bucket_id = 'art' and public.art_is_member(public.art_path_child(name)));
create policy "art: members replace" on storage.objects for update to authenticated
  using (bucket_id = 'art' and public.art_is_member(public.art_path_child(name)))
  with check (bucket_id = 'art' and public.art_is_member(public.art_path_child(name)));
create policy "art: members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'art' and public.art_is_member(public.art_path_child(name)));
