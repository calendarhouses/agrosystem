/**
 * Середньозважена вартість палива (Weighted Average Cost).
 *
 * Inbound: змішуємо залишок і нову партію.
 * Outbound / Transfer з донора: ціна донора не змінюється при списанні.
 * Transfer на отримувача: змішуємо за ціною донора.
 */

export type WacStorage = {
  current_volume: number;
  price_per_liter: number;
  capacity?: number;
  name?: string;
};

/** Округлення ₴/л (4 знаки) і суми ₴ (2 знаки) */
export function roundPrice(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundLiters(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Нова_Ціна = ((Залишок × Ціна) + (Новий_Обʼєм × Нова_Ціна))
 *            / (Залишок + Новий_Обʼєм)
 */
export function computeWeightedAveragePrice(
  currentVolume: number,
  currentPrice: number,
  inboundVolume: number,
  inboundPrice: number
): number {
  const vol = Math.max(0, Number(currentVolume) || 0);
  const add = Math.max(0, Number(inboundVolume) || 0);
  const price = Number(currentPrice) || 0;
  const buy = Number(inboundPrice) || 0;

  if (add <= 0) return roundPrice(price);
  if (vol <= 0) return roundPrice(buy);

  const totalVol = vol + add;
  if (totalVol <= 0) return 0;

  return roundPrice((vol * price + add * buy) / totalVol);
}

/** Вартість партії / списання */
export function computeTotalCost(
  liters: number,
  pricePerLiter: number
): number {
  return roundMoney(liters * pricePerLiter);
}

/**
 * Відкат WAC після видалення inbound (або перед редагуванням).
 * Повертає нову ціну залишку після зняття партії.
 */
export function reverseWeightedAveragePrice(
  currentVolume: number,
  currentPrice: number,
  removedVolume: number,
  removedPrice: number
): number {
  const vol = Math.max(0, Number(currentVolume) || 0);
  const rem = Math.max(0, Number(removedVolume) || 0);
  const remaining = roundLiters(vol - rem);
  if (remaining <= 0.001) return 0;

  const remainingValue =
    vol * (Number(currentPrice) || 0) - rem * (Number(removedPrice) || 0);

  if (remainingValue <= 0) return 0;
  return roundPrice(remainingValue / remaining);
}
