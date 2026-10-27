-- Cost items as a reporting source: cost-group hierarchy, extra verified cost-item fields,
-- and admin rules for which catalog groups are Product Library models and which groups are
-- option groups (e.g. "Exterior Package Options").
--
-- Additive only. JobTread stays read-only; these are Baxter cache/config tables.
--   * jt_cost_groups is new (synced by the Sync Manager's "cost_groups" dataset)
--   * jt_cost_items gains unit_name, source_cost_item_id, is_taxable (verified Pave fields:
--     costItem.unit.name, costItem.organizationCostItem.id, costItem.isTaxable)
--   * bi_value_mappings.kind gains 'model_scope' and 'option_group'

create table if not exists public.jt_cost_groups (
  id text primary key,
  name text,
  description text,
  parent_id text,
  job_id text,
  quantity numeric,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_cost_groups_parent_idx on public.jt_cost_groups (parent_id) where removed_at is null;
create index if not exists jt_cost_groups_synced_idx on public.jt_cost_groups (synced_at);
alter table public.jt_cost_groups enable row level security;

alter table public.jt_cost_items add column if not exists unit_name text;
alter table public.jt_cost_items add column if not exists source_cost_item_id text;
alter table public.jt_cost_items add column if not exists is_taxable boolean;

insert into public.jt_sync_entities (entity, enabled) values ('cost_groups', true)
on conflict (entity) do nothing;

alter table public.bi_value_mappings drop constraint if exists bi_value_mappings_kind_check;
alter table public.bi_value_mappings
  add constraint bi_value_mappings_kind_check check (kind in ('region', 'model_scope', 'option_group'));

-- Model scope: top-level catalog groups are Product Library models unless excluded here.
-- Without any model_scope rule Baxter keeps the old rule (description mentions
-- "Product Library"), which missed 24 real models whose descriptions were replaced with
-- "Cost: $… Price 40%: …" text. These two groups are a project template and the shared
-- selections library, verified on 2026-10-27. Admins can edit or remove the rules.
insert into public.bi_value_mappings (kind, source_field, match_type, pattern, value, priority)
values
  ('model_scope', 'model.name', 'exact', 'Master Project Template - Budget', 'exclude', 10),
  ('model_scope', 'model.name', 'exact', 'Build Ready Selections', 'exclude', 10)
on conflict (kind, source_field, match_type, pattern) do nothing;
