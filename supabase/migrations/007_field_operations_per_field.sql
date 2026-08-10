-- Розширення нарядів: привʼязка до поля + повні дані картки історії
alter table public.field_operations
  add column if not exists field_key text,
  add column if not exists machinery text,
  add column if not exists implement text,
  add column if not exists occurred_at date,
  add column if not exists time_label text,
  add column if not exists season_year integer,
  add column if not exists area_total numeric(12, 2);

-- Старі рядки з field_id → стабільний ключ farm:<uuid>
update public.field_operations
set field_key = 'farm:' || field_id::text
where field_key is null
  and field_id is not null;

update public.field_operations
set field_key = 'orphan:' || client_key
where field_key is null or btrim(field_key) = '';

alter table public.field_operations
  alter column field_key set not null;

create index if not exists field_operations_field_key_idx
  on public.field_operations (field_key);

create index if not exists field_operations_field_key_occurred_idx
  on public.field_operations (field_key, occurred_at desc);

drop policy if exists "field_operations_delete_anon" on public.field_operations;
create policy "field_operations_delete_anon"
  on public.field_operations for delete
  to anon, authenticated
  using (true);

grant delete on public.field_operations to anon, authenticated;
