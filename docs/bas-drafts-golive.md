# Go-live: чернетки BAS (усі контури)

## Відповідь коротко

| Операція в LEVADA | Документ у BAS | Pipeline id | Авто після запису? |
|-------------------|----------------|-------------|-------------------|
| Накладна ТМЦ (LEVADIUS / запчастини, насіння, ЗЗР, добрива) | `ПоступлениеТоваровУслуг` (1 накл. = 1 doc) | `inventory_inbound_receipt` | Так |
| Ручний прихід без накладної | те саме (1 рядок) | `inventory_inbound_receipt` | Так |
| Продаж урожаю / ТМЦ | `РеализацияТоваровУслуг` | `inventory_sale` | Так |
| Списання ТМЦ у поле | `ИНАГРО_ЛимитноЗаборнаяКарта` | `inventory_outbound_lzk` | Так (батч) |
| Надходження палива (ДП) | `ПоступлениеТоваровУслуг` | `fuel_inbound` | Так |
| Переміщення палива | `ИНАГРО_СливТоплива` | `fuel_transfer` | Так |
| Заправка техніки | `ИНАГРО_ПередачаТоплива` | `fuel_outbound_refuel` | Так |
| Закритий наряд | `ИНАГРО_ПутевойЛист…` | `field_operation_waybill` | Так |
| Excel «Передати» | — | out_of_scope | Ні (не BAS) |

**Ні** — не «будь-який» скан без маршруту. Довільний PDF/рахунок іде в `bas_sync_queue` (черга людині), не в live OData, поки його не оприбуткували як накладну/паливо/акт.

Усі документи — **чернетки** (`Posted: false`). Проводить бухгалтер.

## Увімкнути ВСЕ live

```env
BAS_DRAFT_POST_ENABLED=true
BAS_DRAFT_PIPELINES_ENABLED=inventory_inbound_receipt,inventory_sale,inventory_outbound_lzk,fuel_inbound,fuel_transfer,fuel_outbound_refuel,field_operation_waybill
```

Або коротко: `BAS_DRAFT_PIPELINES_ENABLED=*`

Додатково:
- `BAS_ORGANIZATION_KEY`, `BAS_DEFAULT_WAREHOUSE_KEY`
- `BAS_DIESEL_NOMENCLATURE_KEY` (паливо)
- `bas_ref_key` на складах палива / техніці / номенклатурі

Контрагент у чернетці: live-пошук у `Catalog_Контрагенты` (ЄДРПОУ / назва).
Catalog_* не створюємо.

**Нові товари** (яких ще немає в довіднику): усе одно в чернетці.
Номенклатура = заглушка `BAS_UNMAPPED_NOMENCLATURE_KEY` (за замовч. картка
«Товари»), справжня назва — у полі **НаименованиеПоставщика**. Бухгалтер у BAS
бачить усі позиції й заводить/підміняє номенклатуру як йому зручно.

Склад у Поступленні: поле **`Склад`** + Type Catalog_Склады.

Опційно в Vercel:
```env
BAS_UNMAPPED_NOMENCLATURE_KEY=a1f7dba4-426c-11f1-8c9e-9c6b0055d53a
```

## Ідеальний сценарій накладної

Фото → LEVADIUS превʼю → оприбуткувати → склад + 1 Поступление → бухгалтер проводить.

LEVADIUS: `getBasDraftPipelinesStatus`, `list/send/verifyWarehouseReceiptBasDraft`.

## Де шукати в 1С

Завжди **непроведені / чернетки** відповідного журналу, не проведені й не Excel.
