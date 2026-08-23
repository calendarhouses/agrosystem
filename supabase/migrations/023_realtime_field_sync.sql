-- Realtime sync: наряди, ТМЦ, паспорти полів
alter table public.field_operations replica identity full;
alter table public.inventory_local_moves replica identity full;
alter table public.farm_fields replica identity full;

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'field_operations'
  ) then
    alter publication supabase_realtime add table public.field_operations;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_local_moves'
  ) then
    alter publication supabase_realtime add table public.inventory_local_moves;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'farm_fields'
  ) then
    alter publication supabase_realtime add table public.farm_fields;
  end if;
end $migration$;
