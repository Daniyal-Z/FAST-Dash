-- ============================================================================
-- FAST-Dash schema
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- It is written to be safely re-runnable.
--
-- Security model
--   * Anyone, signed in or not, may READ the published datasets. That is the
--     whole point of the site.
--   * Only rows in public.admins may write anything.
--   * The browser only ever holds the anon key, so RLS is the real boundary.
-- ============================================================================

-- ----------------------------------------------------------------- tables --

-- One row per kind. Publishing replaces the row, so there is exactly one live
-- timetable and one live datesheet at any moment.
create table if not exists public.datasets (
  kind            text primary key check (kind in ('timetable', 'datesheet')),
  label           text not null,
  payload         jsonb not null,
  source_filename text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users on delete set null
);

create table if not exists public.admins (
  user_id  uuid primary key references auth.users on delete cascade,
  email    text not null,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users on delete set null
);

create table if not exists public.upload_log (
  id               bigint generated always as identity primary key,
  kind             text not null,
  label            text,
  filename         text,
  stats            jsonb,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users on delete set null,
  -- Denormalised so the audit trail survives an account being revoked.
  created_by_email text
);

create index if not exists upload_log_created_at_idx
  on public.upload_log (created_at desc);

-- --------------------------------------------------------------- helpers --

-- SECURITY DEFINER so the function can read public.admins without tripping the
-- policies defined on that same table (which would otherwise recurse).
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------------- RLS --

alter table public.datasets  enable row level security;
alter table public.admins    enable row level security;
alter table public.upload_log enable row level security;

-- datasets: world-readable, admin-writable.
drop policy if exists "datasets are public" on public.datasets;
create policy "datasets are public"
  on public.datasets for select
  to anon, authenticated
  using (true);

drop policy if exists "admins insert datasets" on public.datasets;
create policy "admins insert datasets"
  on public.datasets for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update datasets" on public.datasets;
create policy "admins update datasets"
  on public.datasets for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admins: you may always see your own row (this is how the app decides whether
-- to show the admin UI); admins additionally see everyone.
drop policy if exists "read own or all if admin" on public.admins;
create policy "read own or all if admin"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Writes to public.admins go exclusively through the admin-invite Edge
-- Function, which uses the service role. No client-side policy is granted.

-- upload_log: admins only, and inserts must be attributed to the caller.
drop policy if exists "admins read log" on public.upload_log;
create policy "admins read log"
  on public.upload_log for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins write log" on public.upload_log;
create policy "admins write log"
  on public.upload_log for insert
  to authenticated
  with check (public.is_admin() and created_by = auth.uid());

-- --------------------------------------------------------------- storage --

insert into storage.buckets (id, name, public)
values ('source-workbooks', 'source-workbooks', false)
on conflict (id) do nothing;

drop policy if exists "admins read workbooks" on storage.objects;
create policy "admins read workbooks"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'source-workbooks' and public.is_admin());

drop policy if exists "admins upload workbooks" on storage.objects;
create policy "admins upload workbooks"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'source-workbooks' and public.is_admin());

-- ------------------------------------------------------------- bootstrap --
--
-- There is no way to invite the very first administrator from inside the app,
-- so create one by hand:
--
--   1. Authentication -> Users -> "Add user" (set a password, confirm email).
--   2. Copy that user's UUID, then run:
--
--        insert into public.admins (user_id, email)
--        values ('00000000-0000-0000-0000-000000000000', 'you@example.com')
--        on conflict (user_id) do nothing;
--
--   3. Authentication -> Providers -> Email: turn OFF "Allow new users to sign
--      up". From then on, accounts only come from the in-app invite flow.
