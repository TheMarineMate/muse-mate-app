-- 003_rls.sql  (Phase 2)
-- Role-based Row Level Security for the five app tables. Section 4 access model:
-- role is owner > editor > viewer, no scope dimension. viewer is read-only at
-- the RLS layer, not just in the UI (spec section 2). Re-runnable: policies use
-- drop-if-exists + create; functions use create-or-replace.

-- ============================================================================
-- Membership helpers
-- ============================================================================
-- SECURITY DEFINER so the function reads project_members with RLS bypassed.
-- Without that, the project_members SELECT policy (which calls this function)
-- would recurse infinitely. search_path pinned per Section hardening guidance.

create or replace function public.is_project_member(
  p_project_id uuid,
  p_min_role text default 'viewer'
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = p_project_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (case m.role
             when 'owner' then 3
             when 'editor' then 2
             when 'viewer' then 1
             else 0
           end)
          >=
          (case p_min_role
             when 'owner' then 3
             when 'editor' then 2
             else 1
           end)
  );
$$;

create or replace function public.is_room_member(
  p_room_id uuid,
  p_min_role text default 'viewer'
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_project_member(
    (select project_id from public.rooms where id = p_room_id),
    p_min_role
  );
$$;

-- ============================================================================
-- Integrity guards (Section 28 — enforce at the DB, not just the UI/API)
-- ============================================================================

-- projects.owner_id never changes through a normal UPDATE. A future ownership
-- transfer would be its own deliberate RPC.
create or replace function public.projects_guard_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'projects.owner_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_guard_owner on public.projects;
create trigger projects_guard_owner
  before update on public.projects
  for each row execute function public.projects_guard_owner();

-- Keep the denormalized items.project_id honest: always the parent room's
-- project. The client does not need to send it.
create or replace function public.items_sync_project_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.project_id := (select project_id from public.rooms where id = new.room_id);
  if new.project_id is null then
    raise exception 'items.room_id % does not resolve to a project', new.room_id;
  end if;
  return new;
end;
$$;

drop trigger if exists items_sync_project_id on public.items;
create trigger items_sync_project_id
  before insert or update on public.items
  for each row execute function public.items_sync_project_id();

-- A placement's room must be the room its item belongs to.
create or replace function public.placements_check_item_room()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_room uuid;
begin
  select room_id into v_room from public.items where id = new.item_id;
  if v_room is null then
    raise exception 'placements.item_id % not found', new.item_id;
  end if;
  if new.room_id is distinct from v_room then
    raise exception 'placements.room_id must match the item''s room';
  end if;
  return new;
end;
$$;

drop trigger if exists placements_check_item_room on public.placements;
create trigger placements_check_item_room
  before insert or update on public.placements
  for each row execute function public.placements_check_item_room();

-- A project must always keep at least one active owner.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_owner boolean := (old.role = 'owner' and old.status = 'active');
  v_still_owner boolean;
begin
  -- NEW does not exist on a DELETE trigger; branch before touching it.
  if tg_op = 'DELETE' then
    v_still_owner := false;
  else
    v_still_owner := (new.role = 'owner' and new.status = 'active');
  end if;

  if v_was_owner and not v_still_owner then
    if (
      select count(*) from public.project_members
      where project_id = old.project_id and role = 'owner' and status = 'active'
    ) <= 1 then
      raise exception 'cannot remove or demote the last owner of a project';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_guard_last_owner on public.project_members;
create trigger project_members_guard_last_owner
  before update or delete on public.project_members
  for each row execute function public.guard_last_owner();

-- ============================================================================
-- projects
-- ============================================================================
-- No direct INSERT policy — projects are created only through
-- public.create_project() (004), which inserts the project row and the owner
-- membership row atomically (Section 4).

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (public.is_project_member(id, 'viewer'));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (public.is_project_member(id, 'editor'))
  with check (public.is_project_member(id, 'editor'));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (public.is_project_member(id, 'owner'));

-- ============================================================================
-- project_members
-- ============================================================================

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select using (
    user_id = auth.uid() or public.is_project_member(project_id, 'viewer')
  );

-- Only an owner adds collaborators, and only as editor/viewer. The first owner
-- row is written by create_project() with RLS bypassed.
drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
  for insert with check (
    public.is_project_member(project_id, 'owner') and role in ('editor', 'viewer')
  );

drop policy if exists project_members_update on public.project_members;
create policy project_members_update on public.project_members
  for update using (public.is_project_member(project_id, 'owner'))
  with check (public.is_project_member(project_id, 'owner') and role in ('editor', 'viewer'));

drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
  for delete using (public.is_project_member(project_id, 'owner'));

-- ============================================================================
-- rooms
-- ============================================================================

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (public.is_project_member(project_id, 'viewer'));

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
  for insert with check (public.is_project_member(project_id, 'editor'));

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
  for update using (public.is_project_member(project_id, 'editor'))
  with check (public.is_project_member(project_id, 'editor'));

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
  for delete using (public.is_project_member(project_id, 'editor'));

-- ============================================================================
-- items
-- ============================================================================
-- project_id is populated by the items_sync_project_id trigger before WITH
-- CHECK runs, so these policies always see the correct project.

drop policy if exists items_select on public.items;
create policy items_select on public.items
  for select using (public.is_project_member(project_id, 'viewer'));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items
  for insert with check (public.is_room_member(room_id, 'editor'));

drop policy if exists items_update on public.items;
create policy items_update on public.items
  for update using (public.is_project_member(project_id, 'editor'))
  with check (public.is_room_member(room_id, 'editor'));

drop policy if exists items_delete on public.items;
create policy items_delete on public.items
  for delete using (public.is_project_member(project_id, 'editor'));

-- ============================================================================
-- placements
-- ============================================================================
-- No project_id column; scope through the room. UPDATE is the "move a box on
-- the floor plan" path — editor+ only, so viewers can't drag (spec section 3).

drop policy if exists placements_select on public.placements;
create policy placements_select on public.placements
  for select using (public.is_room_member(room_id, 'viewer'));

drop policy if exists placements_insert on public.placements;
create policy placements_insert on public.placements
  for insert with check (public.is_room_member(room_id, 'editor'));

drop policy if exists placements_update on public.placements;
create policy placements_update on public.placements
  for update using (public.is_room_member(room_id, 'editor'))
  with check (public.is_room_member(room_id, 'editor'));

drop policy if exists placements_delete on public.placements;
create policy placements_delete on public.placements
  for delete using (public.is_room_member(room_id, 'editor'));
