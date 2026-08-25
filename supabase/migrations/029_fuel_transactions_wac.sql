-- Середньозважена вартість (WAC): ціна й сума на момент транзакції
alter table public.fuel_transactions
  add column if not exists price_per_liter numeric(12, 4);

alter table public.fuel_transactions
  add column if not exists total_cost numeric(14, 2);

comment on column public.fuel_transactions.price_per_liter is
  '₴/л на момент операції: закупівельна (inbound) або середня складу-донора (transfer/outbound)';

comment on column public.fuel_transactions.total_cost is
  'Загальна вартість операції = amount_liters × price_per_liter';
