-- Undo of 006_art_family_invites.sql. People who already joined stay attached to the children.
drop function if exists public.art_accept_family_invite(text, text);
drop table if exists public.art_family_invites;
drop function if exists public.art_shares_child(uuid);
