-- Операції на полях (наряди): план / факт / статус
create table if not exists public.field_operations (
  id uuid primary key default gen_random_uuid(),
  client_key text not null,
  field_id uuid references public.farm_fields (id) on delete set null,
  work_type text not null,
  crop text not null,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  area_plan numeric(12, 2),
  area_fact numeric(12, 2),
  fuel_plan numeric(12, 2),
  fuel_fact numeric(12, 2),
  wage_plan numeric(12, 2),
  wage_fact numeric(12, 2),
  agronomist_comment text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_key)
);

create index if not exists field_operations_field_id_idx
  on public.field_operations (field_id);

alter table public.field_operations enable row level security;

create policy "field_operations_select_anon"
  on public.field_operations for select
  to anon, authenticated
  using (true);

create policy "field_operations_insert_anon"
  on public.field_operations for insert
  to anon, authenticated
  with check (true);

create policy "field_operations_update_anon"
  on public.field_operations for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.field_operations to anon, authenticated;
