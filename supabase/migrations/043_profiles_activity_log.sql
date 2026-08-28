-- Профілі команди + журнал дій (хто що зробив у системі).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'admin',
      'owner',
      'agronomist',
      'accountant'
    );
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'agronomist',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Профіль користувача AgroSystem: ПІБ + роль для підписів і доступу';
comment on column public.profiles.full_name is
  'Коротке імʼя для UI, напр. Назар / Юрій';
comment on column public.profiles.role is
  'admin | owner | agronomist | accountant';

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Сервісний role обходить RLS; insert профілів — через seed / service.

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null,
  actor_role public.app_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  meta jsonb not null default '{}'::jsonb
);

comment on table public.activity_log is
  'Журнал дій користувачів: створення / зміна / видалення по всій системі';
comment on column public.activity_log.actor_name is
  'Підпис як у UI, напр. «Адмін Назар»';
comment on column public.activity_log.action is
  'create | update | delete | close | export | login | mapping | sync | other';

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);
create index if not exists activity_log_actor_idx
  on public.activity_log (actor_id);
create index if not exists activity_log_entity_idx
  on public.activity_log (entity_type, entity_id);

alter table public.activity_log enable row level security;

drop policy if exists "activity_log_select_authenticated" on public.activity_log;
create policy "activity_log_select_authenticated"
  on public.activity_log for select
  to authenticated
  using (true);

-- Підпис автора на ключових операційних таблицях
alter table public.inventory_local_moves
  add column if not exists actor_id uuid,
  add column if not exists actor_name text,
  add column if not exists updated_by_id uuid,
  add column if not exists updated_by_name text;

alter table public.fuel_transactions
  add column if not exists actor_id uuid,
  add column if not exists actor_name text;

alter table public.field_operations
  add column if not exists actor_id uuid,
  add column if not exists actor_name text,
  add column if not exists closed_by_id uuid,
  add column if not exists closed_by_name text;

comment on column public.inventory_local_moves.actor_name is
  'Хто створив рух (підпис ролі), напр. Агроном Юрій';
comment on column public.fuel_transactions.actor_name is
  'Хто зберіг операцію в системі (не механізатор у полі)';
comment on column public.field_operations.actor_name is
  'Хто створив / вів наряд';
comment on column public.field_operations.closed_by_name is
  'Хто закрив наряд';
