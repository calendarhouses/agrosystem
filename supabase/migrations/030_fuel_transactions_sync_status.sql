-- Статус синхронізації паливної операції з BAS (1С)
-- Чернетки: лише pending → бухгалтер перевіряє; OData WRITE поки stub.

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'fuel_sync_status'
  ) then
    create type public.fuel_sync_status as enum (
      'pending_1c',
      'synced',
      'error'
    );
  end if;
end $$;

alter table public.fuel_transactions
  add column if not exists sync_status public.fuel_sync_status
    not null default 'pending_1c';

comment on column public.fuel_transactions.sync_status is
  'pending_1c = чекає бухгалтера / чернетку 1С; synced = проведено в BAS; error = збій синхронізації';

create index if not exists fuel_transactions_sync_status_idx
  on public.fuel_transactions (sync_status);
