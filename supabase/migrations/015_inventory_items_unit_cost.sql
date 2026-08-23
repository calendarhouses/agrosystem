-- Орієнтовна ціна за одиницю для економіки полів (₴).
-- Заповнюється вручну або майбутнім синком; nullable.
alter table public.inventory_items_cache
  add column if not exists unit_cost numeric;

comment on column public.inventory_items_cache.unit_cost is
  'Орієнтовна ціна за 1 од. виміру (₴); для Field Economics';
