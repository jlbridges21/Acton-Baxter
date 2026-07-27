-- Process Rulebook: versioned machine-readable Acton process (RACI + required data).
-- Operational data (like GHL) — NOT knowledge_entries / embeddings.
-- Monitoring consumes this in a later prompt; this migration only defines the rulebook.

-- ---------------------------------------------------------------------------
-- Roles (process roles, not people)
-- ---------------------------------------------------------------------------
create table if not exists public.process_roles (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  display_name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint process_roles_role_key_format check (role_key ~ '^[a-z][a-z0-9_]*$')
);

create trigger process_roles_set_updated_at
  before update on public.process_roles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role assignments (people ↔ roles) — evolve independently of rulebook versions
-- ---------------------------------------------------------------------------
create table if not exists public.process_role_assignments (
  id uuid primary key default gen_random_uuid(),
  role_key text not null references public.process_roles (role_key) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  slack_user_id text,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint process_role_assignments_dates check (
    effective_to is null or effective_to > effective_from
  )
);

create index if not exists process_role_assignments_role_idx
  on public.process_role_assignments (role_key, effective_from desc);

create index if not exists process_role_assignments_profile_idx
  on public.process_role_assignments (profile_id)
  where profile_id is not null;

create trigger process_role_assignments_set_updated_at
  before update on public.process_role_assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------
create table if not exists public.rulebook_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique,
  status text not null check (status in ('draft', 'active', 'superseded')),
  source_description text,
  source_reference text,
  imported_by uuid references public.profiles (id) on delete set null,
  activated_by uuid references public.profiles (id) on delete set null,
  superseded_version_id uuid references public.rulebook_versions (id) on delete set null,
  validation_report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists rulebook_versions_status_idx
  on public.rulebook_versions (status, version_number desc);

-- Exactly one active version (partial unique index)
create unique index if not exists rulebook_versions_one_active_idx
  on public.rulebook_versions (status)
  where status = 'active';

create trigger rulebook_versions_set_updated_at
  before update on public.rulebook_versions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
create table if not exists public.process_stages (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.rulebook_versions (id) on delete cascade,
  stage_key text not null,
  display_name text not null,
  external_stage_name text,
  order_index integer not null,
  duration_days_budget numeric,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (version_id, stage_key),
  unique (version_id, order_index),
  constraint process_stages_order_positive check (order_index >= 0),
  constraint process_stages_duration_positive check (
    duration_days_budget is null or duration_days_budget > 0
  )
);

create index if not exists process_stages_version_order_idx
  on public.process_stages (version_id, order_index);

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------
create table if not exists public.process_steps (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.rulebook_versions (id) on delete cascade,
  stage_id uuid not null references public.process_stages (id) on delete cascade,
  step_key text not null,
  display_name text not null,
  order_index integer not null,
  duration_days_budget numeric,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (version_id, step_key),
  unique (stage_id, order_index),
  constraint process_steps_order_positive check (order_index >= 0),
  constraint process_steps_duration_positive check (
    duration_days_budget is null or duration_days_budget > 0
  )
);

create index if not exists process_steps_stage_order_idx
  on public.process_steps (stage_id, order_index);

