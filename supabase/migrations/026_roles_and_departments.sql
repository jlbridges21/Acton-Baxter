-- Baxter roles + departments architecture.
-- Migrates salesperson -> user; adds super_admin; seeds departments.

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint departments_name_unique unique (name),
  constraint departments_slug_unique unique (slug)
);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

insert into public.departments (name, slug, sort_order)
values
  ('Sales', 'sales', 10),
  ('Design', 'design', 20),
  ('Marketing', 'marketing', 30),
  ('Project Management', 'project_management', 40),
  ('Production', 'production', 50),
  ('Operations', 'operations', 60)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- profiles.department_id
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists department_id uuid references public.departments (id) on delete set null;

create index if not exists profiles_department_id_idx
  on public.profiles (department_id);

-- ---------------------------------------------------------------------------
-- profiles.role migration (order matters for production safety)
-- Drop/widen the check constraint BEFORE assigning the new role value "user".
-- Updating to "user" while the old constraint (admin|salesperson|new_user) is
-- still active fails with 23514 profiles_role_check.
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

-- Temporary bridge: allow legacy + new values during the data rewrite.
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('new_user', 'salesperson', 'user', 'admin', 'super_admin'));

update public.profiles
set role = 'user'
where role = 'salesperson';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('new_user', 'user', 'admin', 'super_admin'));

-- ---------------------------------------------------------------------------
-- is_admin(): admin OR super_admin
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- admin_set_profile_role — new_user | user | admin | super_admin
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
  if new_role is null or new_role not in ('new_user', 'user', 'admin', 'super_admin') then
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

    if caller_role not in ('admin', 'super_admin') then
      raise exception 'Only admins can change profile roles' using errcode = '42501';
    end if;

    select lower(u.email) into caller_email
    from auth.users u
    where u.id = caller_id;

    is_super := caller_email = 'baxter@actonadu.com' or caller_role = 'super_admin';

    -- Regular admins may assign new_user, user, admin only.
    if new_role = 'super_admin' and not is_super then
      raise exception 'Only a super-admin can grant super_admin access'
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
-- Trigger: prevent unauthorized role escalation
-- ---------------------------------------------------------------------------
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_email text;
  is_super boolean := false;
begin
  if tg_op = 'UPDATE' and old.role is distinct from new.role then
    if auth.role() = 'service_role' or auth.uid() is null then
      return new;
    end if;

    if public.is_admin() then
      select p.role into caller_role
      from public.profiles p
      where p.id = auth.uid();

      select lower(u.email) into caller_email
      from auth.users u
      where u.id = auth.uid();

      is_super := caller_email = 'baxter@actonadu.com' or caller_role = 'super_admin';

      if new.role = 'super_admin' and not is_super then
        raise exception 'Only a super-admin can grant super_admin access';
      end if;

      return new;
    end if;

    raise exception 'Only admins can change profile roles';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- departments RLS
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;

drop policy if exists "Authenticated users can read active departments" on public.departments;
create policy "Authenticated users can read active departments"
  on public.departments for select
  to authenticated
  using (is_active = true);

drop policy if exists "Admins can manage departments" on public.departments;
create policy "Admins can manage departments"
  on public.departments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bootstrap super-admin account
-- ---------------------------------------------------------------------------
update public.profiles p
set role = 'super_admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'baxter@actonadu.com'
  and p.role is distinct from 'super_admin';
