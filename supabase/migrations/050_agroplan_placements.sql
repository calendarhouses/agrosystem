-- Позиції блоків Агроплану (drag/resize/hidden) — синхрон між пристроями.

create table if not exists public.agroplan_placements (
  id uuid primary key default gen_random_uuid(),
  block_id text not null,
  season text not null,
  start_ms bigint not null,
  duration_hours numeric(8, 2),
  hidden boolean not null default false,
  actor_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agroplan_placements_block_season_unique unique (block_id, season)
);

create index if not exists agroplan_placements_season_idx
  on public.agroplan_placements (season, updated_at desc);

comment on table public.agroplan_placements is
  'Клієнтські позиції блоків Агроплану (дата/тривалість/приховано) по сезону';

alter table public.agroplan_placements enable row level security;

drop policy if exists "agroplan_placements_authenticated_all" on public.agroplan_placements;
create policy "agroplan_placements_authenticated_all"
  on public.agroplan_placements
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on table public.agroplan_placements from anon;
grant select, insert, update, delete on table public.agroplan_placements to authenticated;
