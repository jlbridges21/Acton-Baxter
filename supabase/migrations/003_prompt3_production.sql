-- Prompt 3: address metadata, APN normalization, AI metadata, branding, Slack, jobs

-- Reports: structured address + refresh + AI metadata + normalized APN
alter table public.reports
  add column if not exists google_place_id text,
  add column if not exists address_line_1 text,
  add column if not exists country_code text,
  add column if not exists normalized_apn text,
  add column if not exists parent_report_id uuid references public.reports(id) on delete set null,
  add column if not exists refresh_reason text,
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists ai_generation_status text
    check (
      ai_generation_status is null
      or ai_generation_status in ('success', 'fallback', 'skipped', 'error')
    ),
  add column if not exists ai_prompt_version text,
  add column if not exists ai_generated_at timestamptz,
  add column if not exists ai_input_hash text;

create index if not exists reports_normalized_apn_idx on public.reports (normalized_apn);
create index if not exists reports_parent_report_id_idx on public.reports (parent_report_id);
create index if not exists reports_google_place_id_idx on public.reports (google_place_id);

update public.reports
set normalized_apn = upper(regexp_replace(coalesce(apn, ''), '[^A-Za-z0-9]', '', 'g'))
where apn is not null
  and (normalized_apn is null or normalized_apn = '');

-- Branding settings (singleton)
create table if not exists public.branding_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default 'Acton ADU',
  report_title text not null default 'Acton Property Research',
  logo_storage_path text,
  logo_alt_text text not null default 'Acton ADU logo',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  singleton_key boolean not null default true,
  constraint branding_settings_singleton unique (singleton_key)
);

insert into public.branding_settings (company_name, report_title, logo_alt_text, singleton_key)
values ('Acton ADU', 'Acton Property Research', 'Acton ADU logo', true)
on conflict (singleton_key) do nothing;

alter table public.branding_settings enable row level security;

drop policy if exists "Authenticated users can read branding" on public.branding_settings;
create policy "Authenticated users can read branding"
  on public.branding_settings
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can update branding" on public.branding_settings;
create policy "Admins can update branding"
  on public.branding_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admins can insert branding" on public.branding_settings;
create policy "Admins can insert branding"
  on public.branding_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Slack user mappings
create table if not exists public.slack_user_mappings (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null,
  slack_user_id text not null,
  app_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (slack_team_id, slack_user_id)
);

alter table public.slack_user_mappings enable row level security;

drop policy if exists "Admins can manage slack mappings" on public.slack_user_mappings;
create policy "Admins can manage slack mappings"
  on public.slack_user_mappings
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Durable background jobs
create table if not exists public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete cascade,
  job_type text not null
    check (job_type in ('property_research', 'slack_completion_notification')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_jobs_status_available_idx
  on public.report_jobs (status, available_at);
create index if not exists report_jobs_report_id_idx
  on public.report_jobs (report_id);

alter table public.report_jobs enable row level security;
-- Service role only for jobs (no authenticated policies)

-- Provider call logs for admin diagnostics
create table if not exists public.provider_call_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  endpoint_name text,
  report_id uuid references public.reports(id) on delete set null,
  success boolean not null default false,
  http_status integer,
  response_time_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists provider_call_logs_provider_created_idx
  on public.provider_call_logs (provider, created_at desc);
create index if not exists provider_call_logs_report_id_idx
  on public.provider_call_logs (report_id);

alter table public.provider_call_logs enable row level security;

drop policy if exists "Admins can read provider logs" on public.provider_call_logs;
create policy "Admins can read provider logs"
  on public.provider_call_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
