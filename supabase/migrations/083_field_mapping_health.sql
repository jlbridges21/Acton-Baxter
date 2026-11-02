-- Field Mapping Health: a tenant-scoped, id-keyed registry of every JobTread custom field and
-- business-name alias, with its mapping status, sync status, exclusion reason, and the
-- administrator's reporting switch.
--
-- Additive and backward compatible: one new table, no changes to existing objects, nothing
-- deleted. Code works without it (the validator runs live; the reporting switch and review
-- resolution need it and say so).
--
--   * internal_ref is Baxter's reference: cf:<JobTread field id> for fields, sem:<key> for
--     business-name aliases. Field rows are keyed by JobTread's immutable field id; names are
--     stored only as display data (current_name, previous_names) so renames never break a
--     mapping. Standard attributes (job.name, …) have no JobTread id and are not stored here;
--     their documented fallback identity is jobtread:<org>:<entity>:attr:<key>.
--   * reporting_enabled lets an administrator exclude an eligible field from reports while
--     its values keep syncing (a Field access exclusion, by contrast, stops caching for
--     privacy). It never widens access: field access categories still apply.
--   * review_status = 'needs_review' marks aliases that were mapped by name and whose name is
--     now ambiguous. They are never re-pointed automatically.
--   * Snapshot columns (mapping_status, sync_status, exclusion_reason, errors,
--     last_verified_at) are rewritten by each validation; history stays in
--     jt_custom_field_history (080) and ai_audit_log.
-- Service-role access only (RLS on, no policies), like the other jt_* tables.

create table if not exists public.jt_field_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  internal_ref text not null check (internal_ref ~ '^(cf|sem):[A-Za-z0-9_-]{1,80}$'),
  mapping_kind text not null check (mapping_kind in ('field', 'alias')),
  source_entity text not null,
  field_id text,
  current_name text,
  previous_names jsonb not null default '[]'::jsonb,
  field_type text,
  mapping_status text not null default 'ok'
    check (mapping_status in ('ok', 'warning', 'needs_review', 'broken', 'unmapped', 'stale')),
  sync_status text not null default 'synced'
    check (sync_status in ('synced', 'not_synced', 'unsupported', 'stale')),
  exclusion_reason text check (
    exclusion_reason is null or exclusion_reason in (
      'intentional', 'unsupported_api', 'not_synced', 'synced_not_exposed', 'permission',
      'broken_mapping'
    )
  ),
  errors jsonb not null default '[]'::jsonb,
  reporting_enabled boolean not null default true,
  review_status text check (review_status is null or review_status in ('needs_review', 'resolved')),
  review_note text,
  last_verified_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, internal_ref)
);

create index if not exists jt_field_mappings_field_idx
  on public.jt_field_mappings (organization_id, field_id);
create index if not exists jt_field_mappings_status_idx
  on public.jt_field_mappings (organization_id, mapping_status);

alter table public.jt_field_mappings enable row level security;

-- Backfill from the id-keyed catalog. Field rows copy the JobTread id; nothing is matched by
-- name here. The first validation run (next metadata refresh, or "Revalidate") fills in the
-- computed statuses.
insert into public.jt_field_mappings (
  organization_id, internal_ref, mapping_kind, source_entity, field_id, current_name,
  field_type, mapping_status, sync_status
)
select
  coalesce(f.organization_id, c.organization_id, 'unknown'),
  'cf:' || f.id,
  'field',
  f.target_type,
  f.id,
  f.name,
  f.type,
  case when f.removed_at is null then 'ok' else 'stale' end,
  case when f.removed_at is null then 'synced' else 'stale' end
from public.jt_custom_fields f
left join (
  select organization_id from public.jt_connection where organization_id is not null limit 1
) c on true
where f.id ~ '^[A-Za-z0-9_-]{1,80}$'
on conflict (organization_id, internal_ref) do nothing;

-- Aliases that were mapped automatically by name (never confirmed by an administrator) and
-- whose mapped field's name is now shared by another live field of the same entity: flag for
-- review. The mapping itself is left exactly as it is.
insert into public.jt_field_mappings (
  organization_id, internal_ref, mapping_kind, source_entity, field_id, current_name,
  mapping_status, review_status, review_note
)
select
  coalesce(f.organization_id, c.organization_id, 'unknown'),
  'sem:' || s.key,
  'alias',
  f.target_type,
  f.id,
  f.name,
  'needs_review',
  'needs_review',
  'Mapped by name; another live field now has the same name. Confirm or choose the field.'
from public.jt_semantic_fields s
join public.jt_custom_fields f on f.id = s.custom_field_id
left join (
  select organization_id from public.jt_connection where organization_id is not null limit 1
) c on true
where s.archived_at is null
  and coalesce(s.mapped_by, 'auto') <> 'admin'
  and s.updated_by is null
  and s.key ~ '^[A-Za-z0-9_-]{1,80}$'
  and exists (
    select 1 from public.jt_custom_fields d
    where d.id <> f.id
      and d.removed_at is null
      and d.target_type = f.target_type
      and lower(btrim(d.name)) = lower(btrim(f.name))
  )
on conflict (organization_id, internal_ref) do nothing;
