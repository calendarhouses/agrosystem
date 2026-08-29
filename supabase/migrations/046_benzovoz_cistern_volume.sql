-- Бензовоз: номінал цистерни 7000 л (не бак тягача ~200 л).
update public.equipment
set fuel_tank_volume = 7000
where name ~* 'бензовоз';
