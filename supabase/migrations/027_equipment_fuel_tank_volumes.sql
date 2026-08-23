-- Номінальні обʼєми паливних баків (л) за моделями з публічних специфікацій.
-- Не змінює BAS; лише наша колонка equipment.fuel_tank_volume.

update public.equipment
set fuel_tank_volume = 765
where name ~* 'magnum\s*340';

update public.equipment
set fuel_tank_volume = 765
where name ~* 'magnum\s*380';

update public.equipment
set fuel_tank_volume = 950
where fuel_tank_volume is null
  and name ~* 'new\s*holland|комбайн';

update public.equipment
set fuel_tank_volume = 130
where fuel_tank_volume is null
  and name ~* 'мтз[\s-]*892|белорус[ьъ]?\s*892|беларус\s*892|мтз[\s-]*821|белорус[ьъ]?\s*821|мтз[\s-]*80';

update public.equipment
set fuel_tank_volume = 250
where fuel_tank_volume is null
  and name ~* '1221';

update public.equipment
set fuel_tank_volume = 315
where fuel_tank_volume is null
  and name ~* 'т[\s-]?150';

update public.equipment
set fuel_tank_volume = 230
where fuel_tank_volume is null
  and name ~* 'т[\s-]?70';

update public.equipment
set fuel_tank_volume = 140
where fuel_tank_volume is null
  and name ~* 'тдз|навантажувач';

update public.equipment
set fuel_tank_volume = 300
where fuel_tank_volume is null
  and name ~* 'оприскувач|stronger|kuhn';
