-- Inventory management: line items, order groupings, and admin vocabularies.
-- Amounts are integer cents. Total cost is generated from quantity × unit cost.
-- PDF import (next) writes inventory_orders and attaches items; this migration only models it.

-- App-access roles (user, admin, super_admin) may read and write inventory.
-- new_user stays out. Vocabulary mutations stay admin-only.

create or replace function public.is_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('user', 'admin', 'super_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Vocabularies
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_statuses (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_statuses_label_required check (length(trim(label)) > 0)
);

create unique index if not exists inventory_statuses_label_uidx
  on public.inventory_statuses (lower(label));

create unique index if not exists inventory_statuses_one_default_uidx
  on public.inventory_statuses (is_default)
  where is_default;

create table if not exists public.inventory_storage_states (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_storage_states_label_required check (length(trim(label)) > 0)
);

create unique index if not exists inventory_storage_states_label_uidx
  on public.inventory_storage_states (lower(label));

create unique index if not exists inventory_storage_states_one_default_uidx
  on public.inventory_storage_states (is_default)
  where is_default;

create trigger inventory_statuses_set_updated_at
  before update on public.inventory_statuses
  for each row execute function public.set_updated_at();

create trigger inventory_storage_states_set_updated_at
  before update on public.inventory_storage_states
  for each row execute function public.set_updated_at();

insert into public.inventory_statuses (label, sort_order, is_active, is_default)
values
  ('Ordered – not in', 0, true, true),
  ('In office', 1, true, false),
  ('Returned', 2, true, false),
  ('Set aside', 3, true, false),
  ('Out of office', 4, true, false)
on conflict do nothing;

insert into public.inventory_storage_states (label, sort_order, is_active, is_default)
values
  ('Yes – in storage', 0, true, true),
  ('No – not in storage', 1, true, false),
  ('Set aside', 2, true, false),
  ('Returned', 3, true, false)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Orders — grouping for a future PDF import. Unused by manual entry.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_orders (
  id uuid primary key default gen_random_uuid(),
  vendor text,
  order_number text,
  job_id uuid references public.expense_jobs (id) on delete restrict,
  custom_project_label text,
  source_pdf_path text,
  imported_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint inventory_orders_project_xor check (
    (job_id is not null and custom_project_label is null)
    or (job_id is null and custom_project_label is not null)
    or (job_id is null and custom_project_label is null)
  )
);

create index if not exists inventory_orders_lookup_idx
  on public.inventory_orders (vendor, order_number)
  where deleted_at is null;

create trigger inventory_orders_set_updated_at
  before update on public.inventory_orders
  for each row execute function public.set_updated_at();

comment on table public.inventory_orders is
  'One build.com (or other) order. PDF import attaches line items here. Manual entry may leave order_id null.';

-- ---------------------------------------------------------------------------
-- Line items
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.inventory_orders (id) on delete set null,
  job_id uuid references public.expense_jobs (id) on delete restrict,
  custom_project_label text,
  vendor text,
  order_number text,
  category text,
  item_name text not null,
  description text,
  sku text not null,
  quantity integer not null,
  unit_cost_cents integer not null,
  total_cost_cents integer generated always as (quantity * unit_cost_cents) stored,
  product_url text,
  photo_url text,
  status_id uuid not null references public.inventory_statuses (id) on delete restrict,
  storage_state_id uuid references public.inventory_storage_states (id) on delete restrict,
  delivery_date date,
  out_date date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint inventory_items_name_required check (length(trim(item_name)) > 0),
  constraint inventory_items_sku_required check (length(trim(sku)) > 0),
  constraint inventory_items_quantity_positive check (quantity >= 1),
  constraint inventory_items_unit_cost_nonnegative check (unit_cost_cents >= 0),
  constraint inventory_items_project_xor check (
    (job_id is not null and custom_project_label is null)
    or (job_id is null and custom_project_label is not null)
  )
);

create index if not exists inventory_items_active_idx
  on public.inventory_items (created_at desc)
  where deleted_at is null;

create index if not exists inventory_items_job_idx
  on public.inventory_items (job_id)
  where deleted_at is null;

create index if not exists inventory_items_status_idx
  on public.inventory_items (status_id)
  where deleted_at is null;

create index if not exists inventory_items_order_number_idx
  on public.inventory_items (order_number)
  where deleted_at is null;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

comment on column public.inventory_items.unit_cost_cents is
  'Integer cents. Never a float.';
comment on column public.inventory_items.total_cost_cents is
  'Generated as quantity * unit_cost_cents. Not hand-entered.';
comment on column public.inventory_items.job_id is
  'Shared expense_jobs row (Master Project Log or admin custom job). Mutually exclusive with custom_project_label.';
comment on column public.inventory_items.custom_project_label is
  'Free-text project from the shared picker "+ Create" option. Not a second project list.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.inventory_statuses enable row level security;
alter table public.inventory_storage_states enable row level security;
alter table public.inventory_orders enable row level security;
alter table public.inventory_items enable row level security;

create policy "App access can read inventory statuses"
  on public.inventory_statuses for select
  to authenticated
  using (public.is_app_access());

create policy "Admins insert inventory statuses"
  on public.inventory_statuses for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins update inventory statuses"
  on public.inventory_statuses for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete inventory statuses"
  on public.inventory_statuses for delete
  to authenticated
  using (public.is_admin());

create policy "App access can read inventory storage states"
  on public.inventory_storage_states for select
  to authenticated
  using (public.is_app_access());

create policy "Admins insert inventory storage states"
  on public.inventory_storage_states for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins update inventory storage states"
  on public.inventory_storage_states for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete inventory storage states"
  on public.inventory_storage_states for delete
  to authenticated
  using (public.is_admin());

create policy "App access can read inventory orders"
  on public.inventory_orders for select
  to authenticated
  using (public.is_app_access() and deleted_at is null);

create policy "App access can insert inventory orders"
  on public.inventory_orders for insert
  to authenticated
  with check (public.is_app_access());

create policy "App access can update inventory orders"
  on public.inventory_orders for update
  to authenticated
  using (public.is_app_access())
  with check (public.is_app_access());

create policy "App access can read inventory items"
  on public.inventory_items for select
  to authenticated
  using (public.is_app_access() and deleted_at is null);

create policy "App access can insert inventory items"
  on public.inventory_items for insert
  to authenticated
  with check (public.is_app_access());

create policy "App access can update inventory items"
  on public.inventory_items for update
  to authenticated
  using (public.is_app_access())
  with check (public.is_app_access());
