-- Undo 003_art_grants.sql.
revoke select, insert, update, delete on
  public.art_children, public.art_child_members, public.art_memories,
  public.art_invites, public.art_animation_jobs, public.art_push_subs
  from authenticated, service_role;
