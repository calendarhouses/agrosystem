-- Категорія ділянки + мʼяка архівація (LEVADIUS createField / deleteField).

alter table public.farm_fields
  add column if not exists plot_category text not null default 'field';

alter table public.farm_fields
  add column if not exists is_active boolean not null default true;

comment on column public.farm_fields.plot_category is
  'Тип ділянки: field (товарне поле), garden (городи пайовиків), base (база/склад)';

comment on column public.farm_fields.is_active is
  'false = архівовано (не показувати в банку землі; історія робіт лишається)';

-- Backfill з наявного is_field
update public.farm_fields
set plot_category = 'base'
where is_field is false;

update public.farm_fields
set plot_category = 'field'
where is_field is not false
  and (plot_category is null or btrim(plot_category) = '');

alter table public.farm_fields
  drop constraint if exists farm_fields_plot_category_check;

alter table public.farm_fields
  add constraint farm_fields_plot_category_check
  check (plot_category in ('field', 'garden', 'base'));

create index if not exists farm_fields_is_active_idx
  on public.farm_fields (is_active)
  where is_active = true;

create index if not exists farm_fields_plot_category_idx
  on public.farm_fields (plot_category);
