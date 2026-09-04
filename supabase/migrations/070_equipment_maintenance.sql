-- ТО / мотогодини техніки + журнал сервісу (LEVADIUS Крок 9)

alter table public.equipment
  add column if not exists current_motohours numeric(12, 2)
    check (current_motohours is null or current_motohours >= 0);

alter table public.equipment
  add column if not exists next_service_motohours numeric(12, 2)
    check (next_service_motohours is null or next_service_motohours >= 0);

alter table public.equipment
  add column if not exists maintenance_status text not null default 'ok';

alter table public.equipment
  drop constraint if exists equipment_maintenance_status_check;

alter table public.equipment
  add constraint equipment_maintenance_status_check
  check (maintenance_status in ('ok', 'service_due'));

comment on column public.equipment.current_motohours is
  'Поточне напрацювання (мотогодини); може оновлюватись з Wialon';
comment on column public.equipment.next_service_motohours is
  'Поріг мотогодин наступного ТО';
comment on column public.equipment.maintenance_status is
  'ok | service_due — потрібне ТО (hoursLeft <= 25 або прострочено)';

create index if not exists equipment_maintenance_due_idx
  on public.equipment (maintenance_status)
  where maintenance_status = 'service_due';

create table if not exists public.equipment_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  service_type text not null,
  service_interval_hours numeric(12, 2) not null default 250
    check (service_interval_hours > 0),
  motohours_at_service numeric(12, 2),
  next_service_motohours numeric(12, 2),
  notes text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);

comment on table public.equipment_maintenance_logs is
  'Історія проходження ТО / ремонтів (LEVADIUS logMaintenanceCompleted)';

create index if not exists equipment_maintenance_logs_equipment_idx
  on public.equipment_maintenance_logs (equipment_id, created_at desc);

alter table public.equipment_maintenance_logs enable row level security;

create policy "equipment_maintenance_logs_select"
  on public.equipment_maintenance_logs for select
  to anon, authenticated
  using (true);

create policy "equipment_maintenance_logs_write"
  on public.equipment_maintenance_logs for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.equipment_maintenance_logs
  to anon, authenticated;
