-- =====================================================================
--  Neon RLS — defence in depth behind the tRPC layer's own scoping
--  Run AFTER 0000_init.sql and 02_functions.sql
--
--  How this maps to what Supabase did for free:
--
--    Supabase                     Neon
--    ------------------------     ---------------------------------
--    auth.uid()               ->  auth.user_id()   (pg_session_jwt)
--    the anon/authenticated
--    JWT in the request       ->  a JWT minted by Better Auth's jwt
--                                 plugin, verified against the JWKS
--                                 published at /api/auth/jwks
--
--  Set the JWKS URL first, in the Neon Console:
--    Project -> Settings -> RLS -> Add Authentication Provider
--    JWKS URL: https://YOUR-APP-URL/api/auth/jwks
--    (local dev: expose http://localhost:3000/api/auth/jwks with a tunnel,
--     or skip RLS locally — the app works without it.)
--
--  Queries only run under these policies when they go through
--  DATABASE_AUTHENTICATED_URL (see src/server/db/index.ts). The owner
--  connection Better Auth and the seeding hook use bypasses RLS by design.
-- =====================================================================

create extension if not exists pg_session_jwt;

-- The role your DATABASE_AUTHENTICATED_URL connects as.
do $$ begin
  create role authenticated noinherit;
exception when duplicate_object then null; end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.payment_methods    enable row level security;
alter table public.expenses           enable row level security;
alter table public.recurring_patterns enable row level security;
alter table public.chat_sessions      enable row level security;
alter table public.chat_messages      enable row level security;

-- profiles key off `id`; everything else off `user_id`.
do $$
declare t text;
begin
  execute 'drop policy if exists profiles_own on public.profiles';
  execute $f$create policy profiles_own on public.profiles
             for all to authenticated
             using (id = auth.user_id()) with check (id = auth.user_id())$f$;

  foreach t in array array[
    'categories','payment_methods','expenses',
    'recurring_patterns','chat_sessions','chat_messages'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format($f$create policy %I on public.%I
                      for all to authenticated
                      using (user_id = auth.user_id())
                      with check (user_id = auth.user_id())$f$, t || '_own', t);
  end loop;
end $$;
