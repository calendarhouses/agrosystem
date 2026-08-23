-- Operational Inventory («тіньовий склад»):
-- локальний довідник ТМЦ + оперативні списання на поле (без запису в BAS).

-- ── Довідник номенклатури (кеш з BAS) ───────────────────────────────
create table if not exists public.inventory_items_cache (
  id           uuid primary key default gen_random_uuid(),
  bas_ref_key  uuid not null unique,
  name         text not null,
  category     text not null,
  unit         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint inventory_items_cache_category_check
    check (category in ('zzr', 'fertilizer', 'harvest', 'parts', 'seed'))
);

comment on table public.inventory_items_cache is
  'Швидкий довідник ТМЦ з BAS Catalog_Номенклатура (Operational Inventory)';
comment on column public.inventory_items_cache.bas_ref_key is
  'Ref_Key елемента Catalog_Номенклатура';
comment on column public.inventory_items_cache.category is
  'zzr | fertilizer | harvest | parts | seed';

create index if not exists inventory_items_cache_category_idx
  on public.inventory_items_cache (category);

create index if not exists inventory_items_cache_name_idx
  on public.inventory_items_cache (lower(name));

-- ── Локальні рухи (списання на поле тощо) ───────────────────────────
create table if not exists public.inventory_local_moves (
  id             uuid primary key default gen_random_uuid(),
  item_ref_key   uuid not null
    references public.inventory_items_cache (bas_ref_key) on delete restrict,
  type           text not null default 'outbound',
  qty            numeric not null check (qty > 0),
  field_id       uuid
    references public.farm_fields (id) on delete set null,
  date           timestamptz not null default now(),
  status         text not null default 'draft',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint inventory_local_moves_type_check
    check (type in ('outbound')),
  constraint inventory_local_moves_status_check
    check (status in ('draft', 'sent_to_1c'))
);

comment on table public.inventory_local_moves is
  'Оперативні списання ТМЦ на поле (тіньовий склад; у 1С котлом раз на місяць)';
comment on column public.inventory_local_moves.type is
  'outbound — списання на поле';
comment on column public.inventory_local_moves.status is
  'draft | sent_to_1c';

create index if not exists inventory_local_moves_item_idx
  on public.inventory_local_moves (item_ref_key);

create index if not exists inventory_local_moves_field_idx
  on public.inventory_local_moves (field_id);

create index if not exists inventory_local_moves_date_idx
  on public.inventory_local_moves (date desc);

create index if not exists inventory_local_moves_status_idx
  on public.inventory_local_moves (status);

-- ── RLS (як у інших таблицях проєкту) ───────────────────────────────
alter table public.inventory_items_cache enable row level security;
alter table public.inventory_local_moves enable row level security;

create policy "inventory_items_cache_read"
  on public.inventory_items_cache for select using (true);
create policy "inventory_items_cache_write"
  on public.inventory_items_cache for all using (true);

create policy "inventory_local_moves_read"
  on public.inventory_local_moves for select using (true);
create policy "inventory_local_moves_write"
  on public.inventory_local_moves for all using (true);

grant select, insert, update, delete on public.inventory_items_cache to anon, authenticated;
grant select, insert, update, delete on public.inventory_local_moves to anon, authenticated;
