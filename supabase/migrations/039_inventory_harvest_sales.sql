-- Продаж врожаю (локально) + вкладення накладних (склад / паливо).
-- BAS лишається read-only.

-- ── Sale type + buyer / price ──────────────────────────────────────

alter table public.inventory_local_moves
  drop constraint if exists inventory_local_moves_type_check;

alter table public.inventory_local_moves
  add constraint inventory_local_moves_type_check
  check (type in ('outbound', 'inbound', 'sale'));

comment on column public.inventory_local_moves.type is
  'outbound — списання; inbound — прихід/випуск; sale — продаж врожаю (локально, без POST у BAS)';

alter table public.inventory_local_moves
  add column if not exists buyer_name text;

alter table public.inventory_local_moves
  add column if not exists unit_price_uah numeric(14, 4);

comment on column public.inventory_local_moves.buyer_name is
  'Покупець (вільний текст; підказки з BAS Catalog_Контрагенты)';

comment on column public.inventory_local_moves.unit_price_uah is
  'Ціна ₴ за одиницю для type=sale; сума = qty × unit_price_uah';

-- ── Attachments (накладні) ─────────────────────────────────────────

create table if not exists public.operation_attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('inventory_move', 'fuel_transaction')),
  entity_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create index if not exists operation_attachments_entity_idx
  on public.operation_attachments (entity_type, entity_id);

comment on table public.operation_attachments is
  'Скани/фото накладних до локальних операцій складу та палива';

alter table public.operation_attachments enable row level security;

-- Доступ лише через service-role API (як інші мутації).
create policy "operation_attachments_service_select"
  on public.operation_attachments for select
  to authenticated
  using (true);

-- Storage bucket (private). Якщо insert падає в SQL Editor без storage schema —
-- створи bucket operation-docs вручну в Dashboard → Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operation-docs',
  'operation-docs',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
