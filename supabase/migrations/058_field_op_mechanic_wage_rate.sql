-- Механізатор на наряду + ставка ЗП ₴/га (памʼять за типом робіт).

alter table public.field_operations
  add column if not exists mechanic_name text;

alter table public.field_operations
  add column if not exists wage_rate_uah_per_ha numeric(12, 2);

comment on column public.field_operations.mechanic_name is
  'ПІБ механізатора (вільний текст, для автопідказок)';
comment on column public.field_operations.wage_rate_uah_per_ha is
  'Ставка ₴/га на момент наряду; wage_plan/wage_fact = ставка × площа';

create index if not exists field_operations_mechanic_name_idx
  on public.field_operations (mechanic_name)
  where mechanic_name is not null and btrim(mechanic_name) <> '';

create table if not exists public.work_type_wage_rates (
  work_type text primary key,
  rate_uah_per_ha numeric(12, 2) not null
    check (rate_uah_per_ha >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.work_type_wage_rates is
  'Остання ставка ₴/га за типом робіт — підтягується в новий наряд';

alter table public.work_type_wage_rates enable row level security;

drop policy if exists "work_type_wage_rates_select_authenticated"
  on public.work_type_wage_rates;
create policy "work_type_wage_rates_select_authenticated"
  on public.work_type_wage_rates for select
  to authenticated
  using (true);

revoke all on table public.work_type_wage_rates from anon;
grant select on table public.work_type_wage_rates to authenticated;
-- Запис лише через service role (API).
