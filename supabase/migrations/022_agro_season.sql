-- Агро-сезон (Crop Year) для розділення фінансів / списань / палива по роках
-- Значення: '2025', '2026' … (varchar / text)

-- ── inventory_local_moves ──────────────────────────────────────────
alter table public.inventory_local_moves
  add column if not exists season text not null default '2026';

create index if not exists inventory_local_moves_season_idx
  on public.inventory_local_moves (season);

comment on column public.inventory_local_moves.season is
  'Агросезон списання (напр. 2026)';

-- ── field_operations ───────────────────────────────────────────────
alter table public.field_operations
  add column if not exists season text not null default '2026';

-- Підтягнути з уже існуючого season_year, якщо є
update public.field_operations
set season = season_year::text
where season_year is not null
  and (season is null or season = '2026')
  and season_year::text <> season;

create index if not exists field_operations_season_idx
  on public.field_operations (season);

comment on column public.field_operations.season is
  'Агросезон наряду (напр. 2026); дублює season_year текстом';

-- ── wialon_field_fuel_logs ─────────────────────────────────────────
alter table public.wialon_field_fuel_logs
  add column if not exists season text not null default '2026';

-- Унікальність: поле × техніка × день × сезон
alter table public.wialon_field_fuel_logs
  drop constraint if exists wialon_field_fuel_logs_unique_day;

alter table public.wialon_field_fuel_logs
  add constraint wialon_field_fuel_logs_unique_day
  unique (field_id, equipment_id, date, season);

create index if not exists wialon_field_fuel_logs_season_idx
  on public.wialon_field_fuel_logs (season);

comment on column public.wialon_field_fuel_logs.season is
  'Агросезон витрати палива з Wialon';

-- Backfill сезон з дати логу (березень+ = рік дати)
update public.wialon_field_fuel_logs
set season = case
  when extract(month from date) >= 3 then extract(year from date)::text
  else (extract(year from date) - 1)::text
end
where season = '2026'
  and date is not null
  and (
    (extract(month from date) >= 3 and extract(year from date)::text <> '2026')
    or (extract(month from date) < 3)
  );

-- ── farm_fields (культура / паспорт сезону) ────────────────────────
alter table public.farm_fields
  add column if not exists season text not null default '2026';

create index if not exists farm_fields_season_idx
  on public.farm_fields (season);

comment on column public.farm_fields.season is
  'Агросезон паспорта поля (поточна культура / бюджет)';
