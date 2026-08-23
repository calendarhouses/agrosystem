-- Техніка (трактори, комбайни, оприскувачі, навантажувачі)
create table if not exists public.equipment (
  id           uuid primary key default gen_random_uuid(),
  bas_ref_key  uuid unique not null,
  name         text not null,
  full_name    text,
  code         text,
  type         text not null default 'other',
  wialon_id    integer unique,
  wialon_name  text,
  has_tracker  boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.equipment is 'Основні засоби — техніка (Catalog_ОсновныеСредства, папка Транспортні засоби)';
comment on column public.equipment.type is 'tractor | combine | sprayer | loader | other';

-- Обладнання (сівалки, плуги, борони, жниварки, культиватори)
create table if not exists public.implements (
  id           uuid primary key default gen_random_uuid(),
  bas_ref_key  uuid unique not null,
  name         text not null,
  full_name    text,
  code         text,
  type         text not null default 'other',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.implements is 'Основні засоби — обладнання (Catalog_ОсновныеСредства, папка Машини та обладнання)';
comment on column public.implements.type is 'seeder | plow | harrow | header | cultivator | spreader | sprayer | compactor | other';

-- RLS
alter table public.equipment enable row level security;
alter table public.implements enable row level security;

create policy "equipment_read" on public.equipment for select using (true);
create policy "equipment_write" on public.equipment for all using (true);

create policy "implements_read" on public.implements for select using (true);
create policy "implements_write" on public.implements for all using (true);
