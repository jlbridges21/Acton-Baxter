-- JobTread-native field catalog: tenant-scoped field identity, change history, refresh state,
-- and review state for business-name aliases.
--
-- Additive only; safe whether or not 078/079 have been applied (it touches none of their
-- objects). Nothing is deleted: removed JobTread fields stay as stale rows (removed_at), and
-- alias mappings are never changed here — repairs happen through the audited admin/Dexter
-- repair flow after a dry-run.
--
--   * jt_custom_fields gains organization_id (the JobTread organization the field belongs
--     to; backfilled from jt_connection) and type-change tracking. The JobTread field id stays
--     the primary key: it is immutable and globally unique; (organization_id, id) is unique.
--   * jt_custom_field_history records added / renamed / type_changed / options_changed /
--     removed / restored events, so renamed and removed fields can be explained.
--   * jt_field_catalog_refreshes records each metadata refresh (status, counts, held removals).
--   * jt_semantic_fields gains an administrator review state (status override, reason,
--     verification) used by the alias audit. Effective alias status (ok / conflict / ambiguous /
--     shared text / stale) is computed from live metadata, not stored.
-- Service-role access only (RLS on, no policies), like the other jt_* tables.

alter table public.jt_custom_fields add column if not exists organization_id text;
alter table public.jt_custom_fields add column if not exists previous_type text;
alter table public.jt_custom_fields add column if not exists type_changed_at timestamptz;

update public.jt_custom_fields f
set organization_id = c.organization_id
from (select organization_id from public.jt_connection where organization_id is not null limit 1) c
where f.organization_id is null;

create unique index if not exists jt_custom_fields_org_id_uidx
  on public.jt_custom_fields (organization_id, id);
create index if not exists jt_custom_fields_org_target_idx
  on public.jt_custom_fields (organization_id, target_type) where removed_at is null;

create table if not exists public.jt_custom_field_history (
  id uuid primary key default gen_random_uuid(),
  organization_id text,
  field_id text not null,
  change text not null check (
    change in ('added', 'renamed', 'type_changed', 'options_changed', 'removed', 'restored')
  ),
  old_value jsonb,
  new_value jsonb,
  observed_at timestamptz not null default timezone('utc', now())
);
create index if not exists jt_custom_field_history_field_idx
  on public.jt_custom_field_history (organization_id, field_id, observed_at desc);
alter table public.jt_custom_field_history enable row level security;

create table if not exists public.jt_field_catalog_refreshes (
  id uuid primary key default gen_random_uuid(),
  organization_id text,
  status text not null check (status in ('running', 'succeeded', 'held', 'failed')),
  triggered_by text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  seen integer not null default 0,
  added integer not null default 0,
  renamed integer not null default 0,
  type_changed integer not null default 0,
  removed integer not null default 0,
  restored integer not null default 0,
  -- Removals not applied because the response looked incomplete (needs admin confirmation).
  held_removals integer not null default 0,
  error text
);
create index if not exists jt_field_catalog_refreshes_org_idx
  on public.jt_field_catalog_refreshes (organization_id, started_at desc);
alter table public.jt_field_catalog_refreshes enable row level security;

alter table public.jt_semantic_fields add column if not exists review_status text
  check (review_status in ('deprecated', 'verified'));
alter table public.jt_semantic_fields add column if not exists review_note text;
alter table public.jt_semantic_fields add column if not exists reviewed_by uuid
  references public.profiles (id) on delete set null;
alter table public.jt_semantic_fields add column if not exists reviewed_at timestamptz;
