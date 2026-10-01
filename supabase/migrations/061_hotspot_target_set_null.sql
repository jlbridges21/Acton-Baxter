-- A deleted scene should leave incoming links in place with a null target
-- so the editor can show them as broken. ON DELETE CASCADE removed the hotspot.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'hotspots'
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%target_scene_id%';
  if constraint_name is not null then
    execute format('alter table public.hotspots drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.hotspots
  add constraint hotspots_target_scene_id_fkey
  foreign key (target_scene_id) references public.scenes (id) on delete set null;
