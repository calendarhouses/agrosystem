# Go-live: чернетки BAS (прихід ТМЦ)

## Що змінилось

- 1 накладна LEVADIUS → 1 `warehouse_receipts` + N локальних рухів → **1** непроведена `Document_ПоступлениеТоваровУслуг` з `Товары[]`.
- Статуси: `local_saved` / `awaiting_bas_mapping` / `bas_draft_posted` / `bas_draft_dry_run` / `bas_draft_failed`.
- Excel `sent_to_1c` ≠ чернетка в BAS (`bas_draft_ref_key`).

## Перед увімкненням (бухгалтер)

1. Застосувати міграцію `079_warehouse_receipt_bas_and_codes.sql`.
2. Синк номенклатури (щоб зʼявився `code` / артикул).
3. (Опційно) `bas_counterparties` / `BAS_COUNTERPARTY_MAP` — щоб контрагент
   підставлявся сам. Без мапінгу чернетка все одно летить; у коментарі назва/ЄДРПОУ,
   бухгалтер обере контрагента в BAS.
4. Підтвердити env:
   - `BAS_ORGANIZATION_KEY`
   - `BAS_DEFAULT_WAREHOUSE_KEY`
   - `BAS_ODATA_URL`, `BAS_USER`, `BAS_PASS`
5. У хабі бухгалтера: блок «Чернетки BAS · надходження» + кнопка «Повторити BAS».

## Увімкнення (лише прихід з накладної)

```env
BAS_DRAFT_POST_ENABLED=true
BAS_DRAFT_PIPELINES_ENABLED=inventory_inbound_receipt
```

Інші контури (паливо, ЛЗК, ПЛ, продаж) **не** поститься, поки їх id не додані в `BAS_DRAFT_PIPELINES_ENABLED`.

## Пілот

1. Накладна 5–10 позицій з відомим постачальником і змапленою номенклатурою.
2. Оприбуткувати через LEVADIUS.
3. У BAS: **Надходження товарів і послуг** → непроведені → один документ з усіма рядками.
4. Якщо fail — `warehouse_receipts.bas_draft_error` + `retryWarehouseReceiptBasDraftAction(receiptId)`.

## Повторити відправку

Server action: `retryWarehouseReceiptBasDraftAction(receiptId)` у `app/admin/inventory/actions.ts`.
