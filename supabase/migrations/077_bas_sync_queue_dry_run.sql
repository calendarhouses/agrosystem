-- Розширення bas_sync_queue: dry-run / queued статуси + типи документів розпізнавання
-- Queue-Only: жодного OData POST з цієї таблиці.

alter table public.bas_sync_queue
  drop constraint if exists bas_sync_queue_document_type_check;

alter table public.bas_sync_queue
  add constraint bas_sync_queue_document_type_check
  check (
    document_type in (
      'work_order',
      'inventory_write_off',
      'fuel_dispense',
      'fuel_purchase',
      'fuel_transfer',
      'inventory_sale',
      'inventory_inbound',
      'unknown_document',
      'service_receipt',
      'grain_receipt',
      'fuel_advance'
    )
  );

alter table public.bas_sync_queue
  drop constraint if exists bas_sync_queue_status_check;

alter table public.bas_sync_queue
  add constraint bas_sync_queue_status_check
  check (
    status in (
      'pending',
      'processing',
      'synced',
      'error',
      'cancelled',
      'dry_run_ready',
      'queued',
      'pending_approval'
    )
  );

drop index if exists public.bas_sync_queue_pending_unique;

create unique index if not exists bas_sync_queue_open_unique
  on public.bas_sync_queue (document_type, source_id)
  where status in ('pending', 'dry_run_ready', 'queued', 'pending_approval');

comment on table public.bas_sync_queue is
  'Черга документів AgroSystem → BAS. dry_run_ready = Queue-Only без POST; queued = готово воркеру коли BAS_DRAFT_POST_ENABLED=true.';
