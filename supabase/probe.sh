#!/bin/bash
# Probe of the migration on a throwaway local Postgres with stand-ins for Supabase's auth and storage.
set -e
trap 'pkill -u postgres postgres 2>/dev/null || true' ERR
D=$(mktemp -d /tmp/artpg.XXXX); chown postgres "$D"
B=/usr/lib/postgresql/16/bin
HERE=$(cd "$(dirname "$0")" && pwd)
cp "$HERE"/*.sql "$D"/; chmod -R a+rX "$D"
run() { su postgres -c "$*"; }
run "$B/initdb -D $D/data -A trust >/dev/null"
run "$B/pg_ctl -D $D/data -o '-p 54399 -k $D' -w start >/dev/null"
P="psql -h $D -p 54399 -v ON_ERROR_STOP=1 -q postgres"
run "$P" <<'S'
create role anon; create role authenticated; create role service_role bypassrls; grant service_role to postgres;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto schema extensions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage, extensions to authenticated, anon;
grant all on storage.objects to authenticated;
-- Like the production project: new tables in public give the API roles no data privileges.
alter default privileges in schema public grant truncate, references, trigger on tables to authenticated, anon, service_role;
alter default privileges in schema public revoke execute on functions from public;
grant usage on schema public to service_role;
-- Stand-in for pg_net: records each call instead of sending it.
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id $$;
grant usage on schema net to service_role; grant select on net.calls to service_role;
S
run "$P -f $D/001_art_shared_archive.sql"
# Without 003 a signed-in user is refused before row-level security is even asked.
run "$P" <<'S'
set role authenticated;
do $$ begin
  begin perform 1 from public.art_children; raise exception 'expected a refusal before 003';
  exception when insufficient_privilege then null; end;
end $$;
S
run "$P -f $D/003_art_grants.sql"
run "$P -f $D/probe_checks.sql"
run "$P -f $D/002_art_animation_instant.sql"
run "$P -f $D/probe_checks_002.sql"
run "$P -f $D/004_art_animation_hint.sql"
run "$P -f $D/probe_checks_004.sql"
run "$P -f $D/004_rollback.sql"
run "$P -f $D/004_art_animation_hint.sql"
run "$P -f $D/004_rollback.sql"
run "$P -f $D/002_rollback.sql"
run "$P -f $D/002_art_animation_instant.sql"
run "$P -f $D/002_rollback.sql"
run "$P -f $D/003_rollback.sql"
run "$P -f $D/003_art_grants.sql"
run "$P -f $D/003_rollback.sql"
run "$P -f $D/001_rollback.sql"
run "$P -c \"select count(*) as left_over from pg_class where relname like 'art_%'\" -t"
run "$B/pg_ctl -D $D/data -m immediate stop >/dev/null"
rm -rf "$D"
echo PROBE OK
