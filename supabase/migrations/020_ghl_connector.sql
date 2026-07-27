-- Prompt 1: GoHighLevel connector connections + OAuth CSRF state + metadata cache.
-- Live CRM records are NOT mirrored into knowledge_entries / knowledge_units.

create table if not exists public.ghl_connections (
  id uuid primary key default gen_random_uuid(),
  auth_mode text not null
    check (auth_mode in ('oauth', 'private_integration')),
  location_id text not null,
  company_id text,
  location_name text,
  location_timezone text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  granted_scopes jsonb not null default '[]'::jsonb,
  expected_scopes jsonb not null default '[]'::jsonb,
  status text not null
    check (status in (
      'disconnected',
      'pending',
      'connected',
      'reauthorization_required',
      'misconfigured',
      'warning',
      'offline',
      'error'
    )),
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message_safe text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ghl_connections_status_idx
  on public.ghl_connections (status, auth_mode);

create index if not exists ghl_connections_location_idx
  on public.ghl_connections (location_id);

create trigger ghl_connections_set_updated_at
  before update on public.ghl_connections
  for each row execute function public.set_updated_at();

alter table public.ghl_connections enable row level security;

create policy "Admins can read ghl connection metadata"
  on public.ghl_connections for select
  to authenticated
  using (public.is_admin());

create policy "Admins cannot insert ghl connections via client"
  on public.ghl_connections for insert
  to authenticated
  with check (false);

create policy "Admins cannot update ghl connections via client"
  on public.ghl_connections for update
  to authenticated
  using (false);

create policy "Admins cannot delete ghl connections via client"
  on public.ghl_connections for delete
  to authenticated
  using (false);

comment on table public.ghl_connections is
  'GoHighLevel connector connection metadata. Encrypted tokens are server/service-role only.';

-- Short-lived OAuth CSRF state (service role only)
create table if not exists public.ghl_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  return_path text not null default '/admin/connectors/ghl',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ghl_oauth_states_expires_idx
  on public.ghl_oauth_states (expires_at);

alter table public.ghl_oauth_states enable row level security;

create policy "No client access to ghl oauth states"
  on public.ghl_oauth_states for all
  to authenticated
  using (false)
  with check (false);

-- Cached reference metadata (pipelines, custom fields, tags, users) — not live CRM rows
create table if not exists public.ghl_reference_cache (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  resource_type text not null
    check (resource_type in (
      'pipelines',
      'custom_fields',
      'tags',
      'users',
      'calendars',
      'phone_numbers'
    )),
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (location_id, resource_type)
);

create index if not exists ghl_reference_cache_expires_idx
  on public.ghl_reference_cache (expires_at);

create trigger ghl_reference_cache_set_updated_at
  before update on public.ghl_reference_cache
  for each row execute function public.set_updated_at();

alter table public.ghl_reference_cache enable row level security;

create policy "Admins can read ghl reference cache"
  on public.ghl_reference_cache for select
  to authenticated
  using (public.is_admin());

create policy "No client writes to ghl reference cache"
  on public.ghl_reference_cache for insert
  to authenticated
  with check (false);

create policy "No client updates to ghl reference cache"
  on public.ghl_reference_cache for update
  to authenticated
  using (false);

create policy "No client deletes to ghl reference cache"
  on public.ghl_reference_cache for delete
  to authenticated
  using (false);

-- Future write-audit foundation (Prompt 2). Prompt 1 does not write CRM data.
create table if not exists public.ghl_action_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  conversation_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  before_state jsonb,
  after_state jsonb,
  status text not null default 'planned'
    check (status in ('planned', 'pending_approval', 'succeeded', 'failed', 'cancelled')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ghl_action_audit_created_idx
  on public.ghl_action_audit (created_at desc);

alter table public.ghl_action_audit enable row level security;

create policy "Admins can read ghl action audit"
  on public.ghl_action_audit for select
  to authenticated
  using (public.is_admin());

create policy "No client writes to ghl action audit"
  on public.ghl_action_audit for insert
  to authenticated
  with check (false);
