-- Денна статистика по wialon_unit_id (флот часто ще не зіставлений з 1С)

alter table public.wialon_equipment_day_stats
  alter column equipment_id drop not null;

alter table public.wialon_equipment_day_stats
  drop constraint if exists wialon_equipment_day_stats_unique;

alter table public.wialon_equipment_day_stats
  add constraint wialon_equipment_day_stats_unique
    unique (wialon_unit_id, date, season);
