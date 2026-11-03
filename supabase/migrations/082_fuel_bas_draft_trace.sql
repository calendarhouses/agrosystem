-- Трасування чернеток BAS для палива + мапінг джерела на ТЗ у довіднику.
-- Stage 2 (Передача палива): шапка = ТранспортноеСредство_Key + Получатель_Key (без Склад).

alter table public.fuel_transactions
  add column if not exists bas_draft_number text;

comment on column public.fuel_transactions.bas_draft_number is
  'Номер документа BAS (Number) після POST чернетки; журнал = bas_draft_entity';

alter table public.fuel_storages
  add column if not exists equipment_id uuid
    references public.equipment (id) on delete set null;

create index if not exists fuel_storages_equipment_id_idx
  on public.fuel_storages (equipment_id)
  where equipment_id is not null;

comment on column public.fuel_storages.equipment_id is
  'Техніка в BAS для шапки ПередачаТоплива.ТранспортноеСредство_Key (цистерна або бензовоз)';
