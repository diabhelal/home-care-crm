-- Minimal Supabase-compatible shims for an ISOLATED local Postgres (never the live DB).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;

create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean default false,
                         raw_app_meta_data jsonb default '{}');
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant usage on schema public to anon, authenticated;

-- Supabase's default privileges in `public` (read from a real Supabase project's pg_default_acl, 2026-11-16):
-- every NEW table/view, sequence and function created by postgres is granted to anon, authenticated and
-- service_role (tables: ALL incl. DELETE/TRUNCATE). A migration that only GRANTs what it wants, without first
-- REVOKE-ing, therefore leaves extra privileges on real Supabase. Reproduced here so the local DB tests and
-- verify_proposed_sql.py see the same grants as the hosted database.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
