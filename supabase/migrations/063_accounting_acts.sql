-- Акти виконаних послуг (LEVADIUS Vision → Бухгалтерія)
create table if not exists public.accounting_acts (
  id uuid primary key default gen_random_uuid(),
  act_number text,
  act_date date,
  contractor_name text not null default '',
  contractor_edrpou text,
  category text not null default 'Адміністративні'
    check (
      category in (
        'Сервіс техніки',
        'Логістика',
        'Польові послуги',
        'Адміністративні'
      )
    ),
  total_amount numeric(14, 2) not null default 0,
  vat_amount numeric(14, 2),
  services jsonb not null default '[]'::jsonb,
  equipment_id uuid references public.equipment (id) on delete set null,
  equipment_name_hint text,
  status text not null default 'posted'
    check (status in ('preview', 'posted', 'sent_to_1c', 'cancelled')),
  source text not null default 'levadius',
  notes text,
  actor_name text,
  created_at timestamptz not null default now()
);

comment on table public.accounting_acts is
  'Акти здачі-прийняття робіт/послуг (LEVADIUS OCR → Бухгалтерія)';

create index if not exists accounting_acts_date_idx
  on public.accounting_acts (act_date desc nulls last);

create index if not exists accounting_acts_equipment_idx
  on public.accounting_acts (equipment_id)
  where equipment_id is not null;

alter table public.accounting_acts enable row level security;

create policy "accounting_acts_select"
  on public.accounting_acts for select
  to anon, authenticated
  using (true);

create policy "accounting_acts_write"
  on public.accounting_acts for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.accounting_acts to anon, authenticated;

-- Журнал витрат техніки (ремонти / сервіс з актів)
create table if not exists public.equipment_expenses (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment (id) on delete cascade,
  amount_uah numeric(14, 2) not null,
  expense_date date,
  category text,
  description text,
  accounting_act_id uuid references public.accounting_acts (id) on delete set null,
  source text not null default 'levadius',
  created_at timestamptz not null default now()
);

comment on table public.equipment_expenses is
  'Витрати по техніці (ремонт/сервіс), зокрема з accounting_acts';

create index if not exists equipment_expenses_equipment_idx
  on public.equipment_expenses (equipment_id, expense_date desc nulls last);

alter table public.equipment_expenses enable row level security;

create policy "equipment_expenses_select"
  on public.equipment_expenses for select
  to anon, authenticated
  using (true);

create policy "equipment_expenses_write"
  on public.equipment_expenses for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.equipment_expenses to anon, authenticated;
