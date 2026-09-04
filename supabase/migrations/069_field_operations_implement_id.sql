-- Причіпне знаряддя наряду → довідник implements

alter table public.field_operations
  add column if not exists implement_id uuid
    references public.implements (id) on delete set null;

create index if not exists field_operations_implement_id_idx
  on public.field_operations (implement_id)
  where implement_id is not null;

comment on column public.field_operations.implement_id is
  'Довідник implements (причіпне); текст implement лишається для відображення';
