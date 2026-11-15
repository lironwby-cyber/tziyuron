-- ציורון: a second, independent copy of everything the family uploads, in the owner's own pCloud.
-- Adds 4 private tables (no access for signed-in users, only for the server function), 2 functions and
-- 1 timed job that wakes the server function "art-backup" every 5 minutes. Touches no existing table.
-- Needs pg_cron and pg_net (both already installed).

-- The connection to pCloud. One row. The owner is the account that opened the archive (made the first child).
create table public.art_backup_config (
  id int primary key default 1 check (id = 1),
  owner uuid references auth.users(id),
  access_token text,
  api_host text check (api_host in ('api.pcloud.com', 'eapi.pcloud.com')),
  root_folder_id bigint,
  connected_at timestamptz,
  last_run_at timestamptz,
  last_error text
);
insert into public.art_backup_config (id, owner)
  values (1, (select created_by from public.art_children order by created_at limit 1));

-- One-time values that tie a pCloud approval page to the account that asked for it.
create table public.art_backup_oauth (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- What was copied. A file is copied once; a deleted drawing stays in the backup.
create table public.art_backup_files (
  path text primary key,                 -- the file's name in the private bucket: <child id>/<file id>
  child_id uuid,
  status text not null check (status in ('working', 'done', 'failed', 'skipped')),
  remote_id bigint,                      -- the file's id in pCloud
  bytes bigint,
  attempts int not null default 1,
  error text,
  updated_at timestamptz not null default now()
);
-- The pCloud folder of each child, kept by id so that renaming a child never splits its backup.
create table public.art_backup_folders (
  child_id uuid primary key,
  folder_id bigint not null,
  index_at timestamptz                   -- when the child's list of memories was last copied
);

create index art_backup_files_child on public.art_backup_files (child_id, status);

alter table public.art_backup_config enable row level security;
alter table public.art_backup_oauth enable row level security;
alter table public.art_backup_files enable row level security;
alter table public.art_backup_folders enable row level security;
-- No policies and no grants for signed-in users: the token and the list are for the server function only.
grant select, insert, update, delete on public.art_backup_config, public.art_backup_oauth, public.art_backup_files, public.art_backup_folders to service_role;

-- Hands the server function the next files to copy and marks them as taken, so that two runs at the same
-- moment never copy the same file. A failed file is tried again after 5 minutes, at most 5 times;
-- a run that died is taken over after 10 minutes; a file that was replaced after its copy is copied again.
create function public.art_backup_claim(n int) returns table (path text, bytes bigint, uploaded_at timestamptz)
language sql security definer set search_path = '' as $$
  with pending as (
    select o.name, nullif(o.metadata->>'size', '')::bigint as size, o.created_at
    from storage.objects o
    left join public.art_backup_files f on f.path = o.name
    where o.bucket_id = 'art'
      and (f.path is null
        or (f.status = 'failed' and f.attempts < 5 and f.updated_at < now() - interval '5 minutes')
        or (f.status = 'working' and f.updated_at < now() - interval '10 minutes')
        or (f.status = 'done' and o.updated_at > f.updated_at))
    order by o.created_at
    limit greatest(1, least(n, 50))
  )
  , taken as (
  insert into public.art_backup_files as f (path, child_id, status, bytes)
    select p.name,
      case when split_part(p.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(p.name, '/', 1)::uuid end,
      'working', p.size
    from pending p
  on conflict (path) do update
    set status = 'working', bytes = excluded.bytes, updated_at = now(),
        attempts = case when f.status = 'done' then 1 else f.attempts + 1 end
    where (f.status = 'failed' and f.attempts < 5 and f.updated_at < now() - interval '5 minutes')
       or (f.status = 'working' and f.updated_at < now() - interval '10 minutes')
       or f.status = 'done'
  returning f.path, f.bytes
  )
  select t.path, t.bytes, p.created_at from taken t join pending p on p.name = t.path;
$$;
revoke execute on function public.art_backup_claim(int) from public, anon, authenticated;
grant execute on function public.art_backup_claim(int) to service_role;

-- What a family member may know about the backup: is it connected, and how many of the files of the
-- children they are attached to are already copied. Never the token, never other families' numbers.
create function public.art_backup_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select o.name, f.status, f.updated_at
    from storage.objects o
    join public.art_child_members m
      on m.user_id = (select auth.uid()) and o.name like m.child_id::text || '/%'
    left join public.art_backup_files f on f.path = o.name
    where o.bucket_id = 'art'
  )
  select jsonb_build_object(
    'connected', coalesce((select c.access_token is not null from public.art_backup_config c where c.id = 1), false),
    'owner', coalesce((select c.owner = (select auth.uid()) from public.art_backup_config c where c.id = 1), false),
    'total', (select count(*) from mine where status is distinct from 'skipped'),
    'done', (select count(*) from mine where status = 'done'),
    'failed', (select count(*) from mine where status = 'failed'),
    'last', (select max(updated_at) from mine where status = 'done'),
    'problem', (select c.last_error is not null from public.art_backup_config c where c.id = 1)
  );
$$;
revoke execute on function public.art_backup_status() from public, anon;
grant execute on function public.art_backup_status() to authenticated;

-- Every 5 minutes: wake the server function. It carries no data; the function reads everything itself.
select cron.schedule('art-backup-sweep', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://tgulcckyhotwenurtztg.supabase.co/functions/v1/art-backup',
    body := '{"action":"sweep"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  );
$job$);