-- ---------------------------------------------------------------------------
-- RACI
-- ---------------------------------------------------------------------------
create table if not exists public.process_step_raci (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.process_steps (id) on delete cascade,
  role_key text not null,
  raci text not null check (raci in ('R', 'A', 'C', 'I')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (step_id, role_key, raci)
);

create index if not exists process_step_raci_step_idx
  on public.process_step_raci (step_id);

-- ---------------------------------------------------------------------------
-- Required data
-- ---------------------------------------------------------------------------
create table if not exists public.process_step_data_requirements (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.process_steps (id) on delete cascade,
  field_key text not null,
  display_name text not null,
  source_system text not null check (
    source_system in ('ghl', 'buildertrend', 'knowledge', 'manual')
  ),
  source_field_path text,
  required boolean not null default true,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (step_id, field_key)
);

create index if not exists process_step_data_req_step_idx
  on public.process_step_data_requirements (step_id);

-- ---------------------------------------------------------------------------
-- RLS — admin read; writes via service role only
-- ---------------------------------------------------------------------------
alter table public.process_roles enable row level security;
alter table public.process_role_assignments enable row level security;
alter table public.rulebook_versions enable row level security;
alter table public.process_stages enable row level security;
alter table public.process_steps enable row level security;
alter table public.process_step_raci enable row level security;
alter table public.process_step_data_requirements enable row level security;

create policy "Admins can read process roles"
  on public.process_roles for select to authenticated
  using (public.is_admin());

create policy "Admins can read process role assignments"
  on public.process_role_assignments for select to authenticated
  using (public.is_admin());

create policy "Admins can read rulebook versions"
  on public.rulebook_versions for select to authenticated
  using (public.is_admin());

create policy "Admins can read process stages"
  on public.process_stages for select to authenticated
  using (public.is_admin());

create policy "Admins can read process steps"
  on public.process_steps for select to authenticated
  using (public.is_admin());

create policy "Admins can read process step raci"
  on public.process_step_raci for select to authenticated
  using (public.is_admin());

create policy "Admins can read process step data requirements"
  on public.process_step_data_requirements for select to authenticated
  using (public.is_admin());

-- Authenticated employees may read the active rulebook definition for Q&A honesty
-- (service role still used for writes; client mutations blocked).
create policy "Authenticated can read active rulebook versions"
  on public.rulebook_versions for select to authenticated
  using (status = 'active');

create policy "Authenticated can read stages of active rulebook"
  on public.process_stages for select to authenticated
  using (
    exists (
      select 1 from public.rulebook_versions v
      where v.id = version_id and v.status = 'active'
    )
  );

create policy "Authenticated can read steps of active rulebook"
  on public.process_steps for select to authenticated
  using (
    exists (
      select 1 from public.rulebook_versions v
      where v.id = version_id and v.status = 'active'
    )
  );

create policy "Authenticated can read raci of active rulebook"
  on public.process_step_raci for select to authenticated
  using (
    exists (
      select 1
      from public.process_steps s
      join public.rulebook_versions v on v.id = s.version_id
      where s.id = step_id and v.status = 'active'
    )
  );

create policy "Authenticated can read data requirements of active rulebook"
  on public.process_step_data_requirements for select to authenticated
  using (
    exists (
      select 1
      from public.process_steps s
      join public.rulebook_versions v on v.id = s.version_id
      where s.id = step_id and v.status = 'active'
    )
  );

create policy "Authenticated can read process roles for active answers"
  on public.process_roles for select to authenticated
  using (true);

create policy "Authenticated can read current role assignments"
  on public.process_role_assignments for select to authenticated
  using (effective_to is null or effective_to > timezone('utc', now()));

-- Block client writes (service role bypasses RLS)
create policy "No client insert process roles"
  on public.process_roles for insert to authenticated with check (false);
create policy "No client update process roles"
  on public.process_roles for update to authenticated using (false);
create policy "No client delete process roles"
  on public.process_roles for delete to authenticated using (false);

create policy "No client insert process role assignments"
  on public.process_role_assignments for insert to authenticated with check (false);
create policy "No client update process role assignments"
  on public.process_role_assignments for update to authenticated using (false);
create policy "No client delete process role assignments"
  on public.process_role_assignments for delete to authenticated using (false);

create policy "No client insert rulebook versions"
  on public.rulebook_versions for insert to authenticated with check (false);
create policy "No client update rulebook versions"
  on public.rulebook_versions for update to authenticated using (false);
create policy "No client delete rulebook versions"
  on public.rulebook_versions for delete to authenticated using (false);

create policy "No client insert process stages"
  on public.process_stages for insert to authenticated with check (false);
create policy "No client update process stages"
  on public.process_stages for update to authenticated using (false);
create policy "No client delete process stages"
  on public.process_stages for delete to authenticated using (false);

create policy "No client insert process steps"
  on public.process_steps for insert to authenticated with check (false);
create policy "No client update process steps"
  on public.process_steps for update to authenticated using (false);
create policy "No client delete process steps"
  on public.process_steps for delete to authenticated using (false);

create policy "No client insert process step raci"
  on public.process_step_raci for insert to authenticated with check (false);
create policy "No client update process step raci"
  on public.process_step_raci for update to authenticated using (false);
create policy "No client delete process step raci"
  on public.process_step_raci for delete to authenticated using (false);

create policy "No client insert process step data requirements"
  on public.process_step_data_requirements for insert to authenticated with check (false);
create policy "No client update process step data requirements"
  on public.process_step_data_requirements for update to authenticated using (false);
create policy "No client delete process step data requirements"
  on public.process_step_data_requirements for delete to authenticated using (false);

comment on table public.rulebook_versions is
  'Versioned Process Rulebook (RACI). Exactly one active version. Imports create drafts only.';
comment on table public.process_stages is
  'Process stages for a rulebook version. external_stage_name reserved for Buildertrend mapping.';
comment on column public.process_step_data_requirements.source_system is
  'ghl | buildertrend | knowledge | manual — connectors for buildertrend/domo come later.';
