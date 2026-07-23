-- Allow self-signup with restricted new_user role; persist report map/imagery metadata.

-- ---------------------------------------------------------------------------
-- profiles.role: add new_user
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'salesperson', 'new_user'));

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
    coalesce(new.raw_user_meta_data->>'role', 'salesperson')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Prevent non-admins from changing their own role (defense in depth beyond app checks).
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.role is distinct from new.role then
    -- Allow service-role / SQL admin updates (auth.uid() is null).
    -- Block authenticated non-admins from self-promoting.
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Only admins can change profile roles';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_role_escalation();

-- ---------------------------------------------------------------------------
-- reports.maps_json — Google Maps links + imagery metadata
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists maps_json jsonb;
