-- Soft-cancel паливних транзакцій + розширення черги BAS (закупівля / переміщення).

alter table public.fuel_transactions
  add column if not exists is_reverted boolean not null default false;

alter table public.fuel_transactions
  add column if not exists notes text;

comment on column public.fuel_transactions.is_reverted is
  'Анульована операція (відкат залишку без hard-delete)';
comment on column public.fuel_transactions.notes is
  'Коментар диспетчера / агента до операції';

create index if not exists fuel_transactions_is_reverted_idx
  on public.fuel_transactions (is_reverted)
  where is_reverted = true;

-- Розширити check document_type у bas_sync_queue
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
      'fuel_transfer'
    )
  );
