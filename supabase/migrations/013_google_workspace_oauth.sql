-- Prompt 2: Google Workspace OAuth connections + CSRF state

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  auth_mode text not null
    check (auth_mode in ('workspace_oauth', 'service_account', 'domain_wide_delegation')),
  google_account_email text,
  google_account_subject text,
  hosted_domain text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  granted_scopes jsonb not null default '[]'::jsonb,
  status text not null
    check (status in (
      'pending', 'connected', 'reauthorization_required', 'invalid', 'disconnected', 'error'
    )),
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message_safe text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists google_connections_status_idx
  on public.google_connections (status, auth_mode);

create index if not exists google_connections_email_idx
  on public.google_connections (google_account_email);

create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function public.set_updated_at();

alter table public.google_connections enable row level security;

-- Admins may read connection metadata, but encrypted tokens must never be
-- selected by the browser client. Application code uses the service role.
create policy "Admins can read google connection metadata"
  on public.google_connections for select
  to authenticated
  using (public.is_admin());

create policy "Admins cannot insert google connections via client"
  on public.google_connections for insert
  to authenticated
  with check (false);

create policy "Admins cannot update google connections via client"
  on public.google_connections for update
  to authenticated
  using (false);

create policy "Admins cannot delete google connections via client"
  on public.google_connections for delete
  to authenticated
  using (false);

-- Short-lived OAuth CSRF state (server-only via service role)
create table if not exists public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  return_path text not null default '/admin/connectors/google',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists google_oauth_states_expires_idx
  on public.google_oauth_states (expires_at);

alter table public.google_oauth_states enable row level security;

-- No client policies — service role only
create policy "No client access to google oauth states"
  on public.google_oauth_states for all
  to authenticated
  using (false)
  with check (false);
