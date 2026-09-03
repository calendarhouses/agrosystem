-- Категорія техніки для бухгалтерії: Поля (трактори тощо) або База (крани, двір…).

alter table public.equipment
  add column if not exists work_scope text;

alter table public.equipment
  drop constraint if exists equipment_work_scope_check;

alter table public.equipment
  add constraint equipment_work_scope_check
  check (work_scope is null or work_scope in ('field', 'base'));

comment on column public.equipment.work_scope is
  'field — польова техніка; base — техніка бази/двору; NULL — ще не класифіковано (типово з BAS)';

create index if not exists equipment_work_scope_idx
  on public.equipment (work_scope)
  where work_scope is not null;
