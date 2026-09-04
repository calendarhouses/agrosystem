-- Дозволяємо entity_type accounting_act для сканів актів послуг.
alter table public.operation_attachments
  drop constraint if exists operation_attachments_entity_type_check;

alter table public.operation_attachments
  add constraint operation_attachments_entity_type_check
  check (entity_type in ('inventory_move', 'fuel_transaction', 'accounting_act'));

comment on table public.operation_attachments is
  'Скани/фото накладних і актів до локальних операцій складу, палива та бухгалтерії';
