-- Обʼєм бака техніки (л) для коректного % палива на моніторингу.
-- NULL = обʼєм не заданий → UI показує лише літри / «—», без %.

alter table public.equipment
  add column if not exists fuel_tank_volume numeric(10, 2)
    check (fuel_tank_volume is null or fuel_tank_volume > 0);

comment on column public.equipment.fuel_tank_volume is
  'Номінальний обʼєм паливного бака, л. Без значення відсоток палива не рахуємо.';
