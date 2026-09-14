-- Персональна історія чату LEVADIUS (окремо на кожного auth-користувача).
-- Запис/читання лише через service role у /api/agent/chat.

create table if not exists public.ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.ai_chat_threads is
  'Історія діалогу LEVADIUS: один активний тред на user_id, архіви після «Очистити»';

comment on column public.ai_chat_threads.messages is
  'Масив UIMessage (AI SDK): id, role, parts';

-- Один активний діалог на користувача
create unique index if not exists ai_chat_threads_user_active_uidx
  on public.ai_chat_threads (user_id)
  where archived_at is null;

create index if not exists ai_chat_threads_user_updated_idx
  on public.ai_chat_threads (user_id, updated_at desc);

alter table public.ai_chat_threads enable row level security;
