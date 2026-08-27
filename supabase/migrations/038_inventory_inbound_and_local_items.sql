-- Прихід на тіньовий склад + локальні позиції (ще без Ref_Key у 1С).
-- BAS лишається read-only: рухи йдуть у inventory_local_moves → Excel бухгалтеру.

alter table public.inventory_local_moves
  drop constraint if exists inventory_local_moves_type_check;

alter table public.inventory_local_moves
  add constraint inventory_local_moves_type_check
  check (type in ('outbound', 'inbound'));

comment on column public.inventory_local_moves.type is
  'outbound — списання; inbound — прихід / випуск (локально, без POST у BAS)';

alter table public.inventory_local_moves
  add column if not exists note text;

comment on column public.inventory_local_moves.note is
  'Коментар: контрагент, номер накладної, причина списання';

alter table public.inventory_items_cache
  add column if not exists is_local boolean not null default false;

comment on column public.inventory_items_cache.is_local is
  'true — створено в AgroSystem (немає в BAS); передати бухгалтеру через Excel';

create index if not exists inventory_items_cache_local_idx
  on public.inventory_items_cache (is_local)
  where is_local = true;
