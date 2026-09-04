-- Черга документів на імпорт / чернетки в BAS АГРО (LEVADIUS Крок 11)
-- Не пише в OData сама — лише черга в нашій БД (+ dry-run / бухгалтер).

create table if not exists public.bas_sync_queue (
  id uuid primary key default gen_random_uuid(),
  document_type text not null
    check (
      document_type in (
        'work_order',
        'inventory_write_off',
        'fuel_dispense'
      )
    ),
  source_id text not null,
  source_table text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'synced', 'error', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  notes text,
  pipeline_id text,
  error_message text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.bas_sync_queue is
  'Черга документів AgroSystem → BAS (шляхові листи, ЛЗК, заправки). POST у BAS лише при BAS_DRAFT_POST_ENABLED.';

create index if not exists bas_sync_queue_status_idx
  on public.bas_sync_queue (status, created_at desc);

create index if not exists bas_sync_queue_source_idx
  on public.bas_sync_queue (document_type, source_id);

create unique index if not exists bas_sync_queue_pending_unique
  on public.bas_sync_queue (document_type, source_id)
  where status = 'pending';

alter table public.bas_sync_queue enable row level security;

create policy "bas_sync_queue_select"
  on public.bas_sync_queue for select
  to anon, authenticated
  using (true);

create policy "bas_sync_queue_write"
  on public.bas_sync_queue for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.bas_sync_queue
  to anon, authenticated;
