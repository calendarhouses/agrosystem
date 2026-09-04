-- 063 міг «пройти» як no-op (CREATE TABLE IF NOT EXISTS), якщо таблиця
-- уже була без колонки status. Ця міграція доводить схему до актуальної.

alter table public.accounting_acts
  add column if not exists act_number text;

alter table public.accounting_acts
  add column if not exists act_date date;

alter table public.accounting_acts
  add column if not exists contractor_name text not null default '';

alter table public.accounting_acts
  add column if not exists contractor_edrpou text;

alter table public.accounting_acts
  add column if not exists category text not null default 'Адміністративні';

alter table public.accounting_acts
  add column if not exists total_amount numeric(14, 2) not null default 0;

alter table public.accounting_acts
  add column if not exists vat_amount numeric(14, 2);

alter table public.accounting_acts
  add column if not exists services jsonb not null default '[]'::jsonb;

alter table public.accounting_acts
  add column if not exists equipment_id uuid references public.equipment (id) on delete set null;

alter table public.accounting_acts
  add column if not exists equipment_name_hint text;

alter table public.accounting_acts
  add column if not exists status text not null default 'posted';

alter table public.accounting_acts
  add column if not exists source text not null default 'levadius';

alter table public.accounting_acts
  add column if not exists notes text;

alter table public.accounting_acts
  add column if not exists actor_name text;

alter table public.accounting_acts
  add column if not exists created_at timestamptz not null default now();

-- Старі рядки без статусу → posted
update public.accounting_acts
set status = 'posted'
where status is null or btrim(status) = '';

alter table public.accounting_acts
  drop constraint if exists accounting_acts_status_check;

alter table public.accounting_acts
  add constraint accounting_acts_status_check
  check (status in ('preview', 'posted', 'sent_to_1c', 'cancelled'));

create index if not exists accounting_acts_date_idx
  on public.accounting_acts (act_date desc nulls last);

create index if not exists accounting_acts_equipment_idx
  on public.accounting_acts (equipment_id)
  where equipment_id is not null;
