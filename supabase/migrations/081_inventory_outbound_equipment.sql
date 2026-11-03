-- Списання запчастин привʼязуємо до техніки (не до поля).

alter table public.inventory_local_moves
  add column if not exists equipment_id uuid
    references public.equipment (id) on delete set null;

create index if not exists inventory_local_moves_equipment_id_idx
  on public.inventory_local_moves (equipment_id)
  where equipment_id is not null;

comment on column public.inventory_local_moves.equipment_id is
  'Техніка для списання запчастин (type=outbound, category=parts); для ЗЗР/добрив/насіння лишається field_id';
