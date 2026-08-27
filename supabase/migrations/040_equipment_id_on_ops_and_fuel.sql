-- Привʼязка нарядів і заправок до довідника equipment (техніки без GPS теж)

alter table public.field_operations
  add column if not exists equipment_id uuid references public.equipment (id) on delete set null;

create index if not exists field_operations_equipment_id_idx
  on public.field_operations (equipment_id)
  where equipment_id is not null;

comment on column public.field_operations.equipment_id is
  'Довідник equipment (1С); wialon_unit_id лишається для GPS-флоу';

alter table public.fuel_transactions
  add column if not exists equipment_id uuid references public.equipment (id) on delete set null;

create index if not exists fuel_transactions_equipment_id_idx
  on public.fuel_transactions (equipment_id)
  where equipment_id is not null;

comment on column public.fuel_transactions.equipment_id is
  'Довідник equipment; для техніки без трекера wialon_unit_id може бути null';

-- Бекфіл за збігом Wialon id
update public.field_operations fo
set equipment_id = e.id
from public.equipment e
where fo.equipment_id is null
  and fo.wialon_unit_id is not null
  and e.wialon_id = fo.wialon_unit_id;

update public.fuel_transactions ft
set equipment_id = e.id
from public.equipment e
where ft.equipment_id is null
  and ft.wialon_unit_id is not null
  and e.wialon_id = ft.wialon_unit_id;
