-- Привʼязка заправки (outbound) до активного наряду field_operations
alter table public.fuel_transactions
  add column if not exists field_operation_id uuid
    references public.field_operations (id) on delete set null;

create index if not exists fuel_transactions_field_operation_id_idx
  on public.fuel_transactions (field_operation_id)
  where field_operation_id is not null;

comment on column public.fuel_transactions.field_operation_id is
  'Опційно: наряд (in_progress), до якого привʼязана заправка техніки';
