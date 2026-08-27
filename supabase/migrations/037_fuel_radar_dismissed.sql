-- Відхилені радаром заправки: подія ДУТ, яку оператор визнав хибною.
-- Без цього «Відхилити» не має сенсу — подія повертається при наступному скані.

create table if not exists public.fuel_radar_dismissed (
  id uuid primary key default gen_random_uuid(),
  wialon_unit_id bigint not null,
  event_time timestamptz not null,
  volume_liters numeric(12, 2) not null check (volume_liters >= 0),
  reason text,
  dismissed_at timestamptz not null default now(),
  constraint fuel_radar_dismissed_unique unique (wialon_unit_id, event_time)
);

create index if not exists fuel_radar_dismissed_time_idx
  on public.fuel_radar_dismissed (event_time desc);

comment on table public.fuel_radar_dismissed is
  'Заправки з ДУТ, які оператор відхилив у радарі — не показувати знову';

alter table public.fuel_radar_dismissed enable row level security;

drop policy if exists "fuel_radar_dismissed_all" on public.fuel_radar_dismissed;
create policy "fuel_radar_dismissed_all"
  on public.fuel_radar_dismissed
  for all
  to authenticated
  using (true)
  with check (true);
