-- Денні агрегати техніки (Wialon) для підсумку флоту без N× track з клієнта

create table if not exists public.wialon_equipment_day_stats (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  wialon_unit_id bigint not null,
  date date not null,
  season text not null default '2026',
  distance_km numeric(12, 2) not null default 0
    check (distance_km >= 0),
  work_hours numeric(12, 2) not null default 0
    check (work_hours >= 0),
  hours_idling numeric(12, 2) not null default 0
    check (hours_idling >= 0),
  hours_on_field numeric(12, 2) not null default 0
    check (hours_on_field >= 0),
  drain_events integer not null default 0
    check (drain_events >= 0),
  sync_time timestamptz not null default now(),
  constraint wialon_equipment_day_stats_unique
    unique (equipment_id, date, season)
);

create index if not exists wialon_equipment_day_stats_date_idx
  on public.wialon_equipment_day_stats (date desc);

create index if not exists wialon_equipment_day_stats_wialon_idx
  on public.wialon_equipment_day_stats (wialon_unit_id, date desc);

comment on table public.wialon_equipment_day_stats is
  'CRON/сервер: денний пробіг, idle, зливи, години на полях по техніці';

alter table public.wialon_equipment_day_stats enable row level security;

create policy "wialon_equipment_day_stats_read"
  on public.wialon_equipment_day_stats for select
  using (true);

create policy "wialon_equipment_day_stats_write"
  on public.wialon_equipment_day_stats for all
  using (true)
  with check (true);

grant select on public.wialon_equipment_day_stats to anon, authenticated;
grant insert, update, delete on public.wialon_equipment_day_stats to authenticated;
