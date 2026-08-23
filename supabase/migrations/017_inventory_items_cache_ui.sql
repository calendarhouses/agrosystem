-- Локальні назви та приховування позицій оперативного складу.
alter table public.inventory_items_cache
  add column if not exists is_hidden boolean not null default false;

alter table public.inventory_items_cache
  add column if not exists custom_name text;

comment on column public.inventory_items_cache.is_hidden is
  'true — приховано з UI Оперативного складу (залишається в кеші)';
comment on column public.inventory_items_cache.custom_name is
  'Локальна зрозуміла назва; якщо null — показуємо name з BAS';

create index if not exists inventory_items_cache_hidden_idx
  on public.inventory_items_cache (is_hidden)
  where is_hidden = true;
