-- ציורון 009 (applied 2026-11-20 as 009_art_task_inbox_taken_at).
-- The scheduled tasks claim an inbox request by marking it taken (an update), never by deleting it:
-- a delete makes the database tool ask for an approval that nobody can answer during an unattended run.
-- Taken and stale requests are cleared by the edge functions art-title and art-animate before each new request.
alter table public.art_task_inbox add column if not exists taken_at timestamptz;
grant update on public.art_task_inbox to service_role;
