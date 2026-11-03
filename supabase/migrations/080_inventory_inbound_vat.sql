-- ПДВ для прихідних рухів ТМЦ (ручний прихід / накладна).
-- Ціна unit_price_uah = без ПДВ; суми зберігаємо окремо для UI та Excel/BAS.

alter table public.inventory_local_moves
  add column if not exists amount_ex_vat numeric(14, 2);

alter table public.inventory_local_moves
  add column if not exists vat_rate text;

alter table public.inventory_local_moves
  add column if not exists vat_amount numeric(14, 2);

alter table public.inventory_local_moves
  add column if not exists amount_incl_vat numeric(14, 2);

alter table public.inventory_local_moves
  drop constraint if exists inventory_local_moves_vat_rate_check;

alter table public.inventory_local_moves
  add constraint inventory_local_moves_vat_rate_check
  check (
    vat_rate is null
    or vat_rate in ('20', '14', '7', '0', 'none')
  );

comment on column public.inventory_local_moves.amount_ex_vat is
  'Сума рядка без ПДВ (₴) = qty × unit_price_uah';
comment on column public.inventory_local_moves.vat_rate is
  'Ставка ПДВ: 20 | 14 | 7 | 0 | none (Без ПДВ)';
comment on column public.inventory_local_moves.vat_amount is
  'Сума ПДВ (₴)';
comment on column public.inventory_local_moves.amount_incl_vat is
  'Усього з ПДВ (₴) = amount_ex_vat + vat_amount';

alter table public.warehouse_receipts
  add column if not exists amount_ex_vat numeric(14, 2);

alter table public.warehouse_receipts
  add column if not exists vat_amount numeric(14, 2);

alter table public.warehouse_receipts
  add column if not exists amount_incl_vat numeric(14, 2);

comment on column public.warehouse_receipts.amount_ex_vat is
  'Разом без ПДВ по всіх рядках накладної';
comment on column public.warehouse_receipts.vat_amount is
  'Разом ПДВ по накладній';
comment on column public.warehouse_receipts.amount_incl_vat is
  'Усього з ПДВ по накладній (дублює total_amount для зворотної сумісності)';
