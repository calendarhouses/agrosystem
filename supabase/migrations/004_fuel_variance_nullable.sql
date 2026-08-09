-- null = техніка без ДУТ (ручний облік); число = результат звірки з датчиком
alter table public.fuel_transactions
  alter column wialon_variance drop not null;

alter table public.fuel_transactions
  alter column wialon_variance set default null;

comment on column public.fuel_transactions.wialon_variance is
  'NULL = немає датчика палива; число = розбіжність заявлено−датчик (л)';
