-- Маркер «день уже синхронізовано з Wialon» (навіть якщо 0 л / немає візитів).
-- Без цього ensure/backfill нескінченно ганяють порожні дні.

create table if not exists public.wialon_field_fuel_day_sync (
  date date primary key,
  synced_at timestamptz not null default now(),
  upserted integer not null default 0,
  units_processed integer not null default 0,
  skipped integer not null default 0
);

comment on table public.wialon_field_fuel_day_sync is
  'Календарні дні Kyiv, для яких уже виконано syncWialonFieldFuelForDate';

create index if not exists wialon_field_fuel_day_sync_synced_idx
  on public.wialon_field_fuel_day_sync (synced_at desc);
