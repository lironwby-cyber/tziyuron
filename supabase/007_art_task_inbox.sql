-- ציורון: an inbox for the two scheduled tasks (naming and animation).
-- Why: a task that belongs to a Claude project refuses a wake that carries text ("this project is paused",
-- a known fault of the service, anthropics/claude-code#102874), while an empty wake works. So the server
-- leaves the request here and wakes the task with no text; the task takes the oldest request and deletes it.
-- Only the service role and the database owner (the task's SQL tool) can see this table. Nothing else changes.

create table public.art_task_inbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('title', 'motions', 'animate')),
  memory_id uuid,
  job_id uuid,
  payload text not null check (length(payload) <= 60000),
  created_at timestamptz not null default now()
);
create index art_task_inbox_kind_created on public.art_task_inbox (kind, created_at);
alter table public.art_task_inbox enable row level security; -- no policies: members cannot read or write it
revoke all on public.art_task_inbox from anon, authenticated;
grant select, insert, delete on public.art_task_inbox to service_role;
