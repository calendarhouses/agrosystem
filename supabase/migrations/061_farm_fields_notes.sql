-- Примітки до паспорта поля (для LEVADIUS updateFieldDetails та UI)
alter table public.farm_fields
  add column if not exists notes text;

comment on column public.farm_fields.notes is
  'Вільні примітки до паспорта поля (агрономія / агент).';
