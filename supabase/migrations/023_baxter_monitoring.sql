-- Prompt 2: Baxter monitoring + Rulebook admin control plane support.
-- Buildertrend remains schema-compatible only (not connected).

-- ---------------------------------------------------------------------------
-- Role retirement (prefer retire over destructive delete)
-- ---------------------------------------------------------------------------
alter table public.process_roles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'retired'));

create index if not exists process_roles_status_idx
  on public.process_roles (status);

-- ---------------------------------------------------------------------------
-- Rulebook admin audit (meaningful saved mutations)
-- ---------------------------------------------------------------------------
create table if not exists public.rulebook_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  version_id uuid references public.rulebook_versions (id) on delete set null,
  resource_type text,
  resource_id text,
  summary text,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists rulebook_admin_audit_created_idx
  on public.rulebook_admin_audit (created_at desc);

create index if not exists rulebook_admin_audit_version_idx
  on public.rulebook_admin_audit (version_id, created_at desc);

alter table public.rulebook_admin_audit enable row level security;

create policy "Admins can read rulebook admin audit"
  on public.rulebook_admin_audit for select to authenticated
  using (public.is_admin());

create policy "No client insert rulebook admin audit"
  on public.rulebook_admin_audit for insert to authenticated with check (false);
create policy "No client update rulebook admin audit"
  on public.rulebook_admin_audit for update to authenticated using (false);
create policy "No client delete rulebook admin audit"
  on public.rulebook_admin_audit for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- GHL ↔ Rulebook mappings (explicit; never join by display name alone)
-- ---------------------------------------------------------------------------
create table if not exists public.ghl_rulebook_mappings (
  id uuid primary key default gen_random_uuid(),
  ghl_pipeline_id text not null,
  ghl_pipeline_name text,
  ghl_stage_id text not null,
  ghl_stage_name text,
  rulebook_stage_key text not null,
  rulebook_step_key text,
  enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (ghl_pipeline_id, ghl_stage_id)
);

create index if not exists ghl_rulebook_mappings_enabled_idx
  on public.ghl_rulebook_mappings (enabled);

create trigger ghl_rulebook_mappings_set_updated_at
  before update on public.ghl_rulebook_mappings
  for each row execute function public.set_updated_at();

alter table public.ghl_rulebook_mappings enable row level security;

create policy "Admins can read ghl rulebook mappings"
  on public.ghl_rulebook_mappings for select to authenticated
  using (public.is_admin());

create policy "No client insert ghl rulebook mappings"
  on public.ghl_rulebook_mappings for insert to authenticated with check (false);
create policy "No client update ghl rulebook mappings"
  on public.ghl_rulebook_mappings for update to authenticated using (false);
create policy "No client delete ghl rulebook mappings"
  on public.ghl_rulebook_mappings for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Monitoring settings (singleton row id = 'default')
-- Defaults: monitoring DISABLED until admin enables.
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_settings (
  id text primary key default 'default' check (id = 'default'),
  enabled boolean not null default false,
  pilot_slack_channel_id text,
  pilot_slack_channel_name text,
  timezone text not null default 'America/Los_Angeles',
  quiet_hours_start text, -- HH:MM
  quiet_hours_end text,
  delivery_mode text not null default 'digest'
    check (delivery_mode in ('immediate', 'digest')),
  escalation_window_minutes integer not null default 240
    check (escalation_window_minutes > 0),
  default_stale_days integer not null default 3
    check (default_stale_days > 0),
  monitored_pipeline_ids jsonb not null default '[]'::jsonb,
  check_configs jsonb not null default '{}'::jsonb,
  stage_stale_overrides jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.monitoring_settings (id)
values ('default')
on conflict (id) do nothing;

create trigger monitoring_settings_set_updated_at
  before update on public.monitoring_settings
  for each row execute function public.set_updated_at();

alter table public.monitoring_settings enable row level security;

create policy "Admins can read monitoring settings"
  on public.monitoring_settings for select to authenticated
  using (public.is_admin());

create policy "No client insert monitoring settings"
  on public.monitoring_settings for insert to authenticated with check (false);
create policy "No client update monitoring settings"
  on public.monitoring_settings for update to authenticated using (false);
create policy "No client delete monitoring settings"
  on public.monitoring_settings for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Monitoring findings
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_findings (
  id uuid primary key default gen_random_uuid(),
  check_key text not null,
  dedupe_key text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  entity_type text not null,
  entity_id text,
  contact_id text,
  opportunity_id text,
  rulebook_stage_key text,
  rulebook_step_key text,
  title text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  recommendation text,
  responsible_role_key text,
  responsible_profile_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open'
    check (status in (
      'open',
      'alerted',
      'acknowledged',
      'resolved',
      'dismissed_false_positive',
      'expired'
    )),
  detected_at timestamptz not null default timezone('utc', now()),
  last_detected_at timestamptz not null default timezone('utc', now()),
  alerted_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by_slack_user_id text,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by_slack_user_id text,
  escalated_at timestamptz,
  slack_channel_id text,
  slack_message_ts text,
  slack_thread_ts text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (dedupe_key)
);

create index if not exists monitoring_findings_status_idx
  on public.monitoring_findings (status, last_detected_at desc);

create index if not exists monitoring_findings_check_idx
  on public.monitoring_findings (check_key, status);

create index if not exists monitoring_findings_slack_ts_idx
  on public.monitoring_findings (slack_channel_id, slack_message_ts)
  where slack_message_ts is not null;

create trigger monitoring_findings_set_updated_at
  before update on public.monitoring_findings
  for each row execute function public.set_updated_at();

alter table public.monitoring_findings enable row level security;

create policy "Admins can read monitoring findings"
  on public.monitoring_findings for select to authenticated
  using (public.is_admin());

create policy "No client insert monitoring findings"
  on public.monitoring_findings for insert to authenticated with check (false);
create policy "No client update monitoring findings"
  on public.monitoring_findings for update to authenticated using (false);
create policy "No client delete monitoring findings"
  on public.monitoring_findings for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Monitoring runs
-- ---------------------------------------------------------------------------
create table if not exists public.monitoring_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'cron', 'job')),
  checks_run integer not null default 0,
  records_evaluated integer not null default 0,
  new_findings integer not null default 0,
  refreshed_findings integer not null default 0,
  resolved_findings integer not null default 0,
  duration_ms integer,
  error_message text,
  summary_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists monitoring_runs_started_idx
  on public.monitoring_runs (started_at desc);

alter table public.monitoring_runs enable row level security;

create policy "Admins can read monitoring runs"
  on public.monitoring_runs for select to authenticated
  using (public.is_admin());

create policy "No client insert monitoring runs"
  on public.monitoring_runs for insert to authenticated with check (false);
create policy "No client update monitoring runs"
  on public.monitoring_runs for update to authenticated using (false);
create policy "No client delete monitoring runs"
  on public.monitoring_runs for delete to authenticated using (false);

-- ---------------------------------------------------------------------------
-- Job types for monitoring
-- ---------------------------------------------------------------------------
alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction'
  ));

comment on table public.monitoring_findings is
  'Deterministic operational findings from Baxter monitoring. LLM never creates these.';
comment on table public.ghl_rulebook_mappings is
  'Explicit GHL pipeline/stage → Rulebook stage/step mappings. No name-based joins.';
comment on table public.monitoring_settings is
  'Admin-tunable monitoring configuration. Defaults to disabled.';
