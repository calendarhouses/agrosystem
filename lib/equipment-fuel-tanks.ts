/**
 * Номінальні обʼєми паливних баків (л) за моделями з публічних специфікацій.
 * Використовується для % залишку та валідації телеметрії — не для списань у BAS.
 */

export type FuelTankSpec = {
  liters: number;
  /** Джерело / примітка */
  note: string;
};

/**
 * Порядок важливий: більш специфічні патерни першими.
 */
const TANK_SPECS: Array<{ re: RegExp; spec: FuelTankSpec }> = [
  // Case IH Magnum — dual / PS ≈ 678–765 л; CVT ≈ 617 л. Беремо типові PS dual.
  {
    re: /magnum\s*340/i,
    spec: {
      liters: 765,
      note: "Case IH Magnum 340 Powershift dual tanks ~765 L",
    },
  },
  {
    re: /magnum\s*380/i,
    spec: {
      liters: 765,
      note: "Case IH Magnum 380 dual tanks (Wialon Бак лівий+правий) ~765 L",
    },
  },
  {
    re: /magnum\s*250/i,
    spec: {
      liters: 678,
      note: "Case IH Magnum 250 ~179 gal",
    },
  },
  // New Holland combines
  {
    re: /cr\s*9\.?80|cr9\.?80/i,
    spec: {
      liters: 1000,
      note: "New Holland CR9.80 ~1000 L",
    },
  },
  {
    re: /new\s*holland\s*9080|nh\s*9080|cx\s*9080/i,
    spec: {
      liters: 950,
      note: "New Holland CX/CR 9080 ~950 L",
    },
  },
  {
    re: /new\s*holland|комбайн.*holland/i,
    spec: {
      liters: 950,
      note: "New Holland combine default ~950 L",
    },
  },
  // MTZ / Belarus
  {
    re: /мтз[\s-]*892|белорус[ьъ]?\s*892|беларус\s*892/i,
    spec: { liters: 130, note: "МТЗ-892 ~130 L" },
  },
  {
    re: /мтз[\s-]*821|белорус[ьъ]?\s*821|беларус\s*821/i,
    spec: { liters: 130, note: "МТЗ-821 ~130 L" },
  },
  {
    re: /мтз[\s-]*1221|беларус\s*-?\s*1221|белорус[ьъ]?\s*1221/i,
    spec: { liters: 250, note: "МТЗ-1221 ~250 L" },
  },
  {
    re: /мтз[\s-]*80\b|белорус[ьъ]?\s*80\b/i,
    spec: { liters: 130, note: "МТЗ-80 ~130 L" },
  },
  // KhTZ
  {
    re: /т[\s-]?150/i,
    spec: { liters: 315, note: "ХТЗ Т-150 ~315 L" },
  },
  {
    re: /т[\s-]?70/i,
    spec: { liters: 230, note: "Т-70 ~230 L" },
  },
  {
    re: /тдз\s*5244/i,
    spec: { liters: 140, note: "ТДЗ 5244 ~140 L" },
  },
  // Sprayer — fuel tank (not chemical tank 3000)
  {
    re: /kuhn\s*stronger|stronger\s*3000|оприскувач/i,
    spec: {
      liters: 300,
      note: "KUHN Stronger / оприскувач — паливний бак ~300 L",
    },
  },
  // Loader
  {
    re: /навантажувач|telehandler|jcb|manitou/i,
    spec: { liters: 140, note: "Телескопічний навантажувач ~140 L" },
  },
  // Fuel truck — цистерна (~7000 L), не бак тягача
  {
    re: /бензовоз/i,
    spec: {
      liters: 7000,
      note: "Бензовоз — цистерна ~7000 L (не бак тягача)",
    },
  },
];

/** Бензовоз / роздача палива — падіння рівня цистерни не є «зливом». */
export function isFuelDeliveryUnit(
  ...names: Array<string | null | undefined>
): boolean {
  const haystack = names.filter(Boolean).join(" ").toLowerCase();
  return /бензовоз|fuel\s*truck|cistern|цистерн/i.test(haystack);
}

/** Пошук номіналу бака за назвою техніки (BAS або Wialon). */
export function resolveFuelTankVolumeLiters(
  ...names: Array<string | null | undefined>
): number | null {
  const haystack = names.filter(Boolean).join(" ").trim();
  if (!haystack) return null;
  for (const row of TANK_SPECS) {
    if (row.re.test(haystack)) return row.spec.liters;
  }
  return null;
}

export function resolveFuelTankSpec(
  ...names: Array<string | null | undefined>
): FuelTankSpec | null {
  const haystack = names.filter(Boolean).join(" ").trim();
  if (!haystack) return null;
  for (const row of TANK_SPECS) {
    if (row.re.test(haystack)) return row.spec;
  }
  return null;
}
