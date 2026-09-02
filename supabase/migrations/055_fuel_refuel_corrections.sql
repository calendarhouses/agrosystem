-- Корекції заправок з радара: підтвердження / відхилення → впливають на KPI «Заправлено».

create table if not exists public.fuel_refuel_corrections (
  id uuid primary key default gen_random_uuid(),
  wialon_unit_id bigint not null,
  event_time timestamptz not null,
  wialon_detected_liters numeric(12, 2) not null check (wialon_detected_liters >= 0),
  corrected_liters numeric(12, 2) check (corrected_liters is null or corrected_liters > 0),
  status text not null check (status in ('confirmed', 'dismissed')),
  from_storage_id uuid references public.fuel_storages (id) on delete set null,
  fuel_transaction_id uuid references public.fuel_transactions (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint fuel_refuel_corrections_unique unique (wialon_unit_id, event_time),
  constraint fuel_refuel_corrections_confirmed_liters check (
    status = 'dismissed' or corrected_liters is not null
  )
);

create index if not exists fuel_refuel_corrections_time_idx
  on public.fuel_refuel_corrections (event_time desc);

create index if not exists fuel_refuel_corrections_unit_time_idx
  on public.fuel_refuel_corrections (wialon_unit_id, event_time desc);

comment on table public.fuel_refuel_corrections is
  'Рішення оператора по заправці Wialon: підтвердити (можна виправити л) або відхилити — коригує KPI';

-- Перенести старі відхилення з fuel_radar_dismissed
insert into public.fuel_refuel_corrections (
  wialon_unit_id,
  event_time,
  wialon_detected_liters,
  corrected_liters,
  status,
  reason,
  created_at
)
select
  wialon_unit_id,
  event_time,
  volume_liters,
  null,
  'dismissed',
  reason,
  dismissed_at
from public.fuel_radar_dismissed
on conflict (wialon_unit_id, event_time) do nothing;

alter table public.fuel_refuel_corrections enable row level security;

drop policy if exists "fuel_refuel_corrections_all" on public.fuel_refuel_corrections;
create policy "fuel_refuel_corrections_all"
  on public.fuel_refuel_corrections
  for all
  to authenticated
  using (true)
  with check (true);
