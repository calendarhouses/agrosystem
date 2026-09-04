-- Попередник у паспорті поля (пошук LEVADIUS searchFieldsCatalog)

alter table public.farm_fields
  add column if not exists previous_crop text;

comment on column public.farm_fields.previous_crop is
  'Культура-попередник (паспорт); для фільтрів «поля після сої» тощо';

create index if not exists farm_fields_previous_crop_idx
  on public.farm_fields (previous_crop)
  where previous_crop is not null and btrim(previous_crop) <> '';
