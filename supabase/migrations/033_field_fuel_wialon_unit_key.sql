-- Field fuel logs: ключ по Wialon unit (не лише mapped equipment).
-- Інакше KPI «Спалено на полях» бачить лише 1 з ~10 тракторів.

alter table public.wialon_field_fuel_logs
  add column if not exists wialon_unit_id bigint;

-- Підтягнути id з equipment, де вже є мапінг
update public.wialon_field_fuel_logs l
set wialon_unit_id = e.wialon_id
from public.equipment e
where l.equipment_id = e.id
  and l.wialon_unit_id is null
  and e.wialon_id is not null;

-- Рядки без Wialon id після бекфілу — прибрати (інакше NOT NULL)
delete from public.wialon_field_fuel_logs
where wialon_unit_id is null;

alter table public.wialon_field_fuel_logs
  alter column equipment_id drop not null;

alter table public.wialon_field_fuel_logs
  alter column wialon_unit_id set not null;

-- Старі unique по equipment
alter table public.wialon_field_fuel_logs
  drop constraint if exists wialon_field_fuel_logs_unique_day;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'wialon_field_fuel_logs_field_id_equipment_id_date_season_key'
  ) then
    alter table public.wialon_field_fuel_logs
      drop constraint wialon_field_fuel_logs_field_id_equipment_id_date_season_key;
  end if;
end $$;

alter table public.wialon_field_fuel_logs
  drop constraint if exists wialon_field_fuel_logs_unique_wialon_day;

alter table public.wialon_field_fuel_logs
  add constraint wialon_field_fuel_logs_unique_wialon_day
  unique (field_id, wialon_unit_id, date, season);

create index if not exists wialon_field_fuel_logs_wialon_idx
  on public.wialon_field_fuel_logs (wialon_unit_id, date desc);

comment on column public.wialon_field_fuel_logs.wialon_unit_id is
  'Wialon unit id — основний ключ синку (equipment_id опційний, якщо є мапінг)';
comment on column public.wialon_field_fuel_logs.equipment_id is
  'UUID equipment, якщо юніт зіставлений у довіднику; може бути null';
