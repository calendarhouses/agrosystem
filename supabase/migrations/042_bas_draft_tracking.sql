-- Трекінг чернеток BAS (Posted: false), окремо від Excel-контуру бухгалтера.
-- bas_draft_ref_key = Ref_Key документа в BAS після успішного POST (або null у dry-run).
-- Dry-run НЕ пише ref у БД — лише жива відправка.

-- ── inventory_local_moves ──────────────────────────────────────────
alter table public.inventory_local_moves
  add column if not exists bas_draft_ref_key uuid,
  add column if not exists bas_draft_entity text,
  add column if not exists bas_draft_sent_at timestamptz,
  add column if not exists bas_draft_error text;

comment on column public.inventory_local_moves.bas_draft_ref_key is
  'Ref_Key непроведеної чернетки в BAS після POST; null = ще не відправлено';
comment on column public.inventory_local_moves.bas_draft_entity is
  'OData EntitySet, напр. Document_ИНАГРО_ЛимитноЗаборнаяКарта';
comment on column public.inventory_local_moves.bas_draft_sent_at is
  'Час успішного POST чернетки в BAS';
comment on column public.inventory_local_moves.bas_draft_error is
  'Остання помилка POST чернетки (якщо була)';

create index if not exists inventory_local_moves_bas_draft_ref_idx
  on public.inventory_local_moves (bas_draft_ref_key)
  where bas_draft_ref_key is not null;

-- ── fuel_transactions ──────────────────────────────────────────────
alter table public.fuel_transactions
  add column if not exists bas_draft_ref_key uuid,
  add column if not exists bas_draft_entity text,
  add column if not exists bas_draft_sent_at timestamptz,
  add column if not exists bas_draft_error text;

comment on column public.fuel_transactions.bas_draft_ref_key is
  'Ref_Key непроведеної чернетки палива в BAS';
comment on column public.fuel_transactions.sync_status is
  'pending_1c = у черзі бухгалтера/BAS; synced = позначено переданим (Excel) або узгоджено; error = збій. Наявність чернетки в BAS дивись bas_draft_ref_key.';

create index if not exists fuel_transactions_bas_draft_ref_idx
  on public.fuel_transactions (bas_draft_ref_key)
  where bas_draft_ref_key is not null;

-- ── field_operations ───────────────────────────────────────────────
alter table public.field_operations
  add column if not exists bas_draft_ref_key uuid,
  add column if not exists bas_draft_entity text,
  add column if not exists bas_draft_sent_at timestamptz,
  add column if not exists bas_draft_error text;

comment on column public.field_operations.bas_draft_ref_key is
  'Ref_Key чернетки шляхового листа в BAS після POST';
comment on column public.field_operations.export_status is
  'none | pending | synced — черга експорту/людини; чернетка BAS = bas_draft_ref_key';

create index if not exists field_operations_bas_draft_ref_idx
  on public.field_operations (bas_draft_ref_key)
  where bas_draft_ref_key is not null;
