-- Slack display metadata cache for admin UX (names, avatars, channel labels).
-- Conversation identity remains Slack IDs; these tables are mutable display metadata only.

create table if not exists public.slack_user_profiles (
  slack_user_id text not null,
  team_id text not null,
  display_name text,
  real_name text,
  username text,
  email text,
  avatar_url text,
  is_bot boolean not null default false,
  is_deleted boolean not null default false,
  last_resolved_at timestamptz,
  last_seen_at timestamptz,
  resolve_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (team_id, slack_user_id)
);

create table if not exists public.slack_channel_profiles (
  slack_channel_id text not null,
  team_id text not null,
  name text,
  channel_type text,
  is_private boolean not null default false,
  last_resolved_at timestamptz,
  last_seen_at timestamptz,
  resolve_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (team_id, slack_channel_id)
);

create index if not exists slack_user_profiles_last_seen_idx
  on public.slack_user_profiles (last_seen_at desc nulls last);

create index if not exists slack_channel_profiles_last_seen_idx
  on public.slack_channel_profiles (last_seen_at desc nulls last);

alter table public.slack_user_profiles enable row level security;
alter table public.slack_channel_profiles enable row level security;

drop policy if exists "Admins can read slack user profiles" on public.slack_user_profiles;
create policy "Admins can read slack user profiles"
  on public.slack_user_profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can read slack channel profiles" on public.slack_channel_profiles;
create policy "Admins can read slack channel profiles"
  on public.slack_channel_profiles
  for select
  to authenticated
  using (public.is_admin());

comment on table public.slack_user_profiles is
  'Cached Slack user display metadata for admin UX. Writes via service role.';
comment on table public.slack_channel_profiles is
  'Cached Slack channel display metadata for admin UX. Writes via service role.';
