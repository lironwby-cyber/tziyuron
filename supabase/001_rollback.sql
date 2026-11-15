-- Removes everything 001_art_shared_archive.sql added. Empty the "art" bucket first (dashboard), then run.
drop policy if exists "art: members read" on storage.objects;
drop policy if exists "art: members add" on storage.objects;
drop policy if exists "art: members replace" on storage.objects;
drop policy if exists "art: members delete" on storage.objects;
delete from storage.buckets where id = 'art';
drop table if exists public.art_push_subs, public.art_animation_jobs, public.art_invites, public.art_memories, public.art_child_members, public.art_children cascade;
drop function if exists public.art_accept_invite(text, text), public.art_add_creator(), public.art_is_member(uuid), public.art_path_child(text);
