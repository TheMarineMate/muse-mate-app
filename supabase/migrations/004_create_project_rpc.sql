-- 004_create_project_rpc.sql  (Phase 2)
-- Atomic project creation (Section 4): the project row and the owner's
-- project_members row are inserted in one transaction, with RLS bypassed, so
-- the owner membership exists before any client RLS check can run. This is the
-- only supported way to create a project — there is no direct INSERT policy on
-- public.projects.

create or replace function public.create_project(
  p_name text,
  p_address text default null,
  p_vibe_notes text default null,
  p_palette jsonb default '[]'::jsonb,
  p_budget_target numeric default null
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.projects;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'project name is required' using errcode = '22023';
  end if;

  insert into public.projects (owner_id, name, address, vibe_notes, palette, budget_target)
  values (
    v_uid,
    btrim(p_name),
    p_address,
    p_vibe_notes,
    coalesce(p_palette, '[]'::jsonb),
    p_budget_target
  )
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role, status, invited_by)
  values (v_project.id, v_uid, 'owner', 'active', v_uid);

  return v_project;
end;
$$;

-- Only signed-in users may call it.
revoke all on function public.create_project(text, text, text, jsonb, numeric) from public;
grant execute on function public.create_project(text, text, text, jsonb, numeric) to authenticated;
