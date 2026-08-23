-- Автоматичні логи витрати палива з Wialon (ДРП у геозоні поля)
-- Upsert ключ: один запис на (поле × техніка × день)

create table if not exists public.wialon_field_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.farm_fields (id) on delete cascade,
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  date date not null,
  fuel_consumed numeric(12, 2) not null default 0
    check (fuel_consumed >= 0),
  sync_time timestamptz not null default now(),
  constraint wialon_field_fuel_logs_unique_day
    unique (field_id, equipment_id, date)
);

create index if not exists wialon_field_fuel_logs_field_date_idx
  on public.wialon_field_fuel_logs (field_id, date desc);

create index if not exists wialon_field_fuel_logs_date_idx
  on public.wialon_field_fuel_logs (date desc);

comment on table public.wialon_field_fuel_logs is
  'Фоновий CRON: витрата палива за ДРП під час перебування техніки в геозоні поля';
comment on column public.wialon_field_fuel_logs.fuel_consumed is
  'Літри (Fuel consumed by FLS) за день на цьому полі';

alter table public.wialon_field_fuel_logs enable row level security;

create policy "wialon_field_fuel_logs_read"
  on public.wialon_field_fuel_logs for select
  using (true);

create policy "wialon_field_fuel_logs_write"
  on public.wialon_field_fuel_logs for all
  using (true)
  with check (true);

grant select on public.wialon_field_fuel_logs to anon, authenticated;
grant insert, update, delete on public.wialon_field_fuel_logs to authenticated;
