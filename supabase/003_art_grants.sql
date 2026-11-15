-- ציורון: table privileges for signed-in users and for the server functions.
-- This project gives new tables no data privileges by default, so 001 left the art_* tables reachable
-- only by the owner role. Row-level security (001, 002) still decides which rows each member reaches;
-- these grants only let the request get as far as those policies. Nothing is granted to anon.

grant select, insert, update, delete on public.art_children to authenticated;
grant select, delete on public.art_child_members to authenticated;          -- members are added only by art_accept_invite / art_add_creator
grant select, insert, update, delete on public.art_memories to authenticated;
grant select, insert, delete on public.art_invites to authenticated;
grant select, insert on public.art_animation_jobs to authenticated;         -- results are written by the server only
grant select, insert, update, delete on public.art_push_subs to authenticated;

-- The server functions (art-animate) and the scheduled tasks work through the service role.
grant select, insert, update, delete on
  public.art_children, public.art_child_members, public.art_memories,
  public.art_invites, public.art_animation_jobs, public.art_push_subs
  to service_role;
