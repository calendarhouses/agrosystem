-- Склади палива (дизель): база + бензовоз
create table if not exists public.fuel_storages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'stationary',
  capacity numeric(12, 2) not null default 0,
  current_volume numeric(12, 2) not null default 0,
  price_per_liter numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint fuel_storages_type_check check (type in ('stationary', 'mobile')),
  constraint fuel_storages_volume_check check (current_volume >= 0),
  constraint fuel_storages_capacity_check check (capacity > 0)
);

alter table public.fuel_storages enable row level security;

create policy "fuel_storages_select_anon"
  on public.fuel_storages for select
  to anon, authenticated
  using (true);

create policy "fuel_storages_insert_anon"
  on public.fuel_storages for insert
  to anon, authenticated
  with check (true);

create policy "fuel_storages_update_anon"
  on public.fuel_storages for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.fuel_storages to anon, authenticated;

-- Realtime для живих цистерн у UI
alter publication supabase_realtime add table public.fuel_storages;
