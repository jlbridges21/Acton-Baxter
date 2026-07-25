-- Prompt: admin role management + super-admin bootstrap
-- Fixes: admins cannot update other profiles (RLS); Table Editor role edits blocked;
--         ensure baxter@actonadu.com can administer roles.

-- ---------------------------------------------------------------------------
-- Safe role change RPC (SECURITY DEFINER) — preferred path for the app
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_profile_role(
  target_user_id uuid,
  new_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_is_service boolean := (auth.role() = 'service_role');
  caller_role text;
  caller_email text;
  is_super boolean := false;
  updated_row public.profiles;
begin
  if new_role is null or new_role not in ('admin', 'salesperson', 'new_user') then
    raise exception 'Invalid role: %', new_role using errcode = '22023';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required' using errcode = '22023';
  end if;

  if caller_is_service then
    is_super := true;
  else
    if caller_id is null then
      raise exception 'Authentication required to change roles' using errcode = '42501';
    end if;

    select p.role into caller_role
    from public.profiles p
    where p.id = caller_id;

    if caller_role is distinct from 'admin' then
      raise exception 'Only admins can change profile roles' using errcode = '42501';
    end if;

    select lower(u.email) into caller_email
    from auth.users u
    where u.id = caller_id;

    is_super := caller_email = 'baxter@actonadu.com';

    -- Regular admins may grant/revoke salesperson and new_user only.
    -- Super-admin (baxter@actonadu.com) or service_role may also grant admin.
    if new_role = 'admin' and not is_super then
      raise exception 'Only the super-admin (baxter@actonadu.com) can grant admin access'
        using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  return updated_row;
end;
$$;

revoke all on function public.admin_set_profile_role(uuid, text) from public;
grant execute on function public.admin_set_profile_role(uuid, text) to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: allow service_role + admins; keep non-admins from self-promoting
-- ---------------------------------------------------------------------------
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text;
begin
  if tg_op = 'UPDATE' and old.role is distinct from new.role then
    -- service_role / SQL as postgres: auth.uid() is null OR auth.role() is service_role
    if auth.role() = 'service_role' or auth.uid() is null then
      return new;
    end if;

    if public.is_admin() then
      -- Admins changing roles: restrict admin grants to super-admin email
      if new.role = 'admin' then
        select lower(u.email) into caller_email
        from auth.users u
        where u.id = auth.uid();
        if caller_email is distinct from 'baxter@actonadu.com' then
          raise exception 'Only the super-admin (baxter@actonadu.com) can grant admin access';
        end if;
      end if;
      return new;
    end if;

    raise exception 'Only admins can change profile roles';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: admins can update any profile (in addition to users updating themselves)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Self-update: users may edit their own row; role changes are enforced by trigger + RPC.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Signup: never honor client-supplied role metadata (always new_user)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), ''),
    'new_user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap: ensure baxter@actonadu.com is admin when the auth user exists
-- ---------------------------------------------------------------------------
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'baxter@actonadu.com'
  and p.role is distinct from 'admin';
