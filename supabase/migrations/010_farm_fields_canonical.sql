-- Реєстр полів як джерело істини для BAS.
--
-- Назви з Wialon неоднозначні («Поле №1» — це 8 різних полів) і містять площу
-- прямо в тексті. Тому канонічну назву й номер поля веде агроном у нашій адмінці,
-- а синк з Wialon їх більше не перезаписує.

alter table public.farm_fields
  add column if not exists bas_ref_key uuid,
  add column if not exists canonical_name text,
  add column if not exists field_no text,
  add column if not exists tract text,
  add column if not exists is_field boolean not null default true,
  add column if not exists bas_sync_status text not null default 'none',
  add column if not exists bas_synced_at timestamptz,
  add column if not exists bas_sync_error text;

alter table public.farm_fields
  drop constraint if exists farm_fields_bas_sync_status_check;

alter table public.farm_fields
  add constraint farm_fields_bas_sync_status_check
  check (bas_sync_status in ('none', 'pending', 'synced', 'error'));

-- Двори, городи, магазин і соцсфера не є полями — у BAS їх не віддаємо.
update public.farm_fields
set is_field = false
where name ~* '^\s*(база|город\s*\d|левада|магазин|соцсфера)';

-- Попереднє заповнення канонічної назви: прибираємо кадастр і хвіст із площею.
-- Точне доведення робиться кнопкою «Заповнити автоматично» в адмінці.
update public.farm_fields
set canonical_name = nullif(
  btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(name, '\s*·?\s*\d{10}:\d{2}:\d{3}:\d{4}', ' ', 'g'),
        '\s*\d+([.,]\d+)?\s*(га|а)\y', ' ', 'gi'
      ),
      '\s+', ' ', 'g'
    )
  ),
  ''
)
where canonical_name is null;

create index if not exists farm_fields_bas_sync_status_idx
  on public.farm_fields (bas_sync_status);
