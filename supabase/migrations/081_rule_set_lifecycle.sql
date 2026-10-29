-- Business-rule lifecycle: rule-set scope and ownership, explicit report bindings, rate
-- lifecycle states, idempotent operations, and a read-only audit view.
--
-- Why: every dashboard made from the Sales Commissions template pointed at one shared rule
-- set by its fixed key ("sales_commissions"), so deleting a dashboard and creating a new one
-- showed the old dashboard's rates. Rule sets were identified by a name-derived key, nothing
-- recorded which reports used them, and rates could only be added or changed.
--
-- Additive only. Nothing is deleted, voided, re-owned, or re-pointed here:
--   * Existing rule sets become scope 'company' with needs_review = true (ownership is never
--     guessed). An administrator decides per set: keep shared, convert to one dashboard, or
--     archive.
--   * Every saved report whose spec references a rule set gets a binding with mode
--     'migrated_legacy' and needs_review = true. Templates get no binding: templates never
--     bind to a live rule set (the app rewrites their references when a dashboard is made).
--   * Existing rates stay 'active' with their dates unchanged.
-- Safe whether or not 078–080 have been applied (it touches none of their objects).
-- Service-role access only (RLS on, no policies), like the other bi_* tables.

-- ---------------------------------------------------------------------------
-- Rule sets: scope, ownership, status, optimistic version
-- ---------------------------------------------------------------------------
alter table public.bi_rule_sets add column if not exists scope text;
alter table public.bi_rule_sets add column if not exists status text not null default 'active';
alter table public.bi_rule_sets add column if not exists owner_report_id uuid
  references public.bi_reports (id) on delete set null;
alter table public.bi_rule_sets add column if not exists owner_user_id uuid
  references public.profiles (id) on delete set null;
alter table public.bi_rule_sets add column if not exists copied_from_rule_set_id uuid
  references public.bi_rule_sets (id) on delete set null;
alter table public.bi_rule_sets add column if not exists needs_review boolean not null default false;
alter table public.bi_rule_sets add column if not exists review_note text;
alter table public.bi_rule_sets add column if not exists version integer not null default 1;
alter table public.bi_rule_sets add column if not exists archived_at timestamptz;
alter table public.bi_rule_sets add column if not exists archived_by_label text;
alter table public.bi_rule_sets add column if not exists archive_reason text;

update public.bi_rule_sets
set scope = 'company',
    needs_review = true,
    review_note = coalesce(
      review_note,
      'Created before rule-set ownership existed (migration 081). Ownership was not inferred; review its consumers and decide whether it stays shared.'
    )
where scope is null;

alter table public.bi_rule_sets alter column scope set default 'dashboard';
alter table public.bi_rule_sets alter column scope set not null;

alter table public.bi_rule_sets drop constraint if exists bi_rule_sets_scope_check;
alter table public.bi_rule_sets add constraint bi_rule_sets_scope_check
  check (scope in ('dashboard', 'company', 'template'));
alter table public.bi_rule_sets drop constraint if exists bi_rule_sets_status_check;
alter table public.bi_rule_sets add constraint bi_rule_sets_status_check
  check (status in ('active', 'archived', 'copying'));

create index if not exists bi_rule_sets_owner_report_idx
  on public.bi_rule_sets (owner_report_id) where owner_report_id is not null;
create index if not exists bi_rule_sets_review_idx
  on public.bi_rule_sets (needs_review, status);

-- ---------------------------------------------------------------------------
-- Rates: lifecycle state, corrections, optimistic version
-- ---------------------------------------------------------------------------
alter table public.bi_commission_rates add column if not exists status text not null default 'active';
alter table public.bi_commission_rates add column if not exists version integer not null default 1;
alter table public.bi_commission_rates add column if not exists updated_at timestamptz
  not null default timezone('utc', now());
alter table public.bi_commission_rates add column if not exists end_reason text;
alter table public.bi_commission_rates add column if not exists voided_at timestamptz;
alter table public.bi_commission_rates add column if not exists voided_by_label text;
alter table public.bi_commission_rates add column if not exists void_reason text;
alter table public.bi_commission_rates add column if not exists superseded_by uuid
  references public.bi_commission_rates (id) on delete set null;
alter table public.bi_commission_rates add column if not exists corrects_rate_id uuid
  references public.bi_commission_rates (id) on delete set null;
alter table public.bi_commission_rates add column if not exists copied_from_rate_id uuid
  references public.bi_commission_rates (id) on delete set null;

alter table public.bi_commission_rates drop constraint if exists bi_commission_rates_status_check;
alter table public.bi_commission_rates add constraint bi_commission_rates_status_check
  check (status in ('active', 'voided', 'superseded'));
