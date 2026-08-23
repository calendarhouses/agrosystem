/** Не показувати Realtime-тост «Оновлено дані полів» після нашого ж PATCH паспорта */
let suppressFarmFieldsToastUntil = 0;

export function suppressLocalFarmFieldsRealtimeToast(ms = 2500) {
  suppressFarmFieldsToastUntil = Date.now() + ms;
}

export function isFarmFieldsRealtimeToastSuppressed(): boolean {
  return Date.now() < suppressFarmFieldsToastUntil;
}

/** Не показувати Realtime-тост «Оновлено складські рухи» після локального списання */
let suppressInventoryMovesToastUntil = 0;

export function suppressLocalInventoryMovesRealtimeToast(ms = 2500) {
  suppressInventoryMovesToastUntil = Date.now() + ms;
}

export function isInventoryMovesRealtimeToastSuppressed(): boolean {
  return Date.now() < suppressInventoryMovesToastUntil;
}
