-- Checkpoint v2 Part F: sync tables in the shared Supabase project "iris-apps".
-- Prefixed cp_ so they never touch Boss Fridge's bf_ tables. Additive only: nothing existing is altered.
-- Row-level security on every table: a signed-in user reads and writes only their own rows; anonymous
-- requests see nothing. The page holds only the public publishable key.

create table if not exists public.cp_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- One row per trading day ("YYYY-MM-DD"), plus one row "_settings" for settings / checklists / presets.
create table if not exists public.cp_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date text not null,
  json jsonb not null,
  device text,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- The append-only event log, one row per event (duplicates are ignored on insert).
create table if not exists public.cp_events (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date text not null,
  t text not null,
  type text not null,
  detail text not null default '',
  primary key (user_id, date, t, type, detail)
);

-- Claude's end-of-day fill per day.
create table if not exists public.cp_filled (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date text not null,
  json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists cp_days_updated_idx on public.cp_days (user_id, updated_at);
create index if not exists cp_filled_updated_idx on public.cp_filled (user_id, updated_at);

-- updated_at moves on every write, so a device can pull only what changed since its last pull.
create or replace function public.cp_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists cp_days_touch on public.cp_days;
create trigger cp_days_touch before insert or update on public.cp_days for each row execute function public.cp_touch();
drop trigger if exists cp_filled_touch on public.cp_filled;
create trigger cp_filled_touch before insert or update on public.cp_filled for each row execute function public.cp_touch();

alter table public.cp_profiles enable row level security;
alter table public.cp_days enable row level security;
alter table public.cp_events enable row level security;
alter table public.cp_filled enable row level security;

create policy cp_profiles_own on public.cp_profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy cp_days_own on public.cp_days for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy cp_events_own on public.cp_events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy cp_filled_own on public.cp_filled for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.cp_profiles, public.cp_days, public.cp_events, public.cp_filled from anon;
