-- Архів бухгалтера: дозволити source service_act (акти послуг).
alter table public.accountant_operation_archive
  drop constraint if exists accountant_operation_archive_source_check;

alter table public.accountant_operation_archive
  add constraint accountant_operation_archive_source_check
  check (source in ('inventory', 'fuel', 'service_act'));
