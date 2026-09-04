-- Проактивні сповіщення LEVADIUS: Telegram + стан телеметрійного моніторингу

alter table public.profiles
  add column if not exists telegram_chat_id text;

comment on column public.profiles.telegram_chat_id is
  'Telegram chat_id керівника для ранкових зведень і аномалій LEVADIUS';

create index if not exists profiles_telegram_chat_id_idx
  on public.profiles (telegram_chat_id)
  where telegram_chat_id is not null and btrim(telegram_chat_id) <> '';

create table if not exists public.levadius_telemetry_watch (
  equipment_id uuid primary key references public.equipment (id) on delete cascade,
  wialon_unit_id bigint,
  idle_since timestamptz,
  idle_field_id uuid references public.farm_fields (id) on delete set null,
  idle_alerted_at timestamptz,
  last_fuel_liters numeric(12, 2),
  last_fuel_at timestamptz,
  last_fuel_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.levadius_telemetry_watch is
  'Стан idle/пального між cron-тіками telemetry-alerts (антиспам + таймери)';

create index if not exists levadius_telemetry_watch_idle_idx
  on public.levadius_telemetry_watch (idle_since)
  where idle_since is not null;

alter table public.levadius_telemetry_watch enable row level security;

drop policy if exists "levadius_telemetry_watch_service" on public.levadius_telemetry_watch;
-- Доступ лише через service role (cron); authenticated читання для адмінки на майбутнє
create policy "levadius_telemetry_watch_authenticated_select"
  on public.levadius_telemetry_watch for select to authenticated
  using (true);

revoke all on table public.levadius_telemetry_watch from anon;
grant select on table public.levadius_telemetry_watch to authenticated;
