-- Скаутингові звіти для Операційної хронології (фото + нотатки з поля).

create table if not exists public.scouting_reports (
  id         uuid primary key default gen_random_uuid(),
  field_id   uuid not null
    references public.farm_fields (id) on delete cascade,
  date       timestamptz not null default now(),
  image_url  text,
  notes      text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.scouting_reports is
  'Польовий скаутинг: фото та нотатки агронома для хронології операцій';
comment on column public.scouting_reports.field_id is
  'Поле (farm_fields.id)';
comment on column public.scouting_reports.date is
  'Дата обходу / фіксації на полі';
comment on column public.scouting_reports.image_url is
  'URL фото (Supabase Storage або зовнішнє посилання)';
comment on column public.scouting_reports.notes is
  'Текстовий звіт агронома';

create index if not exists scouting_reports_field_date_idx
  on public.scouting_reports (field_id, date desc);

create index if not exists scouting_reports_date_idx
  on public.scouting_reports (date desc);

alter table public.scouting_reports enable row level security;

drop policy if exists "scouting_reports_authenticated_all" on public.scouting_reports;
create policy "scouting_reports_authenticated_all"
  on public.scouting_reports for all to authenticated
  using (true) with check (true);

revoke all on table public.scouting_reports from anon;
grant select, insert, update, delete on public.scouting_reports to authenticated;
