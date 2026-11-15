-- For tests on a plain local Postgres only. Never run this on Neon.
--
-- Neon creates these when the Data API is enabled. Here, `auth.user_id()`
-- reads the `sub` claim from the `request.jwt.claims` setting, which is the
-- PostgREST-compatible fallback that Neon's pg_session_jwt extension
-- documents. Tests set that value to act as different users.

create role authenticated nologin;
create role anonymous nologin;
create schema auth;
create function auth.user_id() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'
$$;
grant usage on schema auth to authenticated, anonymous;
grant usage on schema public to authenticated, anonymous;
