-- Плановий бюджет витрат на 1 га (₴) для Plan/Fact контролю
alter table public.farm_fields
  add column if not exists planned_budget_per_ha numeric(14, 2);

comment on column public.farm_fields.planned_budget_per_ha is
  'Плановий бюджет витрат на 1 гектар у гривнях (null = не задано)';
