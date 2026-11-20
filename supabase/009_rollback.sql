revoke update on public.art_task_inbox from service_role;
alter table public.art_task_inbox drop column if exists taken_at;
