-- Історичні погодні штампи для Операційної хронології (фіксуємо назавжди при створенні запису).
-- JSONB: { "temp": number, "humidity": number, "condition": string, "icon": string }

alter table public.field_operations
  add column if not exists weather_context jsonb;

comment on column public.field_operations.weather_context is
  'Погодний штамп на момент наряду: { temp, humidity, condition, icon }';

alter table public.inventory_local_moves
  add column if not exists weather_context jsonb;

comment on column public.inventory_local_moves.weather_context is
  'Погодний штамп на момент списання: { temp, humidity, condition, icon }';

alter table public.scouting_reports
  add column if not exists weather_context jsonb;

comment on column public.scouting_reports.weather_context is
  'Погодний штамп на момент скаутингу: { temp, humidity, condition, icon }';
