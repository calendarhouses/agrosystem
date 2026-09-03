-- Локальна техніка (не з BAS / Wialon): можна додати вручну для списання палива.

alter table public.equipment
  alter column bas_ref_key drop not null;

alter table public.equipment
  add column if not exists source text not null default 'bas';

alter table public.equipment
  drop constraint if exists equipment_source_check;

alter table public.equipment
  add constraint equipment_source_check
  check (source in ('bas', 'local', 'wialon'));

comment on column public.equipment.source is
  'bas — з BAS AGRO; local — додано вручну в AgroSystem; wialon — лише GPS-мапінг';

comment on column public.equipment.bas_ref_key is
  'Ключ ОС у BAS; NULL для локальної техніки до мапінгу бухгалтером';

-- Локальні рядки без BAS-ключа
update public.equipment
set source = 'local'
where bas_ref_key is null
  and coalesce(source, 'bas') = 'bas';
