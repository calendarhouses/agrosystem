# Go-live: чернетки BAS (прихід ТМЦ)

## Ідеальний сценарій

1. Агроном фотографує накладну в **LEVADIUS**.
2. OCR → превʼю з підсвіткою сумнівних рядків (од. вим., артикул, слабкий збіг, сума).
3. Людина перевіряє / править → **Оприбуткувати + чернетка BAS**.
4. Склад LEVADA оновлюється; одночасно йде **1** непроведена
   `Document_ПоступлениеТоваровУслуг` з `Товары[]` (усі змаплені рядки).
5. Бухгалтер у BAS: **Надходження товарів і послуг → непроведені**, проводить сам.

У LEVADA при цьому може бути N локальних рухів (по рядку) — це склад.
У BAS має бути **один** документ на накладну.

## Два контури (не плутати)

| UI / статус | Що це |
|-------------|--------|
| **Чернетка в BAS** + `bas_draft_ref_key` | Реальний OData POST, `Posted: false` |
| **Excel · не BAS** / `sent_to_1c` / кнопка «Передати» | Лише позначка черги + Excel-файл |

## Env

```env
BAS_DRAFT_POST_ENABLED=true
BAS_DRAFT_PIPELINES_ENABLED=inventory_inbound_receipt
BAS_ORGANIZATION_KEY=...
BAS_DEFAULT_WAREHOUSE_KEY=...
BAS_ODATA_URL=...
BAS_USER=...
BAS_PASS=...
```

Опційно: `bas_counterparties` / `BAS_COUNTERPARTY_MAP` — контрагент у шапці.
Без мапінгу чернетка все одно летить; у коментарі назва/ЄДРПОУ.

## LEVADIUS tools

- `previewInvoiceReceipt` → превʼю
- `executeWarehouseReceipt` → склад + авто-чернетка
- `listWarehouseReceiptBasStatus` → статуси накладних
- `sendWarehouseReceiptBasDraft` (confirmed) → повторити/дослати чернетку
- `verifyWarehouseReceiptBasDraft` → GET по Ref_Key без веб-логіну 1С

## Retry в UI

Хаб бухгалтера → «Чернетки BAS · надходження» → **Повторити BAS**.

## Пілот

1. Накладна 5–40+ позицій з відомим постачальником і змапленою номенклатурою.
2. Оприбуткувати через LEVADIUS.
3. У BAS: один непроведений документ з усіма змапленими рядками.
4. Fail → `bas_draft_error` + retry / LEVADIUS `sendWarehouseReceiptBasDraft`.
