-- Undo of 009_art_task_inbox_cleanup.sql.
drop trigger if exists art_inbox_done_memory on public.art_memories;
drop trigger if exists art_inbox_done_job on public.art_animation_jobs;
drop trigger if exists art_inbox_expire on public.art_task_inbox;
drop function if exists public.art_inbox_done_memory();
drop function if exists public.art_inbox_done_job();
drop function if exists public.art_inbox_expire();
