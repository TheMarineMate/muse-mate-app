-- 005_fix_guard_last_owner.sql  (Phase 2 fix)
-- guard_last_owner (003) blocked legitimate project deletion: DELETE FROM
-- projects cascades to project_members, and the trigger on project_members
-- fired for that cascade-caused delete too, saw "removing the only owner",
-- and rejected it -- so a project could never be deleted.
--
-- This is the Section 28 cascade trap by name: a child-table trigger must
-- account for the parent row already being gone by the time it fires during a
-- cascade delete. Fix: if public.projects no longer has a row for
-- old.project_id, this delete is part of the project itself being removed --
-- let it through. A direct delete/demote of the owner row while the project
-- still exists is still blocked exactly as before.

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
  if tg_op = 'DELETE' then
    v_still_owner := false;
  else
    v_still_owner := (new.role = 'owner' and new.status = 'active');
  end if;

  if v_was_owner and not v_still_owner then
    -- Parent project already gone (or going) in the same statement/cascade --
    -- e.g. DELETE FROM projects cascading into project_members. Not the
    -- "orphan a live project" case this guard exists to prevent.
    if exists (select 1 from public.projects where id = old.project_id) then
      if (
        select count(*) from public.project_members
        where project_id = old.project_id and role = 'owner' and status = 'active'
      ) <= 1 then
        raise exception 'cannot remove or demote the last owner of a project';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
