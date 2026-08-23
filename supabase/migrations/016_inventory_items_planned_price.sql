-- Планова ціна ТМЦ для економіки полів (₴ за одиницю виміру).
alter table public.inventory_items_cache
  add column if not exists planned_price_uah numeric not null default 0;

comment on column public.inventory_items_cache.planned_price_uah is
  'Планова ціна за 1 од. виміру (₴); для Field Economics / оперативного складу';