alter table public.bi_commission_rates drop constraint if exists bi_commission_rates_dates_check;
alter table public.bi_commission_rates add constraint bi_commission_rates_dates_check
  check (effective_to is null or effective_to >= effective_from) not valid;

drop trigger if exists bi_commission_rates_set_updated_at on public.bi_commission_rates;
create trigger bi_commission_rates_set_updated_at
  before update on public.bi_commission_rates
  for each row execute function public.set_updated_at();

-- Active rates for one salesperson × scope (all projects, or one project) may not overlap.
-- A trigger (not an exclusion constraint) so rows written before this migration are never
-- rejected retroactively; new writes are serialized per key with an advisory lock.
create or replace function public.bi_commission_rates_reject_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(
      new.rule_set_id::text || '|' || lower(btrim(new.salesperson)) || '|' || coalesce(new.job_id, ''),
      0
    )
  );
  if exists (
    select 1
    from public.bi_commission_rates r
    where r.rule_set_id = new.rule_set_id
      and r.id <> new.id
      and r.status = 'active'
      and lower(btrim(r.salesperson)) = lower(btrim(new.salesperson))
      and coalesce(r.job_id, '') = coalesce(new.job_id, '')
      and daterange(r.effective_from, r.effective_to, '[]')
        && daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception 'Commission rate dates overlap an active rate for % (%).',
      new.salesperson, coalesce(new.job_id, 'all projects')
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists bi_commission_rates_reject_overlap on public.bi_commission_rates;
create trigger bi_commission_rates_reject_overlap
  before insert or update of status, salesperson, job_id, effective_from, effective_to
  on public.bi_commission_rates
  for each row execute function public.bi_commission_rates_reject_overlap();

-- ---------------------------------------------------------------------------
-- Report ↔ rule-set bindings (the explicit record of who uses which rule set)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_report_rule_bindings (
  id uuid primary key default gen_random_uuid(),
  -- Set null when the report is deleted; report_ref and report_title keep the history.
  report_id uuid references public.bi_reports (id) on delete set null,
  report_ref uuid not null,
  report_title text not null default '',
  rule_set_id uuid not null references public.bi_rule_sets (id) on delete restrict,
  mode text not null check (mode in ('created_empty', 'copied', 'attached_shared', 'migrated_legacy')),
  copied_from_rule_set_id uuid references public.bi_rule_sets (id) on delete set null,
  needs_review boolean not null default false,
  attached_by uuid references public.profiles (id) on delete set null,
  attached_by_label text,
  attached_via text not null default 'system' check (attached_via in ('ui', 'dexter', 'system')),
  attached_at timestamptz not null default timezone('utc', now()),
  detached_at timestamptz,
  detached_by_label text,
  detach_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists bi_report_rule_bindings_active_uidx
  on public.bi_report_rule_bindings (report_id, rule_set_id)
  where detached_at is null and report_id is not null;
create index if not exists bi_report_rule_bindings_rule_set_idx
  on public.bi_report_rule_bindings (rule_set_id) where detached_at is null;
create index if not exists bi_report_rule_bindings_report_ref_idx
  on public.bi_report_rule_bindings (report_ref, attached_at desc);

drop trigger if exists bi_report_rule_bindings_set_updated_at on public.bi_report_rule_bindings;
create trigger bi_report_rule_bindings_set_updated_at
  before update on public.bi_report_rule_bindings
  for each row execute function public.set_updated_at();

-- Attaching needs an active rule set, and a dashboard-scoped set belongs to one report.
-- The rule-set row is locked so an attach and an archive can't both succeed.
create or replace function public.bi_report_rule_bindings_guard()
returns trigger
language plpgsql
as $$
declare
  rs record;
begin
  if new.detached_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.report_id is null and old.report_id is not null then
    -- The report was deleted (FK set null): close the binding, keep the history.
    new.detached_at := timezone('utc', now());
    new.detach_reason := coalesce(new.detach_reason, 'Report deleted');
    return new;
  end if;
  select id, scope, status, owner_report_id into rs
  from public.bi_rule_sets where id = new.rule_set_id for share;
  if rs.status <> 'active' then
    raise exception 'Rule set % is %, so it cannot be attached.', new.rule_set_id, rs.status
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and rs.scope = 'dashboard' and exists (
    select 1 from public.bi_report_rule_bindings b
    where b.rule_set_id = new.rule_set_id
      and b.detached_at is null
      and b.report_id is distinct from new.report_id
  ) then
    raise exception 'Rule set % belongs to another dashboard. Copy it instead.', new.rule_set_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists bi_report_rule_bindings_guard on public.bi_report_rule_bindings;
create trigger bi_report_rule_bindings_guard
  before insert or update on public.bi_report_rule_bindings
  for each row execute function public.bi_report_rule_bindings_guard();

-- Archiving a rule set that a report still uses is rejected (detach first).
create or replace function public.bi_rule_sets_guard_archive()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'archived' and old.status <> 'archived' and exists (
    select 1 from public.bi_report_rule_bindings b
    where b.rule_set_id = new.id and b.detached_at is null and b.report_id is not null
  ) then
    raise exception 'Rule set % is still used by a report. Detach it first.', new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists bi_rule_sets_guard_archive on public.bi_rule_sets;
create trigger bi_rule_sets_guard_archive
  before update of status on public.bi_rule_sets
  for each row execute function public.bi_rule_sets_guard_archive();

-- ---------------------------------------------------------------------------
-- Change log: who/how, reasons, and whether commissions were affected
-- ---------------------------------------------------------------------------
alter table public.bi_rule_changes add column if not exists via text;
alter table public.bi_rule_changes add column if not exists reason text;
alter table public.bi_rule_changes add column if not exists commissions_affected boolean;
alter table public.bi_rule_changes add column if not exists impact jsonb;
alter table public.bi_rule_changes add column if not exists operation_id uuid;
alter table public.bi_rule_changes add column if not exists report_id uuid;

alter table public.bi_rule_changes drop constraint if exists bi_rule_changes_entity_check;
alter table public.bi_rule_changes add constraint bi_rule_changes_entity_check
  check (entity in ('rule_set', 'rate', 'assignment', 'binding'));
alter table public.bi_rule_changes drop constraint if exists bi_rule_changes_via_check;
alter table public.bi_rule_changes add constraint bi_rule_changes_via_check
  check (via is null or via in ('ui', 'dexter', 'system'));

-- ---------------------------------------------------------------------------
-- Idempotent operations (duplicate saves / retried Dexter calls run once)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_rule_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  operation text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  via text not null check (via in ('ui', 'dexter', 'system')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

drop trigger if exists bi_rule_operations_set_updated_at on public.bi_rule_operations;
create trigger bi_rule_operations_set_updated_at
  before update on public.bi_rule_operations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Conservative backfill: legacy bindings for saved (non-template) reports
-- ---------------------------------------------------------------------------
insert into public.bi_report_rule_bindings (
  report_id, report_ref, report_title, rule_set_id, mode, needs_review,
  attached_by_label, attached_via
)
select distinct on (r.id, rs.id)
  r.id, r.id, r.title, rs.id, 'migrated_legacy', true,
  'Baxter system (migration 081)', 'system'
from public.bi_reports r
cross join lateral (
  select d ->> 'ruleSet' as key from jsonb_array_elements(coalesce(r.spec -> 'datasets', '[]'::jsonb)) d
  union
  select w ->> 'ruleSet' from jsonb_array_elements(coalesce(r.spec -> 'widgets', '[]'::jsonb)) w
) refs
join public.bi_rule_sets rs on rs.key = refs.key
where r.is_template = false
  and refs.key is not null
  and not exists (
    select 1 from public.bi_report_rule_bindings b
    where b.report_id = r.id and b.rule_set_id = rs.id and b.detached_at is null
  );

-- ---------------------------------------------------------------------------
-- Read-only audit view (server-side only; never exposed to API roles)
-- ---------------------------------------------------------------------------
create or replace view public.bi_rule_set_audit
with (security_invoker = true) as
select
  rs.id,
  rs.key,
  rs.name,
  rs.scope,
  rs.status,
  rs.needs_review,
  rs.owner_report_id,
  rs.created_at,
  rs.updated_at,
  (select count(*) from public.bi_report_rule_bindings b
    where b.rule_set_id = rs.id and b.detached_at is null and b.report_id is not null) as active_bindings,
  (select count(*) from public.bi_report_rule_bindings b
    where b.rule_set_id = rs.id and b.detached_at is null and b.mode = 'migrated_legacy') as legacy_bindings,
  (select count(*) from public.bi_reports r
    where r.is_template = true and r.spec::text like '%"ruleSet": "' || rs.key || '"%') as template_references,
  (select count(*) from public.bi_commission_rates c
    where c.rule_set_id = rs.id and c.status = 'active') as active_rates,
  (select count(*) from public.bi_commission_rates c
    where c.rule_set_id = rs.id and c.status <> 'active') as inactive_rates,
  (select count(*) from public.bi_project_assignments a
    where a.rule_set_id = rs.id and a.removed_at is null) as active_assignments,
  (select max(c.created_at) from public.bi_rule_changes c where c.rule_set_id = rs.id) as last_change_at
from public.bi_rule_sets rs;

revoke all on public.bi_rule_set_audit from anon, authenticated;

alter table public.bi_report_rule_bindings enable row level security;
alter table public.bi_rule_operations enable row level security;
