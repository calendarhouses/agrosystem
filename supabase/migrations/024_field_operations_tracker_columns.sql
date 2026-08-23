-- Дубль 008 (idempotent): трекер + export_status для field_operations
-- Потрібно, якщо на віддаленій БД пропустили 008.

alter table public.field_operations
  add column if not exists wialon_unit_id bigint,
  add column if not exists implement_width_m numeric(6, 2),
  add column if not exists tracker_distance_km numeric(12, 2),
  add column if not exists tracker_work_hours numeric(12, 2),
  add column if not exists tracker_fuel_l numeric(12, 2),
  add column if not exists export_status text not null default 'none';

alter table public.field_operations
  drop constraint if exists field_operations_export_status_check;

alter table public.field_operations
  add constraint field_operations_export_status_check
  check (export_status in ('none', 'pending', 'synced'));

create index if not exists field_operations_wialon_unit_occurred_idx
  on public.field_operations (wialon_unit_id, occurred_at)
  where wialon_unit_id is not null;

create index if not exists field_operations_planned_today_idx
  on public.field_operations (status, occurred_at)
  where status = 'planned';
