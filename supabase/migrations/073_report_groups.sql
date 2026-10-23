-- Reports organization: groups (folders), suggestion tracking, and per-user Reports preferences.
-- Additive only. RLS enabled with no policies: all access goes through server routes, which
-- apply the existing report permissions (group membership never grants report access).

-- Where a report came from (a suggestion or a template), so suggestions can be retired once a
-- matching report exists. Null for older reports (they are matched by content instead).
alter table public.bi_reports add column if not exists origin_suggestion_key text;
alter table public.bi_reports add column if not exists origin_template_key text;

create table if not exists public.bi_report_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  color text not null default 'slate' check (color in ('slate', 'navy', 'teal', 'green', 'amber', 'orange', 'red', 'violet', 'pink', 'sky')),
  icon text not null default 'folder' check (icon in ('folder', 'chart', 'dollar', 'package', 'pencil', 'hammer', 'clipboard', 'briefcase', 'building', 'star')),
  -- personal: only the owner sees it. company: every Reports user sees the group (not the reports).
  scope text not null default 'personal' check (scope in ('personal', 'company')),
  owner_id uuid references public.profiles (id) on delete cascade,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists bi_report_groups_owner_idx on public.bi_report_groups (owner_id);
create index if not exists bi_report_groups_scope_idx on public.bi_report_groups (scope);

create table if not exists public.bi_report_group_items (
  group_id uuid not null references public.bi_report_groups (id) on delete cascade,
  report_id uuid not null references public.bi_reports (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, report_id)
);

create index if not exists bi_report_group_items_report_idx on public.bi_report_group_items (report_id);

-- Per-user suggestion state: dismissed, or in progress (Dexter is building it).
-- "Completed" is derived from whether an equivalent report exists, so it never goes stale.
create table if not exists public.bi_report_suggestion_states (
  user_id uuid not null references public.profiles (id) on delete cascade,
  suggestion_key text not null,
  status text not null check (status in ('in_progress', 'completed', 'dismissed')),
  report_id uuid references public.bi_reports (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, suggestion_key)
);

-- Small per-user Reports UI preferences (collapsed sections, last group).
create table if not exists public.bi_report_user_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
declare t text;
begin
  execute 'drop trigger if exists bi_report_groups_set_updated_at on public.bi_report_groups';
  execute 'create trigger bi_report_groups_set_updated_at before update on public.bi_report_groups for each row execute function public.set_updated_at()';
  foreach t in array array['bi_report_groups', 'bi_report_group_items', 'bi_report_suggestion_states', 'bi_report_user_prefs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
