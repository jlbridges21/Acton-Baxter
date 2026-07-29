-- Prompt 1: Slack live search — per-user OAuth connections + Baxter↔Slack mapping.
-- Does NOT store Slack message bodies, history, or embeddings.
-- Slack remains the source of truth; Baxter retrieves messages live at query time.

create table if not exists public.slack_search_connections (
  id uuid primary key default gen_random_uuid(),
  baxter_user_id uuid not null references public.profiles (id) on delete cascade,
  slack_user_id text not null,
  slack_team_id text not null,
  slack_user_name text,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  granted_scopes jsonb not null default '[]'::jsonb,
  status text not null
    check (status in (
      'connected',
      'reauthorization_required',
      'revoked',
      'error'
    )),
  last_verified_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message_safe text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (baxter_user_id, slack_team_id),
  unique (slack_team_id, slack_user_id)
);

create index if not exists slack_search_connections_baxter_idx
  on public.slack_search_connections (baxter_user_id, status);

create index if not exists slack_search_connections_slack_idx
  on public.slack_search_connections (slack_team_id, slack_user_id, status);

create trigger slack_search_connections_set_updated_at
  before update on public.slack_search_connections
  for each row execute function public.set_updated_at();

alter table public.slack_search_connections enable row level security;

create policy "Users can read own slack search connection metadata"
  on public.slack_search_connections for select
  to authenticated
  using (baxter_user_id = auth.uid() or public.is_admin());

create policy "No client insert of slack search connections"
  on public.slack_search_connections for insert
  to authenticated
  with check (false);

create policy "No client update of slack search connections"
  on public.slack_search_connections for update
  to authenticated
  using (false);

create policy "No client delete of slack search connections"
  on public.slack_search_connections for delete
  to authenticated
  using (false);

comment on table public.slack_search_connections is
  'Per-user Slack OAuth tokens for Real-time Search. Encrypted tokens are service-role only. No message bodies.';

-- Short-lived OAuth CSRF state (service role only)
create table if not exists public.slack_search_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  baxter_user_id uuid not null references public.profiles (id) on delete cascade,
  return_path text not null default '/admin/slack',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists slack_search_oauth_states_expires_idx
  on public.slack_search_oauth_states (expires_at);

alter table public.slack_search_oauth_states enable row level security;

create policy "No client access to slack search oauth states"
  on public.slack_search_oauth_states for all
  to authenticated
  using (false)
  with check (false);

comment on table public.slack_search_oauth_states is
  'CSRF state for Slack search user OAuth. Service-role only.';
