-- Супер-фічі диспетчера LEVADIUS: порушення якості, статуси поломки, антиспам тривог

alter table public.field_operations
  add column if not exists has_violations boolean not null default false;

comment on column public.field_operations.has_violations is
  'Систематичне перевищення швидкості / витрати ДП (auditOperationQuality)';

create index if not exists field_operations_has_violations_idx
  on public.field_operations (has_violations)
  where has_violations = true;

alter table public.equipment
  drop constraint if exists equipment_maintenance_status_check;

alter table public.equipment
  add constraint equipment_maintenance_status_check
  check (
    maintenance_status in ('ok', 'service_due', 'breakdown', 'in_repair')
  );

comment on column public.equipment.maintenance_status is
  'ok | service_due | breakdown | in_repair';

create table if not exists public.levadius_dispatch_alert_dedupe (
  alert_key text primary key,
  alert_kind text not null,
  payload jsonb not null default '{}'::jsonb,
  last_sent_at timestamptz not null default now()
);

comment on table public.levadius_dispatch_alert_dedupe is
  'Антиспам для smart-dispatch-watchdog (паливо / погода)';

alter table public.levadius_dispatch_alert_dedupe enable row level security;

drop policy if exists "levadius_dispatch_alert_dedupe_select"
  on public.levadius_dispatch_alert_dedupe;
create policy "levadius_dispatch_alert_dedupe_select"
  on public.levadius_dispatch_alert_dedupe for select
  to authenticated
  using (true);

revoke all on table public.levadius_dispatch_alert_dedupe from anon;
grant select on table public.levadius_dispatch_alert_dedupe to authenticated;
