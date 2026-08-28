-- NDVI-аномалії для Агро-Радара (скаутинг з карти / супутника).

create table if not exists public.field_ndvi_alerts (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.farm_fields (id) on delete cascade,
  drop_percent numeric not null check (drop_percent > 0),
  zone_note text,
  detected_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.field_ndvi_alerts is
  'Активні сповіщення про падіння NDVI — тригер карток скаутингу в Агро-Радарі';
comment on column public.field_ndvi_alerts.drop_percent is
  'Відносне падіння біомаси, % (напр. 15)';
comment on column public.field_ndvi_alerts.zone_note is
  'Де саме: південна частина, край тощо';

create index if not exists field_ndvi_alerts_active_idx
  on public.field_ndvi_alerts (is_active, detected_at desc)
  where is_active = true;

create index if not exists field_ndvi_alerts_field_idx
  on public.field_ndvi_alerts (field_id);

alter table public.field_ndvi_alerts enable row level security;

drop policy if exists "field_ndvi_alerts_authenticated_all" on public.field_ndvi_alerts;
create policy "field_ndvi_alerts_authenticated_all"
  on public.field_ndvi_alerts for all to authenticated
  using (true) with check (true);

revoke all on table public.field_ndvi_alerts from anon;
grant select, insert, update, delete on table public.field_ndvi_alerts to authenticated;
