-- Звʼязок паспорта AgroSystem з геозоною Wialon (щоб не дублювати поле)
alter table public.farm_fields
  add column if not exists wialon_zone_id text;

create unique index if not exists farm_fields_wialon_zone_id_uidx
  on public.farm_fields (wialon_zone_id)
  where wialon_zone_id is not null;
