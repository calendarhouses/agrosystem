/**
 * Агрономічний словник — правила операцій по культурах для модуля Агро-Радар.
 * Не заглушки: місяці вікна + ідеальні умови для статусів у calendar engine.
 */

/** Тип операції в календарі / черзі ресурсів */
export type CropOperationKind = "ТМЦ" | "Робота" | "Збір";

/** Ідеальні умови вікна для операції (порівнюються з погодою в engine) */
export type IdealConditions = {
  /** Мін. температура ґрунту, °C */
  minSoilTemp?: number;
  /** Макс. температура повітря, °C */
  maxAirTemp?: number;
  /** Макс. швидкість вітру, м/с */
  maxWind?: number;
  /** true = потрібна суха погода (без дощу) */
  requiresNoRain?: boolean;
};

/**
 * Одна агрооперація в словнику.
 * recommendedMonths — календарні місяці 1–12.
 */
export type CropOperation = {
  id: string;
  name: string;
  recommendedMonths: readonly number[];
  type: CropOperationKind;
  idealConditions: IdealConditions;
};

/** Ключ культури в словнику (стабільний англ. id) */
export type CropDictionaryKey = "corn" | "sunflower" | "winter_wheat";

export type CropDictionaryEntry = {
  key: CropDictionaryKey;
  /** Відображувана назва українською */
  labelUk: string;
  /** Варіанти назв з паспортів полів (lowercase match) */
  aliases: readonly string[];
  operations: readonly CropOperation[];
};

export const CROP_OPERATIONS_DICTIONARY: Readonly<
  Record<CropDictionaryKey, CropDictionaryEntry>
> = {
  corn: {
    key: "corn",
    labelUk: "Кукурудза",
    aliases: ["кукурудза", "кукурудзи", "corn", "маїс"],
    operations: [
      {
        id: "corn-sowing",
        name: "Посів",
        recommendedMonths: [4, 5],
        type: "Робота",
        idealConditions: {
          minSoilTemp: 10,
          requiresNoRain: true,
        },
      },
      {
        id: "corn-herbicide-3-5",
        name: "Внесення гербіцидів (3-5 листків)",
        recommendedMonths: [5, 6],
        type: "ТМЦ",
        idealConditions: {
          maxWind: 4,
          maxAirTemp: 25,
          requiresNoRain: true,
        },
      },
      {
        id: "corn-harvest",
        name: "Збір врожаю",
        recommendedMonths: [9, 10, 11],
        type: "Збір",
        idealConditions: {
          requiresNoRain: true,
        },
      },
    ],
  },

  sunflower: {
    key: "sunflower",
    labelUk: "Соняшник",
    aliases: ["соняшник", "соняшнику", "sunflower"],
    operations: [
      {
        id: "sunflower-sowing",
        name: "Посів",
        recommendedMonths: [4, 5],
        type: "Робота",
        idealConditions: {
          minSoilTemp: 8,
        },
      },
      {
        id: "sunflower-desiccation",
        name: "Десикація",
        recommendedMonths: [8, 9],
        type: "ТМЦ",
        idealConditions: {
          maxWind: 3,
          maxAirTemp: 25,
        },
      },
      {
        id: "sunflower-harvest",
        name: "Збір",
        recommendedMonths: [9, 10],
        type: "Збір",
        idealConditions: {},
      },
    ],
  },

  winter_wheat: {
    key: "winter_wheat",
    labelUk: "Пшениця озима",
    aliases: [
      "пшениця озима",
      "озима пшениця",
      "пшениця",
      "winter wheat",
      "wheat",
    ],
    operations: [
      {
        id: "winter-wheat-sowing",
        name: "Посів",
        recommendedMonths: [9, 10],
        type: "Робота",
        idealConditions: {
          requiresNoRain: false,
        },
      },
      {
        id: "winter-wheat-spring-feed",
        name: "Весняне підживлення (Мерзлоталий ґрунт)",
        recommendedMonths: [2, 3],
        type: "ТМЦ",
        idealConditions: {
          maxAirTemp: 5,
        },
      },
      {
        id: "winter-wheat-harvest",
        name: "Збір",
        recommendedMonths: [7, 8],
        type: "Збір",
        idealConditions: {
          requiresNoRain: true,
        },
      },
    ],
  },
} as const;

/** Усі записи словника (для ітерації) */
export const CROP_DICTIONARY_ENTRIES: readonly CropDictionaryEntry[] =
  Object.values(CROP_OPERATIONS_DICTIONARY);

/**
 * Знайти культуру за рядком з паспорта поля.
 * Повертає null, якщо культура ще не в словнику.
 */
export function resolveCropDictionaryEntry(
  cropLabel: string | null | undefined
): CropDictionaryEntry | null {
  const raw = (cropLabel ?? "").trim().toLowerCase();
  if (!raw || raw === "—" || raw === "-") return null;

  for (const entry of CROP_DICTIONARY_ENTRIES) {
    if (entry.aliases.some((alias) => raw.includes(alias) || alias.includes(raw))) {
      return entry;
    }
    if (raw.includes(entry.labelUk.toLowerCase())) {
      return entry;
    }
  }

  return null;
}

/** Операції культури, рекомендовані для місяця (1–12) */
export function operationsForMonth(
  entry: CropDictionaryEntry,
  month: number
): CropOperation[] {
  if (month < 1 || month > 12) return [];
  return entry.operations.filter((op) => op.recommendedMonths.includes(month));
}

/** Знайти операцію словника за id */
export function findCropOperationById(
  operationId: string
): CropOperation | null {
  for (const entry of CROP_DICTIONARY_ENTRIES) {
    const found = entry.operations.find((op) => op.id === operationId);
    if (found) return found;
  }
  return null;
}

function normalizeOpName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Пошук операції словника за назвою наряду / work_type */
export function findCropOperationByWorkType(
  workType: string
): CropOperation | null {
  const target = normalizeOpName(workType);
  if (!target) return null;

  for (const entry of CROP_DICTIONARY_ENTRIES) {
    for (const op of entry.operations) {
      const name = normalizeOpName(op.name);
      const mapped = normalizeOpName(mapDictionaryOpToWorkType(op.name));
      if (
        name === target ||
        mapped === target ||
        name.includes(target) ||
        target.includes(name) ||
        mapped.includes(target) ||
        target.includes(mapped)
      ) {
        return op;
      }
    }
  }
  return null;
}

/**
 * Відображувана назва операції словника → тип наряду в системі.
 */
export function mapDictionaryOpToWorkType(operationName: string): string {
  const n = operationName.trim().toLowerCase();
  if (n.includes("посів")) return "Посів";
  if (
    n.includes("гербіцид") ||
    n.includes("десик") ||
    n.includes("ззр")
  ) {
    return "Внесення ЗЗР";
  }
  if (n.includes("піджив") || n.includes("добрив")) return "Внесення добрив";
  if (n.includes("збір") || n.includes("збиран")) return "Збирання";
  return operationName.trim() || "Посів";
}

