-- Realtime для журналу палива / цистерн (миттєве оновлення UI після заправки)
alter table public.fuel_transactions replica identity full;
alter table public.fuel_storages replica identity full;

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fuel_transactions'
  ) then
    alter publication supabase_realtime add table public.fuel_transactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fuel_storages'
  ) then
    alter publication supabase_realtime add table public.fuel_storages;
  end if;
end $migration$;
