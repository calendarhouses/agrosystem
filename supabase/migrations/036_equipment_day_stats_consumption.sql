-- Спалено/заправлено за день у денному кеші флоту.
-- fuel_delta показує лише різницю рівнів: у день із дозаправкою він додатний,
-- хоча техніка спалила сотні літрів. Тримаємо обидві цифри окремо.

alter table public.wialon_equipment_day_stats
  add column if not exists fuel_filled numeric(12, 2) not null default 0
    check (fuel_filled >= 0),
  add column if not exists fuel_consumed numeric(12, 2)
    check (fuel_consumed is null or fuel_consumed >= 0);

comment on column public.wialon_equipment_day_stats.fuel_filled is
  'Залито за день за ДУТ (л), спільний детектор detectFuelFills';
comment on column public.wialon_equipment_day_stats.fuel_consumed is
  'Спалено за день (л) = fuel_start − fuel_end + fuel_filled';
