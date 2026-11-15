-- ציורון: the movement chosen for an animation travels with the request ("fly: הפרפר עף").
-- Touches only public.art_animation_jobs: 1 new optional column. Nothing else changes; requests without it work as before.
-- The value is a movement name from the app's fixed list and a short Hebrew label, nothing else.

alter table public.art_animation_jobs
  add column hint text check (hint is null or hint ~ '^[a-z]{3,8}: [א-ת ]{2,30}$');
