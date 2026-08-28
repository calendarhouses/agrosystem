import { areasClose } from "@/lib/bas-mapping";

/**
 * Приведення назв полів з Wialon до канонічного вигляду для BAS.
 *
 * Назви в Wialon неоднозначні: «Поле №1» — це вісім різних полів, а площа зашита
 * прямо в текст («Поле №10   82,5 Га»). Тут лише підказки — остаточну назву
 * підтверджує агроном у реєстрі полів.
 */

export type RegistryInputRow = {
  id: string;
  name: string;
  areaHa: number | null;
};

export type BasFieldRef = {
  refKey: string;
  description: string;
  fieldNo: string | null;
  areaHa: number | null;
};

export type FieldSuggestion = {
  canonicalName: string;
  fieldNo: string | null;
  tract: string | null;
  basRefKey: string | null;
};

/** Урочища, які зустрічаються і в Wialon, і в BAS (з різним написанням). */
const TRACTS: { canonical: string; pattern: RegExp }[] = [
  { canonical: "Винарівка", pattern: /винар[іи]вка/iu },
  { canonical: "Стрижавка", pattern: /стрижавка/iu },
  { canonical: "Сухий Яр", pattern: /сухий\s*яр/iu },
  { canonical: "Плютинці", pattern: /плютин[іцчи]+/iu },
  { canonical: "Григорівка", pattern: /григор[іи]вка/iu },
  { canonical: "Василиха", pattern: /вас[еи]лиха/iu },
  { canonical: "Франчукове", pattern: /франчуков[еа]/iu },
  { canonical: "Городи", pattern: /^город/iu },
];

const CADASTRAL_RE = /\s*·?\s*\d{10}:\d{2}:\d{3}:\d{4}/gu;
/** «26,6 Га», «11га», «96а» — площа, вписана в назву. */
const AREA_TOKEN_RE = /\s*\d+(?:[.,]\d+)?\s*(?:га|a|а)(?![\p{L}\p{N}])/giu;
/**
 * «Поле №8 186» — площа без одиниці в кінці назви. Негативний lookbehind
 * захищає сам номер поля: у «Поле № 8» вісімку зрізати не можна.
 */
const TRAILING_NUMBER_RE = /\s+(?<!№\s)\d+(?:[.,]\d+)?\s*$/u;

/** Прибирає з назви кадастровий номер і хвіст із площею. */
export function cleanFieldName(raw: string): string {
  if (!raw) return "";

  let value = raw.replace(CADASTRAL_RE, " ").replace(AREA_TOKEN_RE, " ");

  // Хвостове число зрізаємо тільки якщо в назві лишається щось змістовне.
  const withoutTail = value.replace(TRAILING_NUMBER_RE, "");
  if (/[\p{L}]/u.test(withoutTail)) {
    value = withoutTail;
  }

  return value
    .replace(/\s+/gu, " ")
    .replace(/[\s·,;-]+$/u, "")
    .trim();
}

/** Урочище з назви поля, у канонічному написанні. */
export function extractTract(raw: string): string | null {
  if (!raw) return null;
  for (const { canonical, pattern } of TRACTS) {
    if (pattern.test(raw)) return canonical;
  }
  return null;
}

