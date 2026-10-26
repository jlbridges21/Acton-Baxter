-- Business fields managed in the web app (Reports → Data settings → Business fields).
--
-- Additive only: jt_semantic_fields gains bookkeeping columns. Existing keys, labels, and
-- mappings are untouched, so every report that references sem:<key> keeps working.
--
--   source            where the row came from: shipped default, the JobTread_Custom_Fields.xlsx
--                     import, or an administrator
--   source_category / source_name / requested_*
--                     what was requested (category → JobTread target, field type, options),
--                     used to verify a mapping and flag mismatches
--   mapped_by         'auto' = verified exact match (name + target + type, unique);
--                     'admin' = chosen by an administrator (never overwritten by automation)
--   archived_at       "removed" rows are archived, not deleted, so reports that still
--                     reference them get a clear message instead of a dangling key
--
-- Rows from the spreadsheet are inserted by the app after JobTread field metadata has synced
-- (so matches use real JobTread field ids), not by this migration.

alter table public.jt_semantic_fields
  add column if not exists source text not null default 'system';
alter table public.jt_semantic_fields
  drop constraint if exists jt_semantic_fields_source_check;
alter table public.jt_semantic_fields
  add constraint jt_semantic_fields_source_check check (source in ('system', 'spreadsheet', 'admin'));

alter table public.jt_semantic_fields add column if not exists source_category text;
alter table public.jt_semantic_fields add column if not exists source_name text;
alter table public.jt_semantic_fields add column if not exists requested_target text;
alter table public.jt_semantic_fields add column if not exists requested_type text;
alter table public.jt_semantic_fields
  add column if not exists requested_options jsonb not null default '[]'::jsonb;
alter table public.jt_semantic_fields add column if not exists mapped_by text;
alter table public.jt_semantic_fields
  drop constraint if exists jt_semantic_fields_mapped_by_check;
alter table public.jt_semantic_fields
  add constraint jt_semantic_fields_mapped_by_check check (mapped_by is null or mapped_by in ('auto', 'admin'));
alter table public.jt_semantic_fields add column if not exists sort_order integer;
alter table public.jt_semantic_fields add column if not exists archived_at timestamptz;
alter table public.jt_semantic_fields
  add column if not exists created_at timestamptz not null default timezone('utc', now());

-- Existing mappings: untouched by a person → automatic exact match; otherwise an admin choice.
update public.jt_semantic_fields
set mapped_by = case when updated_by is null then 'auto' else 'admin' end
where custom_field_id is not null and mapped_by is null;

create index if not exists jt_semantic_fields_active_idx
  on public.jt_semantic_fields (archived_at) where archived_at is null;
