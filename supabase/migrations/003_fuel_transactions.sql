-- Журнал паливних операцій
create table if not exists public.fuel_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null
    check (transaction_type in ('inbound', 'transfer', 'outbound')),
  amount_liters numeric(12, 2) not null check (amount_liters > 0),
  from_storage_id uuid references public.fuel_storages (id),
  to_storage_id uuid references public.fuel_storages (id),
  wialon_unit_id bigint,
  operator_name text,
  transaction_date timestamptz not null default now(),
  wialon_verified boolean not null default false,
  wialon_variance numeric(12, 2) not null default 0
);

alter table public.fuel_transactions enable row level security;

create policy "fuel_transactions_select_anon"
  on public.fuel_transactions for select
  to anon, authenticated
  using (true);

-- Записи з браузера йдуть через service-role API; політики insert лишаємо для майбутнього
create policy "fuel_transactions_insert_authenticated"
  on public.fuel_transactions for insert
  to authenticated
  with check (true);

grant select on public.fuel_transactions to anon, authenticated;
grant insert on public.fuel_transactions to authenticated;
