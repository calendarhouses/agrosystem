-- Multi-line BAS чернетки по warehouse_receipts + код номенклатури + контрагенти.

-- ── warehouse_receipts: трекінг чернетки BAS ───────────────────────
alter table public.warehouse_receipts
  add column if not exists bas_draft_ref_key uuid,
  add column if not exists bas_draft_entity text,
  add column if not exists bas_draft_sent_at timestamptz,
  add column if not exists bas_draft_error text,
  add column if not exists bas_handoff_status text not null default 'local_saved';

alter table public.warehouse_receipts
  drop constraint if exists warehouse_receipts_bas_handoff_status_check;

alter table public.warehouse_receipts
  add constraint warehouse_receipts_bas_handoff_status_check
  check (
    bas_handoff_status in (
      'local_saved',
      'awaiting_bas_mapping',
      'bas_draft_posted',
      'bas_draft_dry_run',
      'bas_draft_failed'
    )
  );

comment on column public.warehouse_receipts.bas_draft_ref_key is
  'Ref_Key непроведеної Document_ПоступлениеТоваровУслуг у BAS (1 накладна = 1 документ)';
comment on column public.warehouse_receipts.bas_handoff_status is
  'local_saved | awaiting_bas_mapping | bas_draft_posted | bas_draft_dry_run | bas_draft_failed — не плутати з Excel sent_to_1c';

create index if not exists warehouse_receipts_bas_draft_ref_idx
  on public.warehouse_receipts (bas_draft_ref_key)
  where bas_draft_ref_key is not null;

-- ── inventory_items_cache.code (артикул BAS) ───────────────────────
alter table public.inventory_items_cache
  add column if not exists code text;

comment on column public.inventory_items_cache.code is
  'Артикул / Code з Catalog_Номенклатура (для матчингу накладних)';

create index if not exists inventory_items_cache_code_idx
  on public.inventory_items_cache (lower(code))
  where code is not null and code <> '';

-- ── Мапінг постачальників → Контрагент_Key ─────────────────────────
create table if not exists public.bas_counterparties (
  id uuid primary key default gen_random_uuid(),
  edrpou text,
  name text not null default '',
  bas_ref_key uuid not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bas_counterparties is
  'Мапінг постачальників LEVADA → Catalog_Контрагенты (лише звʼязок у нашій БД)';

create unique index if not exists bas_counterparties_edrpou_uidx
  on public.bas_counterparties (edrpou)
  where edrpou is not null and edrpou <> '';

create index if not exists bas_counterparties_name_idx
  on public.bas_counterparties (lower(name));

alter table public.bas_counterparties enable row level security;

drop policy if exists "bas_counterparties_select" on public.bas_counterparties;
create policy "bas_counterparties_select"
  on public.bas_counterparties for select
  to anon, authenticated
  using (true);

drop policy if exists "bas_counterparties_write" on public.bas_counterparties;
create policy "bas_counterparties_write"
  on public.bas_counterparties for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.bas_counterparties to anon, authenticated;
