-- Undo 005_art_backup.sql. The copies already in pCloud stay there.
select cron.unschedule('art-backup-sweep');
drop function public.art_backup_status();
drop function public.art_backup_claim(int);
drop table public.art_backup_folders;
drop table public.art_backup_files;
drop table public.art_backup_oauth;
drop table public.art_backup_config;
