-- Беклог непідтримуваних запитів LEVADIUS (anti-hallucination + feature ideas).
-- Роут пише через service role; клієнтський доступ не відкриваємо.

create table if not exists public.ai_unhandled_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  requested_by text not null default 'Невідомий',
  prompt text not null default '',
  category text not null default 'other',
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- Якщо таблицю вже створили вручну / частково — доводимо до контракту Tool.
alter table public.ai_unhandled_requests
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists requested_by text not null default 'Невідомий',
  add column if not exists prompt text not null default '',
  add column if not exists category text not null default 'other',
  add column if not exists reason text not null default '',
  add column if not exists created_at timestamptz not null default now();

-- CHECK на category (додаємо лише якщо ще немає)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_unhandled_requests_category_check'
      and conrelid = 'public.ai_unhandled_requests'::regclass
  ) then
    alter table public.ai_unhandled_requests
      add constraint ai_unhandled_requests_category_check
      check (
        category in (
          'fields',
          'equipment',
          'fuel',
          'warehouse',
          'finance',
          'accounting',
          'other'
        )
      );
  end if;
end $$;

create index if not exists ai_unhandled_requests_created_idx
  on public.ai_unhandled_requests (created_at desc);

create index if not exists ai_unhandled_requests_category_created_idx
  on public.ai_unhandled_requests (category, created_at desc);

alter table public.ai_unhandled_requests enable row level security;

comment on table public.ai_unhandled_requests is
  'Запити до LEVADIUS без відповідного Tool — беклог прокачки';

comment on column public.ai_unhandled_requests.requested_by is
  'Імʼя користувача з userContext на момент запиту';

comment on column public.ai_unhandled_requests.prompt is
  'Оригінальний текст запиту користувача';

comment on column public.ai_unhandled_requests.reason is
  'Чому агент не зміг виконати (бракує інструменту / API тощо)';
