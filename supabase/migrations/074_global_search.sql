-- Global Search: hybrid index for internal + already-synced data, provider settings,
-- synonyms, and per-user recents. Additive only.
--
-- What is indexed: JobTread jobs (from the jt_jobs cache), Knowledge Center titles/tags/
-- summaries (never document bodies), inventory items, and site inspections. Live CRM and HR
-- data (GoHighLevel, BambooHR) is never stored here; those providers query live.
--
-- The index only generates candidates. The application re-reads every candidate from its
-- source table and re-checks permission before returning it, so deleted records and removed
-- permissions never surface from a stale row. Retrieval also filters by ACL in SQL
-- (global_search_query), never only in the browser.
--
-- RLS is enabled with no policies: all access goes through server routes using the service
-- role. The query function is not executable by anon/authenticated clients.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists pg_trgm with schema extensions';
  else
    execute 'create extension if not exists pg_trgm';
  end if;
end $$;

create table if not exists public.global_search_index (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9-]{2,40}$'),
  record_id text not null check (char_length(record_id) between 1 and 80),
  category text not null,
  title text not null check (char_length(title) <= 300),
  subtitle text check (char_length(subtitle) <= 300),
  -- Normalized (lowercase, punctuation-free) approved fields only.
  search_text text not null default '' check (char_length(search_text) <= 4000),
  identifiers text[] not null default '{}',
  address_norm text,
  url text not null,
  -- Retrieval ACL: null = any approved role / any user. Every capability must be held.
  acl_roles text[],
  acl_users text[],
  acl_capabilities text[] not null default '{}',
  record_updated_at timestamptz,
  indexed_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  fts tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(search_text, ''))
  ) stored,
  constraint global_search_index_record unique (provider, record_id)
);

create index if not exists global_search_index_provider_idx
  on public.global_search_index (provider, indexed_at);
create index if not exists global_search_index_fts_idx
  on public.global_search_index using gin (fts);
create index if not exists global_search_index_identifiers_idx
  on public.global_search_index using gin (identifiers);

do $$
declare ops text := 'gin_trgm_ops';
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions')
     and exists (select 1 from pg_opclass c join pg_namespace n on n.oid = c.opcnamespace
                 where c.opcname = 'gin_trgm_ops' and n.nspname = 'extensions') then
    ops := 'extensions.gin_trgm_ops';
  end if;
  execute format(
    'create index if not exists global_search_index_trgm_idx on public.global_search_index using gin (search_text %s)',
    ops);
  execute format(
    'create index if not exists global_search_index_address_trgm_idx on public.global_search_index using gin (address_norm %s) where address_norm is not null',
    ops);
end $$;

-- Provider settings (admin) and index state (lifecycle bookkeeping).
create table if not exists public.global_search_providers (
  provider text primary key check (provider ~ '^[a-z0-9-]{2,40}$'),
  enabled boolean not null default true,
  -- Admin choice from the provider's approved field list (validated server-side).
  searchable_fields text[],
  last_indexed_at timestamptz,
  last_index_status text check (last_index_status in ('never', 'running', 'succeeded', 'failed', 'purged')),
  last_index_error text check (char_length(last_index_error) <= 300),
  indexed_count integer,
  last_index_duration_ms integer,
  last_index_trigger text,
  index_started_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.global_search_synonyms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique check (term ~ '^[a-z0-9 ]{1,40}$'),
  synonyms text[] not null check (cardinality(synonyms) between 1 and 10),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Per-user recents: references only (no titles), re-authorized on every read.
create table if not exists public.global_search_recents (
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  record_id text not null check (char_length(record_id) between 1 and 80),
  category text not null,
  use_count integer not null default 1 check (use_count >= 1),
  last_used_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, provider, record_id)
);

create index if not exists global_search_recents_user_idx
  on public.global_search_recents (user_id, last_used_at desc);

do $$
declare t text;
begin
  foreach t in array array['global_search_index', 'global_search_providers', 'global_search_synonyms', 'global_search_recents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- Candidate retrieval with ACL filtering, typo tolerance (pg_trgm), and full-text matching.
-- p_norm / p_addr / p_ident are pre-normalized by the app to [a-z0-9 ] so LIKE needs no escaping.
create or replace function public.global_search_query(
  p_query text,
  p_norm text,
  p_addr text,
  p_ident text,
  p_providers text[],
  p_role text,
  p_user text,
  p_capabilities text[],
  p_limit integer default 100
)
returns table (provider text, record_id text, score real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select
      nullif(regexp_replace(coalesce(p_norm, ''), '[^a-z0-9 ]', '', 'g'), '') as norm,
      nullif(regexp_replace(coalesce(p_addr, ''), '[^a-z0-9 ]', '', 'g'), '') as addr,
      nullif(regexp_replace(coalesce(p_ident, ''), '[^a-z0-9]', '', 'g'), '') as ident,
      case when coalesce(trim(p_query), '') = '' then null
           else websearch_to_tsquery('simple', p_query) end as tsq
  )
  select i.provider, i.record_id,
    greatest(
      similarity(i.search_text, q.norm),
      word_similarity(q.norm, i.search_text),
      case when q.tsq is null then 0 else ts_rank(i.fts, q.tsq) end,
      case when q.ident is not null and q.ident = any(i.identifiers) then 1 else 0 end
    )::real as score
  from public.global_search_index i, q
  where q.norm is not null
    and i.provider = any(p_providers)
    and (i.acl_roles is null or p_role = any(i.acl_roles))
    and (i.acl_users is null or p_user = any(i.acl_users) or 'admin' = any(p_capabilities))
    and i.acl_capabilities <@ coalesce(p_capabilities, '{}')
    and (
      i.search_text like '%' || q.norm || '%'
      or (q.ident is not null and exists (
            select 1 from unnest(i.identifiers) x where x like q.ident || '%'))
      or (q.tsq is not null and i.fts @@ q.tsq)
      or q.norm <% i.search_text
      or (q.addr is not null and i.address_norm like '%' || q.addr || '%')
    )
  order by score desc, i.title
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.global_search_query(text, text, text, text, text[], text, text, text[], integer) from public;
revoke all on function public.global_search_query(text, text, text, text, text[], text, text, text[], integer) from anon, authenticated;
grant execute on function public.global_search_query(text, text, text, text, text[], text, text, text[], integer) to service_role;
