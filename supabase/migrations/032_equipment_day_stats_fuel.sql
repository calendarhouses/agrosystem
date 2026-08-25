-- Денні рівні палива в єдиному кеші флоту (Техніка / CRON / KPI)
-- Джерело: той самий getWialonUnitTrackBundle, що й «Зміна за день»

alter table public.wialon_equipment_day_stats
  add column if not exists fuel_start numeric(12, 2)
    check (fuel_start is null or fuel_start >= 0),
  add column if not exists fuel_end numeric(12, 2)
    check (fuel_end is null or fuel_end >= 0),
  add column if not exists fuel_delta numeric(12, 2),
  add column if not exists has_fuel_sensor boolean not null default false;

comment on column public.wialon_equipment_day_stats.fuel_start is
  'Рівень палива на початок дня (л), калібрований ДУТ';
comment on column public.wialon_equipment_day_stats.fuel_end is
  'Рівень палива на кінець дня / зараз (л)';
comment on column public.wialon_equipment_day_stats.fuel_delta is
  'fuel_end − fuel_start; null якщо недостовірно';
comment on column public.wialon_equipment_day_stats.has_fuel_sensor is
  'На юніті сконфігуровано ДУТ (не плутати з наявністю семплів за день)';
