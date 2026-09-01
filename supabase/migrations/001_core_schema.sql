-- 001_core_schema.sql
-- Muse Mate core tables: projects (the asset) + project_members, rooms, items,
-- placements. Section 5 rules: never DROP; ALTER only; sequential numbering;
-- IF NOT EXISTS on column adds; run this by hand in the Supabase SQL Editor.
--
-- RLS is ENABLED on every table here with NO policies yet, so the tables are
-- deny-all to anon/authed clients until 003_rls.sql (Phase 2) lands. The
-- service-role key still has full access for the schema smoke test.

create extension if not exists pgcrypto;

-- Shared updated_at trigger ------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- projects --------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  address       text,
  vibe_notes    text,
  palette       jsonb not null default '[]'::jsonb,
  budget_target numeric(12, 2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- project_members -----------------------------------------------------------
-- The [asset]_members table (Section 5). No scope columns: Muse Mate's access
-- model is role-only by design (spec section 3). The "1 editor + 1 viewer per
-- project" cap for v1 is guided in the UI, not enforced here.
create table if not exists public.project_members (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  invited_email text,
  role          text not null check (role in ('owner', 'editor', 'viewer')),
  status        text not null default 'active' check (status in ('invited', 'active')),
  invited_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- a user appears at most once per project
  constraint project_members_unique_user unique (project_id, user_id),
  -- every row is either a real user or a pending email invite
  constraint project_members_user_or_email check (user_id is not null or invited_email is not null)
);

create index if not exists project_members_project_id_idx on public.project_members (project_id);
create index if not exists project_members_user_id_idx on public.project_members (user_id);

-- rooms -------------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  notes       text,
  photo_url   text,
  wall_length numeric(8, 2), -- inches
  wall_width  numeric(8, 2), -- inches
  doors       jsonb not null default '[]'::jsonb,
  windows     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rooms_project_id_idx on public.rooms (project_id);

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- items -----------------------------------------------------------------------
-- project_id is denormalized from room_id so RLS and the sourcing feature can
-- scope by project without a rooms join on every row.
create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  project_id     uuid not null references public.projects (id) on delete cascade,
  name           text not null,
  priority       text not null default 'nice-to-have' check (priority in ('must-have', 'nice-to-have')),
  status         text not null default 'needed' check (status in ('needed', 'sourced', 'ordered', 'received')),
  price_estimate numeric(12, 2),
  link           text,
  note           text,
  width          numeric(8, 2), -- inches
  depth          numeric(8, 2), -- inches
  height         numeric(8, 2), -- inches
  sourced_at     timestamptz,
  sourced_via    text check (sourced_via in ('manual', 'assistant')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists items_room_id_idx on public.items (room_id);
create index if not exists items_project_id_idx on public.items (project_id);

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- placements ----------------------------------------------------------------
-- One placement per item in v1 (multiple saved layouts are deferred).
create table if not exists public.placements (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items (id) on delete cascade,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  x          numeric(10, 2) not null, -- inches from room outline top-left
  y          numeric(10, 2) not null,
  rotation   numeric(6, 2) not null default 0, -- degrees clockwise
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint placements_unique_item unique (item_id)
);

create index if not exists placements_room_id_idx on public.placements (room_id);

drop trigger if exists placements_set_updated_at on public.placements;
create trigger placements_set_updated_at
  before update on public.placements
  for each row execute function public.set_updated_at();

-- RLS: enabled, no policies yet (deny-all until 003_rls.sql) -----------------
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.rooms           enable row level security;
alter table public.items           enable row level security;
alter table public.placements      enable row level security;
