-- Lockdown: прибрати anon write/read на операційних таблицях;
-- authenticated — повний доступ (ПК-реліз: усі ролі = повний доступ у застосунку).
-- Service role обходить RLS як і раніше.
-- Заборонити self-update profiles.role.

-- ── Helper: drop all policies on a table (idempotent via loop) ──────
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'farm_fields',
        'fuel_storages',
        'fuel_transactions',
        'field_operations',
        'equipment',
        'implements',
        'inventory_items_cache',
        'inventory_local_moves',
        'wialon_equipment_day_stats',
        'wialon_field_fuel_logs',
        'fuel_radar_dismissed',
        'operation_attachments',
        'wialon_bas_mapping',
        'accountant_operation_archive',
        'profiles',
        'activity_log'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );
  end loop;
end $$;

-- ── Core tables: authenticated only ────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'farm_fields',
    'fuel_storages',
    'fuel_transactions',
    'field_operations',
    'equipment',
    'implements',
    'inventory_items_cache',
    'inventory_local_moves',
    'wialon_equipment_day_stats',
    'wialon_field_fuel_logs',
    'fuel_radar_dismissed',
    'operation_attachments',
    'wialon_bas_mapping',
    'accountant_operation_archive'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_authenticated_all',
        t
      );
      -- Anon: лише revoke write; select теж закриваємо
      execute format('revoke all on table public.%I from anon', t);
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated',
        t
      );
    end if;
  end loop;
end $$;

-- ── profiles ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Оновлення власного профілю (імʼя/email), роль — ні (тригер нижче)
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;

create or replace function public.prevent_profile_role_self_update()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and coalesce(auth.role(), '') = 'authenticated'
  then
    raise exception 'Зміна ролі заборонена';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_self_update on public.profiles;
create trigger profiles_prevent_role_self_update
  before update on public.profiles
  for each row
  execute function public.prevent_profile_role_self_update();

-- ── activity_log: тільки читання для authenticated; insert — service role ─
alter table public.activity_log enable row level security;

create policy "activity_log_select_authenticated"
  on public.activity_log for select
  to authenticated
  using (true);

revoke all on table public.activity_log from anon;
grant select on table public.activity_log to authenticated;
