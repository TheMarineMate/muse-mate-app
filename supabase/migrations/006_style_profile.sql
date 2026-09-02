-- 006_style_profile.sql  (Phase 6)
-- Project Style Profile & Conversational Muse (spec Section 9).
--
-- Section 5 rules: ALTER only, never DROP; IF NOT EXISTS on column adds;
-- sequential numbering; run by hand in the Supabase SQL Editor. Re-runnable:
-- policies use drop-if-exists + create.
--
-- New columns are all nullable by design — a project with no style profile
-- yet reads null across the board, so there is nothing to backfill.

-- ============================================================================
-- projects — style profile + shopping preference columns (spec 9.3)
-- ============================================================================
alter table public.projects
  add column if not exists style_summary      text,
  add column if not exists style_confirmed_at timestamptz,
  add column if not exists prefers_unique     boolean,   -- handmade / one-of-a-kind lean vs mass-market
  add column if not exists deal_sensitive     boolean;   -- actively check current sales / promo codes

comment on column public.projects.style_summary is
  'Confirmed mood/descriptor summary from the style-intake conversation (spec 9.1).';
comment on column public.projects.style_confirmed_at is
  'Set/refreshed each time the user confirms the profile. Additive, not a lock.';

-- ============================================================================
-- style_references — persisted visual record of the project vibe (spec 9.3)
-- ============================================================================
-- Unlike the sourcing/style chat transcript (ephemeral, never persisted),
-- these rows are a lasting record: uploaded photos + real web images/links the
-- conversation converged on.
create table if not exists public.style_references (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  kind         text not null check (kind in ('uploaded_image', 'web_image', 'web_link')),
  -- uploaded_image: object key inside the 'style-references' Storage bucket,
  --   path convention '<project_id>/<uuid>.<ext>'.
  storage_path text,
  -- web_image | web_link: the real, retrievable URL (rail 9.4 — never fabricated).
  url          text,
  caption      text,
  created_at   timestamptz not null default now(),
  -- exactly one location field, matching the kind
  constraint style_references_location_matches_kind check (
    (kind = 'uploaded_image' and storage_path is not null and url is null)
    or (kind in ('web_image', 'web_link') and url is not null and storage_path is null)
  )
);

create index if not exists style_references_project_id_idx
  on public.style_references (project_id);

alter table public.style_references enable row level security;

-- Same role shape as rooms (003_rls.sql): viewer reads, editor+ writes.
drop policy if exists style_references_select on public.style_references;
create policy style_references_select on public.style_references
  for select using (public.is_project_member(project_id, 'viewer'));

drop policy if exists style_references_insert on public.style_references;
create policy style_references_insert on public.style_references
  for insert with check (public.is_project_member(project_id, 'editor'));

drop policy if exists style_references_update on public.style_references;
create policy style_references_update on public.style_references
  for update using (public.is_project_member(project_id, 'editor'))
  with check (public.is_project_member(project_id, 'editor'));

drop policy if exists style_references_delete on public.style_references;
create policy style_references_delete on public.style_references
  for delete using (public.is_project_member(project_id, 'editor'));

-- ============================================================================
-- Storage bucket for uploaded style-reference images (spec 9.3)
-- ============================================================================
-- No canonical Storage section in the platform build-standards doc; these
-- policies mirror the rooms RLS shape (Section 4 access model): first path
-- segment is the project_id, editor+ writes, viewer reads, non-members see
-- nothing. Private bucket — images are always served through signed URLs.
insert into storage.buckets (id, name, public)
values ('style-references', 'style-references', false)
on conflict (id) do nothing;

-- (storage.foldername(name))[1] is the first path segment, i.e. the project id.
drop policy if exists style_ref_objects_select on storage.objects;
create policy style_ref_objects_select on storage.objects
  for select using (
    bucket_id = 'style-references'
    and public.is_project_member(((storage.foldername(name))[1])::uuid, 'viewer')
  );

drop policy if exists style_ref_objects_insert on storage.objects;
create policy style_ref_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'style-references'
    and public.is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );

drop policy if exists style_ref_objects_update on storage.objects;
create policy style_ref_objects_update on storage.objects
  for update using (
    bucket_id = 'style-references'
    and public.is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  )
  with check (
    bucket_id = 'style-references'
    and public.is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );

drop policy if exists style_ref_objects_delete on storage.objects;
create policy style_ref_objects_delete on storage.objects
  for delete using (
    bucket_id = 'style-references'
    and public.is_project_member(((storage.foldername(name))[1])::uuid, 'editor')
  );
