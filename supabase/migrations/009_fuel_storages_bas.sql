-- Приводимо склади палива до реального стану господарства та підв'язуємо до BAS.
--
-- У BAS усі 4 цистерни обліковуються одним складом "Паливо в цестернах" (група ППМ),
-- ref 8369ebd3-d7a4-11ed-af80-d85ed32cff61. Бензовоза в довіднику складів немає —
-- ми додаємо його зі свого боку і мапимо на той самий склад, щоб чернетки
-- переміщень палива списувалися з правильного складу 1С.

update public.fuel_storages
set
  name = 'Паливо в цистернах',
  type = 'stationary',
  capacity = 51000,
  bas_ref_key = '8369ebd3-d7a4-11ed-af80-d85ed32cff61'
where type = 'stationary';

update public.fuel_storages
set
  name = 'Бензовоз',
  type = 'mobile',
  capacity = 7000,
  bas_ref_key = '8369ebd3-d7a4-11ed-af80-d85ed32cff61'
where type = 'mobile';

-- Якщо якогось зі складів ще немає — створюємо.
insert into public.fuel_storages (name, type, capacity, current_volume, price_per_liter, bas_ref_key)
select 'Паливо в цистернах', 'stationary', 51000, 0, 52, '8369ebd3-d7a4-11ed-af80-d85ed32cff61'
where not exists (select 1 from public.fuel_storages where type = 'stationary');

insert into public.fuel_storages (name, type, capacity, current_volume, price_per_liter, bas_ref_key)
select 'Бензовоз', 'mobile', 7000, 0, 52, '8369ebd3-d7a4-11ed-af80-d85ed32cff61'
where not exists (select 1 from public.fuel_storages where type = 'mobile');
