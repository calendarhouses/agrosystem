"use server";

import {
  resolveDieselPriceUah,
  type DieselPriceResult,
} from "@/lib/fuel-price";
import {
  sumFieldFuelConsumedForDate,
  todayKyivDateString,
} from "@/lib/wialon-field-fuel-sync";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Актуальна ціна дизеля ₴/л (fuel_storages → inventory → fallback). */
export async function getDieselPriceUah(): Promise<
  ActionResult<DieselPriceResult>
> {
  try {
    const data = await resolveDieselPriceUah();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити ціну дизеля",
    };
  }
}

/** Сума спаленого на полях сьогодні (Europe/Kyiv) з wialon_field_fuel_logs. */
export async function getTodayFieldFuelConsumed(): Promise<
  ActionResult<{ liters: number; date: string }>
> {
  try {
    const date = todayKyivDateString();
    const liters = await sumFieldFuelConsumedForDate(date);
    return { ok: true, data: { liters, date } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити витрату на полях",
    };
  }
}
