-- Таблиця збережених полів (агро-кадастр)
create table if not exists public.farm_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  crop text not null,
  area_ha numeric(12, 2) not null default 0,
  color text not null default '#276749',
  geometry jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.farm_fields enable row level security;

create policy "farm_fields_select_anon"
  on public.farm_fields for select
  to anon, authenticated
  using (true);

create policy "farm_fields_insert_anon"
  on public.farm_fields for insert
  to anon, authenticated
  with check (true);

create policy "farm_fields_update_anon"
  on public.farm_fields for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "farm_fields_delete_anon"
  on public.farm_fields for delete
  to anon, authenticated
  using (true);

grant select, insert, update, delete on public.farm_fields to anon, authenticated;
