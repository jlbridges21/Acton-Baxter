-- BambooHR OAuth integration for Sam (read-only).
-- Additive only. Tokens are stored encrypted (AES-256-GCM, app-side). No employee records are
-- mirrored here: only the connection, OAuth CSRF states, and Baxter ↔ BambooHR identity links.
-- RLS is enabled with no policies: only server routes (service role) can read or write.

create table if not exists public.bamboohr_connections (
  id uuid primary key default gen_random_uuid(),
  company_domain text not null unique,
  company_id text,
  company_name text,
  connected_email text,
  connected_sub text,
  requested_scopes text[] not null default '{}',
  granted_scopes text[] not null default '{}',
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  status text not null default 'connected'
    check (status in ('connected', 'reauthorization_required', 'error', 'disconnected')),
  capabilities jsonb not null default '{}'::jsonb,
  capabilities_checked_at timestamptz,
  refresh_lock_until timestamptz,
  last_refresh_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  connected_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bamboohr_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- Baxter account ↔ BambooHR employee. Never matched by name; email suggestions need confirmation.
create table if not exists public.bamboohr_identity_links (
  id uuid primary key default gen_random_uuid(),
  company_domain text not null,
  bamboohr_employee_id text not null check (bamboohr_employee_id ~ '^[0-9]{1,12}$'),
  profile_id uuid references public.profiles (id) on delete cascade,
  work_email text,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  match_method text not null check (match_method in ('email', 'manual')),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bamboohr_identity_links_unique unique (company_domain, bamboohr_employee_id, profile_id)
);

-- One confirmed link per Baxter account and per BambooHR employee.
create unique index if not exists bamboohr_identity_links_profile_confirmed
  on public.bamboohr_identity_links (profile_id) where status = 'confirmed';
create unique index if not exists bamboohr_identity_links_employee_confirmed
  on public.bamboohr_identity_links (company_domain, bamboohr_employee_id) where status = 'confirmed';

do $$
declare t text;
begin
  foreach t in array array['bamboohr_connections', 'bamboohr_identity_links'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['bamboohr_connections', 'bamboohr_oauth_states', 'bamboohr_identity_links'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
