-- Оновити стартові оцінки, якщо ще майже немає реальних замірів.
-- Тиждень ≈ 12с; місяць/сезон — кілька чанків бекфілу, значно довше.
update public.fuel_kpi_load_stats
set
  ema_ms = case period
    when 'today' then 6000
    when 'yesterday' then 7000
    when 'week' then 12000
    when 'month' then 40000
    when 'season' then 75000
    else ema_ms
  end,
  updated_at = now()
where samples <= 3;
