-- Multi-prospect names on PEM NEATs.
-- Keep prospect_name as the human-facing display label (e.g. "Cindy Lee & Razel Talle").
-- prospect_names is the authoritative structured match set.

alter table public.pem_neats
  add column if not exists prospect_names text[] not null default '{}'::text[];

comment on column public.pem_neats.prospect_names is
  'Structured list of individual prospect/homeowner names for matching. prospect_name remains the display label.';

-- Backfill from existing combined prospect_name strings.
-- Split on &, +, comma, and the standalone word "and".
with split as (
  select
    id,
    prospect_name,
    array_remove(
      array(
        select trim(part)
        from unnest(
          regexp_split_to_array(
            trim(prospect_name),
            '\s*(?:&|\+|,|\band\b)\s*',
            'i'
          )
        ) as part
        where length(trim(part)) > 0
      ),
      null
    ) as parts
  from public.pem_neats
  where coalesce(array_length(prospect_names, 1), 0) = 0
)
update public.pem_neats p
set prospect_names = case
  when array_length(s.parts, 1) is null or array_length(s.parts, 1) = 0
    then array[trim(p.prospect_name)]
  else s.parts
end
from split s
where p.id = s.id;

-- Ensure every row has at least the display name in the array.
update public.pem_neats
set prospect_names = array[trim(prospect_name)]
where coalesce(array_length(prospect_names, 1), 0) = 0
  and length(trim(prospect_name)) > 0;

alter table public.pem_neats
  drop constraint if exists pem_neats_prospect_names_nonempty;

alter table public.pem_neats
  add constraint pem_neats_prospect_names_nonempty
  check (array_length(prospect_names, 1) >= 1);

create index if not exists pem_neats_prospect_names_gin_idx
  on public.pem_neats using gin (prospect_names);
