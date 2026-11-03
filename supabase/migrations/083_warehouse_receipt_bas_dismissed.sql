-- Прибрати накладну з блоку «Накладні → 1С» без відкату складу / BAS.
-- dismissed = сховано з черги бухгалтера (історія в БД лишається).

alter table public.warehouse_receipts
  drop constraint if exists warehouse_receipts_bas_handoff_status_check;

alter table public.warehouse_receipts
  add constraint warehouse_receipts_bas_handoff_status_check
  check (
    bas_handoff_status in (
      'local_saved',
      'awaiting_bas_mapping',
      'bas_draft_posted',
      'bas_draft_dry_run',
      'bas_draft_failed',
      'dismissed'
    )
  );

comment on column public.warehouse_receipts.bas_handoff_status is
  'local_saved | awaiting_bas_mapping | bas_draft_posted | bas_draft_dry_run | bas_draft_failed | dismissed — dismissed ховає з «Накладні → 1С»';