/** Базовий номер поля: «Поле №1 Винарівка» → "1", «Поле 1.1» → "1". */
export function extractBaseFieldNumber(raw: string): string | null {
  const match = raw.match(/(?:поле|поля|ділянка|участок)\s*№?\s*(\d+)/iu);
  return match?.[1] ?? null;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Підказки для всього реєстру одразу: канонічна назва, номер поля, урочище
 * і збіг із наявним полем BAS. Номери підхоплюються з BAS там, де поле
 * впізнається по площі, щоб не плодити паралельну нумерацію.
 */
export function suggestFieldRegistry(
  rows: RegistryInputRow[],
  basFields: BasFieldRef[]
): Record<string, FieldSuggestion> {
  const prepared = rows.map((row) => ({
    row,
    cleaned: cleanFieldName(row.name) || row.name.trim(),
    tract: extractTract(row.name),
    base: extractBaseFieldNumber(row.name),
  }));

  const matchedBas = matchRowsToBasFields(prepared, basFields);

  const basNumbersInUse = new Set(
    basFields
      .map((item) => item.fieldNo?.trim())
      .filter((value): value is string => Boolean(value))
  );

  const groupSizes = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const item of prepared) {
    if (item.base) {
      groupSizes.set(item.base, (groupSizes.get(item.base) ?? 0) + 1);
    }
    const key = normalizeName(item.cleaned);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const assignedNumbers = new Set<string>();
  const result: Record<string, FieldSuggestion> = {};

  // Спершу ті, що впізналися в BAS — вони закріплюють за собою номер.
  const ordered = [...prepared].sort((a, b) => {
    const aMatched = matchedBas.has(a.row.id) ? 0 : 1;
    const bMatched = matchedBas.has(b.row.id) ? 0 : 1;
    return aMatched - bMatched;
  });

  for (const item of ordered) {
    const match = matchedBas.get(item.row.id) ?? null;
    let fieldNo = match?.fieldNo?.trim() || null;

    if (!fieldNo && item.base) {
      const groupSize = groupSizes.get(item.base) ?? 1;
      if (groupSize === 1) {
        fieldNo = item.base;
      } else {
        fieldNo = nextFreeSubNumber(
          item.base,
          assignedNumbers,
          basNumbersInUse
        );
      }
    }

    if (fieldNo) assignedNumbers.add(fieldNo);

    // Поле, яке впізналося в BAS AGRO, переймає їхню назву слово в слово. Так
    // вивантаження підхопить наявний запис замість створення дубля.
    let canonicalName = match?.description.trim() || item.cleaned;

    if (!match) {
      const isDuplicateName =
        (nameCounts.get(normalizeName(item.cleaned)) ?? 0) > 1;
      if (isDuplicateName) {
        if (fieldNo) {
          canonicalName = `Поле ${fieldNo}`;
        } else if (item.row.areaHa != null) {
          canonicalName = `${item.cleaned} (${item.row.areaHa} га)`;
        }
      }
    }

    result[item.row.id] = {
      canonicalName,
      fieldNo,
      tract: item.tract,
      basRefKey: match?.refKey ?? null,
    };
  }

  return result;
}

type PreparedRow = {
  row: RegistryInputRow;
  cleaned: string;
  tract: string | null;
  base: string | null;
};

function basBaseNumber(field: BasFieldRef): string | null {
  const fromNo = field.fieldNo?.trim().split(".")[0];
  if (fromNo) return fromNo;
  return extractBaseFieldNumber(field.description);
}

/**
 * Один рядок — одне поле BAS. Проходи від найнадійнішого сигналу до найслабшого:
 * номер поля разом із площею, потім урочище/назва, і лише потім сама площа.
 * Останній прохід навмисно вузький — площі різних полів легко збігаються
 * випадково (База 8.33 га проти Григорівки 9.8 га).
 */
function matchRowsToBasFields(
  prepared: PreparedRow[],
  basFields: BasFieldRef[]
): Map<string, BasFieldRef> {
  const matched = new Map<string, BasFieldRef>();
  const taken = new Set<string>();

  const claim = (rowId: string, field: BasFieldRef) => {
    matched.set(rowId, field);
    taken.add(field.refKey);
  };
  const available = () => basFields.filter((f) => !taken.has(f.refKey));

  for (const item of prepared) {
    if (matched.has(item.row.id) || item.row.areaHa == null || !item.base) {
      continue;
    }
    const area = item.row.areaHa;
    const hits = available().filter(
      (field) =>
        basBaseNumber(field) === item.base &&
        field.areaHa != null &&
        areasClose(area, field.areaHa)
    );
    if (hits.length === 1) claim(item.row.id, hits[0]);
  }

  // Урочище претендує на запис BAS лише коли воно в нас одне. Якщо ми розбили
  // урочище на кілька полів (Василиха №1 і №2), спільний запис BAS не займаємо —
  // замість нього створюємо обидва наші.
  const tractCounts = new Map<string, number>();
  for (const item of prepared) {
    if (item.tract) {
      tractCounts.set(item.tract, (tractCounts.get(item.tract) ?? 0) + 1);
    }
  }

  // Назва може збігтися при зовсім різних площах: наше «Поле №4» на 17,8 га
  // не є їхнім «Поле 4» на 99 га. Тому збіг по назві перевіряємо площею.
  const areaSane = (item: PreparedRow, field: BasFieldRef) => {
    if (item.row.areaHa == null || field.areaHa == null) return true;
    const larger = Math.max(item.row.areaHa, field.areaHa);
    return Math.abs(item.row.areaHa - field.areaHa) / larger <= 0.25;
  };

  for (const item of prepared) {
    if (matched.has(item.row.id)) continue;

    if (item.tract && tractCounts.get(item.tract) === 1) {
      const pattern = TRACTS.find((t) => t.canonical === item.tract)?.pattern;
      const hits = pattern
        ? available().filter(
            (field) => pattern.test(field.description) && areaSane(item, field)
          )
        : [];
      if (hits.length === 1) {
        claim(item.row.id, hits[0]);
        continue;
      }
    }

    const target = normalizeName(item.cleaned);
    if (!target) continue;
    const hits = available().filter(
      (field) =>
        normalizeName(field.description) === target && areaSane(item, field)
    );
    if (hits.length === 1) claim(item.row.id, hits[0]);
  }

  for (const item of prepared) {
    if (matched.has(item.row.id) || item.row.areaHa == null) continue;
    const area = item.row.areaHa;
    const hits = available().filter((field) => {
      if (field.areaHa == null) return false;
      if (!areasClose(area, field.areaHa, 0.03, 0.5)) return false;
      // Без підтвердження назвою не змішуємо різні номери й різні урочища.
      const fieldBase = basBaseNumber(field);
      if (item.base && fieldBase && fieldBase !== item.base) return false;
      const fieldTract = extractTract(field.description);
      if (fieldTract && fieldTract !== item.tract) return false;
      if (item.tract && fieldTract !== item.tract) return false;
      return true;
    });
    if (hits.length === 1) claim(item.row.id, hits[0]);
  }

  return matched;
}

function nextFreeSubNumber(
  base: string,
  assigned: Set<string>,
  basNumbersInUse: Set<string>
): string {
  for (let index = 1; index < 50; index += 1) {
    const candidate = `${base}.${index}`;
    if (!assigned.has(candidate) && !basNumbersInUse.has(candidate)) {
      return candidate;
    }
  }
  return base;
}
