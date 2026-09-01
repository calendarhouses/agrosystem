-- Матеріали (ТМЦ) у нарядах: яке насіння / добриво / ЗЗР плануємо використати
create table if not exists public.field_operation_materials (
  id uuid primary key default gen_random_uuid(),
  operation_client_key text not null
    references public.field_operations (client_key) on delete cascade,
  inventory_bas_ref_key text not null,
  item_name text not null default '',
  category text,
  unit text,
  qty numeric(12, 3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_client_key, inventory_bas_ref_key)
);

create index if not exists field_operation_materials_client_key_idx
  on public.field_operation_materials (operation_client_key);

comment on table public.field_operation_materials is
  'Планові / фактичні ТМЦ на наряд (позиція складу + кількість).';

alter table public.field_operation_materials enable row level security;

create policy "field_operation_materials_select_anon"
  on public.field_operation_materials for select
  to anon, authenticated
  using (true);

create policy "field_operation_materials_insert_anon"
  on public.field_operation_materials for insert
  to anon, authenticated
  with check (true);

create policy "field_operation_materials_update_anon"
  on public.field_operation_materials for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "field_operation_materials_delete_anon"
  on public.field_operation_materials for delete
  to anon, authenticated
  using (true);

grant select, insert, update, delete on public.field_operation_materials to anon, authenticated;
