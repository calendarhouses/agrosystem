-- Спільні оцінки часу завантаження KPI палива (для шкали % у всіх клієнтів).
create table if not exists public.fuel_kpi_load_stats (
  period text primary key
    check (period in ('today', 'yesterday', 'week', 'month', 'season')),
  ema_ms integer not null
    check (ema_ms >= 2000 and ema_ms <= 180000),
  samples integer not null default 1
    check (samples > 0),
  updated_at timestamptz not null default now()
);

comment on table public.fuel_kpi_load_stats is
  'EMA часу повного циклу GET /api/fuel/kpis по періоду — спільна шкала завантаження';

insert into public.fuel_kpi_load_stats (period, ema_ms, samples)
values
  ('today', 6000, 1),
  ('yesterday', 7000, 1),
  ('week', 12000, 1),
  ('month', 40000, 1),
  ('season', 75000, 1)
on conflict (period) do nothing;

alter table public.fuel_kpi_load_stats enable row level security;

-- Читають усі авторизовані (шкала); пише лише service role з API.
drop policy if exists "fuel_kpi_load_stats_select_auth" on public.fuel_kpi_load_stats;
create policy "fuel_kpi_load_stats_select_auth"
  on public.fuel_kpi_load_stats
  for select
  to authenticated
  using (true);
