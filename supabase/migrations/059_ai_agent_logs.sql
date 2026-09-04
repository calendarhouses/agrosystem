-- Аудит запитів LEVADA AI.
-- Роут працює через service role; клієнтський доступ до журналу не відкриваємо.

create table if not exists public.ai_agent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  prompt text not null default 'Запит без тексту',
  input_request jsonb not null,
  output_response text,
  tool_calls jsonb not null default '[]'::jsonb,
  model text not null,
  finish_reason text,
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- Якщо таблицю вже створили вручну — доводимо її до контракту API-роуту.
alter table public.ai_agent_logs
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists prompt text not null default 'Запит без тексту',
  add column if not exists input_request jsonb not null default '{}'::jsonb,
  add column if not exists output_response text,
  add column if not exists tool_calls jsonb not null default '[]'::jsonb,
  add column if not exists model text not null default 'gemini-3.8-flash',
  add column if not exists finish_reason text,
  add column if not exists status text not null default 'completed',
  add column if not exists error text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists ai_agent_logs_user_created_idx
  on public.ai_agent_logs (user_id, created_at desc);

create index if not exists ai_agent_logs_status_created_idx
  on public.ai_agent_logs (status, created_at desc);

alter table public.ai_agent_logs enable row level security;

comment on table public.ai_agent_logs is
  'Аудит запитів LEVADA AI, відповідей моделі та викликів інструментів';

comment on column public.ai_agent_logs.input_request is
  'Оригінальний JSON-запит до /api/agent';

comment on column public.ai_agent_logs.prompt is
  'Текстовий промпт останнього user-повідомлення';

comment on column public.ai_agent_logs.tool_calls is
  'Виклики інструментів AI SDK з аргументами';
