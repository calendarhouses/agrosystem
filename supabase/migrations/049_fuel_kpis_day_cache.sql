-- Спільний денний кеш KPI палива (сезон/місяць/тиждень) для всіх інстансів.
create table if not exists public.fuel_kpis_day_cache (
  period text not null
    check (period in ('today', 'yesterday', 'week', 'month', 'season')),
  day_ymd text not null
    check (day_ymd ~ '^\d{4}-\d{2}-\d{2}$'),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (period, day_ymd)
);

comment on table public.fuel_kpis_day_cache is
  'Готовий JSON KPI палива на календарний день Києва — без повторного Wialon для всіх користувачів';

alter table public.fuel_kpis_day_cache enable row level security;

-- Читання/запис лише через service role (API). Authenticated не потрібен напряму.
drop policy if exists "fuel_kpis_day_cache_deny_all" on public.fuel_kpis_day_cache;
-- RLS увімкнено без policy для authenticated/anon = закрито; service_role обходить RLS.
