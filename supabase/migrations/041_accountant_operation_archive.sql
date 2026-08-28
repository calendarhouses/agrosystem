-- Архів видалених операцій бухгалтера (хто / коли / snapshot).
-- Передані лишаються в inventory_local_moves / fuel_transactions зі статусом —
-- сюди пишемо лише видалення, щоб історія не зникала.

create table if not exists public.accountant_operation_archive (
  id uuid primary key default gen_random_uuid(),
  season text,
  source text not null
    check (source in ('inventory', 'fuel')),
  original_id uuid,
  kind text not null,
  event_type text not null
    check (event_type = 'deleted'),
  title text not null,
  party text,
  qty numeric,
  unit text,
  amount_uah numeric,
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists accountant_operation_archive_season_idx
  on public.accountant_operation_archive (season, created_at desc);

create index if not exists accountant_operation_archive_created_idx
  on public.accountant_operation_archive (created_at desc);

comment on table public.accountant_operation_archive is
  'Видалені з черги/системи операції для архіву бухгалтера (snapshot + актор).';
