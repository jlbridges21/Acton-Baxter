-- Read-only public schema snapshot for the admin entity diagram.
--
-- Run this by hand in the Baxter SQL editor. Do not apply it through the
-- Cursor Supabase connector — that project is not Baxter.
--
-- PostgREST does not expose information_schema. This function reads pg_catalog
-- as its owner and returns JSON. EXECUTE is limited to service_role. The admin
-- page calls it only after an isAdminRole check.

create or replace function public.admin_schema_erd()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', c.relname,
          'columns', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'name', a.attname,
                'dataType', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'nullable', not a.attnotnull,
                'primaryKey', exists (
                  select 1
                  from pg_catalog.pg_constraint pk
                  where pk.conrelid = c.oid
                    and pk.contype = 'p'
                    and a.attnum = any (pk.conkey)
                )
              )
              order by a.attnum
            )
            from pg_catalog.pg_attribute a
            where a.attrelid = c.oid
              and a.attnum > 0
              and not a.attisdropped
          ), '[]'::jsonb)
        )
        order by c.relname
      )
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
    ), '[]'::jsonb),
    'foreignKeys', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'constraintName', con.conname,
          'sourceTable', src.relname,
          'sourceColumns', coalesce((
            select jsonb_agg(sa.attname order by cols.ord)
            from unnest(con.conkey) with ordinality as cols(attnum, ord)
            join pg_catalog.pg_attribute sa
              on sa.attrelid = con.conrelid
             and sa.attnum = cols.attnum
          ), '[]'::jsonb),
          'targetTable', case
            when tgtn.nspname = 'public' then tgt.relname
            else tgtn.nspname || '.' || tgt.relname
          end,
          'targetColumns', coalesce((
            select jsonb_agg(ta.attname order by cols.ord)
            from unnest(con.confkey) with ordinality as cols(attnum, ord)
            join pg_catalog.pg_attribute ta
              on ta.attrelid = con.confrelid
             and ta.attnum = cols.attnum
          ), '[]'::jsonb)
        )
        order by src.relname, con.conname
      )
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class src on src.oid = con.conrelid
      join pg_catalog.pg_namespace srcn on srcn.oid = src.relnamespace
      join pg_catalog.pg_class tgt on tgt.oid = con.confrelid
      join pg_catalog.pg_namespace tgtn on tgtn.oid = tgt.relnamespace
      where con.contype = 'f'
        and srcn.nspname = 'public'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_schema_erd() from public;
revoke all on function public.admin_schema_erd() from anon;
revoke all on function public.admin_schema_erd() from authenticated;
grant execute on function public.admin_schema_erd() to service_role;
