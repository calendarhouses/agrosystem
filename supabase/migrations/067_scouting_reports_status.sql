-- Рівень ризику ШІ-діагностики посіву (LEVADIUS Vision).

alter table public.scouting_reports
  add column if not exists status text;

comment on column public.scouting_reports.status is
  'Ризик / стан: ok | warning | critical (або вільний текст)';

create index if not exists scouting_reports_status_idx
  on public.scouting_reports (status)
  where status is not null;
