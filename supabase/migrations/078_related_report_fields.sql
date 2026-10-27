-- Related report fields: administrator approvals for reading a related record's fields from
-- another report source (e.g. job fields on cost-item rows, matched by JobTread job id).
--
-- Additive only. The relationships themselves are declared in code
-- (src/lib/reports/relationships.ts, validated there); this table only approves (enabled = true) or removes
-- (enabled = false) fields that already exist on the related source. Without this table the
-- code defaults apply (Phase, Status, Project Manager, Customer, Job Number, …).
-- Service-role access only (RLS on, no policies), like the other bi_* config tables.

create table if not exists public.bi_related_fields (
  id uuid primary key default gen_random_uuid(),
  relationship text not null check (length(relationship) between 1 and 60),
  field_ref text not null check (length(field_ref) between 1 and 120),
  enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bi_related_fields_unique unique (relationship, field_ref)
);
alter table public.bi_related_fields enable row level security;
