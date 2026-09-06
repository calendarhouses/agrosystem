-- Операційне ядро LEVADIUS: старт наряду, мультиденний діапазон, soft-cancel списань.

alter table public.field_operations
  add column if not exists started_at timestamptz;

alter table public.field_operations
  add column if not exists date_from date;

alter table public.field_operations
  add column if not exists date_to date;

comment on column public.field_operations.started_at is
  'Момент переходу planned → in_progress (LEVADIUS startWorkOrder)';
comment on column public.field_operations.date_from is
  'Початок мультиденного наряду (YYYY-MM-DD)';
comment on column public.field_operations.date_to is
  'Кінець мультиденного наряду (YYYY-MM-DD); null = один день';

create index if not exists field_operations_started_at_idx
  on public.field_operations (started_at desc)
  where started_at is not null;

alter table public.inventory_local_moves
  add column if not exists is_reverted boolean not null default false;

comment on column public.inventory_local_moves.is_reverted is
  'Анульоване списання (повернення на склад без hard-delete)';

create index if not exists inventory_local_moves_is_reverted_idx
  on public.inventory_local_moves (is_reverted)
  where is_reverted = true;
