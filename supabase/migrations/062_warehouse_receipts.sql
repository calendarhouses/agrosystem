-- Журнал прибуткових накладних (LEVADIUS Vision / ручне оприбуткування)
create table if not exists public.warehouse_receipts (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null default '',
  supplier_edrpou text,
  invoice_number text,
  invoice_date date,
  total_amount numeric(14, 2),
  status text not null default 'posted'
    check (status in ('preview', 'posted', 'cancelled')),
  source text not null default 'levadius',
  actor_name text,
  created_at timestamptz not null default now()
);

comment on table public.warehouse_receipts is
  'Прибуткові накладні / чеки, оприбутковані через LEVADIUS або склад';

create index if not exists warehouse_receipts_date_idx
  on public.warehouse_receipts (invoice_date desc nulls last);

alter table public.warehouse_receipts enable row level security;

create policy "warehouse_receipts_select"
  on public.warehouse_receipts for select
  to anon, authenticated
  using (true);

create policy "warehouse_receipts_write"
  on public.warehouse_receipts for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.warehouse_receipts to anon, authenticated;

alter table public.inventory_local_moves
  add column if not exists receipt_id uuid
    references public.warehouse_receipts (id) on delete set null;

create index if not exists inventory_local_moves_receipt_id_idx
  on public.inventory_local_moves (receipt_id)
  where receipt_id is not null;
