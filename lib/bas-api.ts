/**
 * BAS AGRO (1C) OData — READ-ONLY довідники.
 * Креденшали лише на сервері: BAS_ODATA_URL, BAS_USER, BAS_PASS.
 *
 * База BAS належить бухгалтерії, тому тут тільки GET. Жодних POST/PATCH/DELETE:
 * зв'язок із BAS AGRO зберігається на нашому боці в колонках bas_ref_key.
 * Див. .cursor/rules/bas-readonly.mdc
 */

export interface BasStorage {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
  IsFolder: boolean | null;
  Parent_Key: string | null;
  /** Назва групи (ППМ / Рослиництво), проставляється клієнтом */
  folderName?: string | null;
}

export interface BasMachinery {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
  НаименованиеПолное: string | null;
  НомерПаспорта: string | null;
  ЗаводскойНомер: string | null;
  Parent_Key?: string | null;
  IsFolder?: boolean | null;
  DeletionMark?: boolean | null;
  Автотранспорт?: boolean | null;
}

/** Поля в BAS AGRO — Catalog_ПодразделенияОрганизаций з прапорцем ИНАГРО_ПризнакПоля */
export interface BasField {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
  ИНАГРО_НомерПоля: string | null;
  ИНАГРО_Площадь: number | null;
  ИНАГРО_ПризнакПоля: boolean | null;
}

type ODataCollection<T> = {
  value?: T[];
  "odata.nextLink"?: string;
  "odata.error"?: {
    code?: string;
    message?: { lang?: string; value?: string } | string;
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} не задано в env`);
  }
  return value;
}

function basicAuthHeader(): string {
  const user = requiredEnv("BAS_USER");
  const pass = requiredEnv("BAS_PASS");
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function odataBaseUrl(): string {
  return requiredEnv("BAS_ODATA_URL").replace(/\/+$/, "");
}

function odataErrorMessage(payload: ODataCollection<unknown>): string | null {
  const err = payload["odata.error"];
  if (!err) return null;
  if (typeof err.message === "string" && err.message.trim()) return err.message;
  if (err.message && typeof err.message === "object" && err.message.value) {
    return err.message.value;
  }
  return err.code || "невідома помилка OData";
}

function buildCatalogUrl(
  entitySet: string,
  options: { select: string; filter?: string }
): string {
  const encodedSet = encodeURIComponent(entitySet);
  const params: string[] = [];

  params.push(
    `$select=${options.select
      .split(",")
      .map((part) => encodeURIComponent(part.trim()))
      .join(",")}`
  );

  if (options.filter) {
    params.push(`$filter=${encodeURIComponent(options.filter)}`);
  }

  params.push("$format=json");

  return `${odataBaseUrl()}/odata/standard.odata/${encodedSet}?${params.join("&")}`;
}

async function fetchBasCatalog<T>(
  entitySet: string,
  options: { select: string; filter?: string }
): Promise<T[]> {
  let url: string | null = buildCatalogUrl(entitySet, options);
  const all: T[] = [];

  while (url) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: basicAuthHeader(),
          Accept: "application/json",
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "мережева помилка";
      throw new Error(`BAS OData ${entitySet}: ${reason}`);
    }

    const raw = await response.text();
    let payload: ODataCollection<T>;

    try {
      payload = JSON.parse(raw) as ODataCollection<T>;
    } catch {
      throw new Error(
        `BAS OData ${entitySet}: відповідь не JSON (HTTP ${response.status})`
      );
    }

    const odataError = odataErrorMessage(payload);
    if (!response.ok || odataError) {
      throw new Error(
        `BAS OData ${entitySet}: HTTP ${response.status}${
          odataError ? ` — ${odataError}` : ""
        }`
      );
    }

    if (!Array.isArray(payload.value)) {
      throw new Error(`BAS OData ${entitySet}: у відповіді немає масиву value`);
    }

    all.push(...payload.value);
    url = payload["odata.nextLink"] ?? null;
  }

  return all;
}

/**
 * Склади BAS AGRO разом з назвою групи (ППМ = пально-мастильні).
 * Групи потрібні, щоб у мапінгу було видно, який склад паливний.
 */
export async function getBasStorages(): Promise<BasStorage[]> {
  const rows = await fetchBasCatalog<BasStorage>("Catalog_Склады", {
    select: "Ref_Key,Description,Code,IsFolder,Parent_Key",
  });

  const folderNames = new Map<string, string>();
  for (const row of rows) {
    if (row.IsFolder && row.Ref_Key) {
      folderNames.set(row.Ref_Key.toLowerCase(), row.Description?.trim() ?? "");
    }
  }

  return rows
    .filter((row) => !row.IsFolder)
    .map((row) => ({
      ...row,
      folderName: row.Parent_Key
        ? folderNames.get(row.Parent_Key.toLowerCase()) ?? null
        : null,
    }));
}

export async function getBasMachinery(): Promise<BasMachinery[]> {
  return fetchBasCatalog<BasMachinery>("Catalog_ОсновныеСредства", {
    select:
      "Ref_Key,Description,Code,НаименованиеПолное,НомерПаспорта,ЗаводскойНомер",
    filter: "IsFolder eq false",
  });
}

/** Усі ОЗ разом з папками — для sync-імпорту в equipment/implements. */
export async function getBasAllAssets(): Promise<BasMachinery[]> {
  return fetchBasCatalog<BasMachinery>("Catalog_ОсновныеСредства", {
    select:
      "Ref_Key,Description,Code,НаименованиеПолное,НомерПаспорта,ЗаводскойНомер,Parent_Key,IsFolder,DeletionMark,Автотранспорт",
  });
}

/**
 * Агро-поля з BAS AGRO: Catalog_ПодразделенияОрганизаций (не кадастрові участки).
 * Фільтр: лише записи з ІНАГРО_ПризнакПоля = true.
 */
export async function getBasFields(): Promise<BasField[]> {
  const rows = await fetchBasCatalog<BasField>(
    "Catalog_ПодразделенияОрганизаций",
    {
      select:
        "Ref_Key,Description,Code,ИНАГРО_НомерПоля,ИНАГРО_Площадь,ИНАГРО_ПризнакПоля",
      filter: "ИНАГРО_ПризнакПоля eq true",
    }
  );

  return rows.filter((row) => {
    const name = row.Description?.trim() ?? "";
    const num = row.ИНАГРО_НомерПоля?.trim() ?? "";
    if (name === "Поля" || num === "Загалом") return false;
    return true;
  });
}

// ── Номенклатура / склад ───────────────────────────────────────────

export interface BasNomenclature {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
  IsFolder: boolean | null;
  Parent_Key: string | null;
  DeletionMark: boolean | null;
  БазоваяЕдиницаИзмерения_Key: string | null;
  ИНАГРО_Удобрение: boolean | null;
  ИНАГРО_ВидПродукции: string | null;
}

export interface BasUnit {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
}

export interface BasPurchaseMovement {
  Period: string;
  Номенклатура: string | null;
  Количество: number | null;
  Стоимость: number | null;
  Склад_Key: string | null;
  Active: boolean | null;
  Recorder?: string | null;
  Recorder_Type?: string | null;
  Контрагент_Key?: string | null;
}

export interface BasHarvestMovement {
  Period: string;
  Номенклатура: string | null;
  Количество: number | null;
  Сумма: number | null;
  СкладПолучатель_Key: string | null;
  Active: boolean | null;
  Recorder?: string | null;
  Recorder_Type?: string | null;
}

/** Реалізація організацій — мінуси зі складу (кількість/сума продажів). */
export interface BasSaleMovement {
  Period: string;
  Номенклатура: string | null;
  Количество: number | null;
  Стоимость: number | null;
  Склад_Key: string | null;
  Active: boolean | null;
  Recorder?: string | null;
  Recorder_Type?: string | null;
  Контрагент_Key?: string | null;
}

export async function getBasNomenclature(): Promise<BasNomenclature[]> {
  return fetchBasCatalog<BasNomenclature>("Catalog_Номенклатура", {
    select:
      "Ref_Key,Description,Code,IsFolder,Parent_Key,DeletionMark,БазоваяЕдиницаИзмерения_Key,ИНАГРО_Удобрение,ИНАГРО_ВидПродукции",
  });
}

export async function getBasUnits(): Promise<BasUnit[]> {
  return fetchBasCatalog<BasUnit>("Catalog_КлассификаторЕдиницИзмерения", {
    select: "Ref_Key,Description,Code",
  });
}

/** Закупки організацій з BAS AGRO за період (надходження матеріалів). */
export async function getBasPurchasesSince(
  isoDate: string
): Promise<BasPurchaseMovement[]> {
  return fetchBasCatalog<BasPurchaseMovement>(
    "AccumulationRegister_ИНАГРО_ЗакупкиОрганизаций_RecordType",
    {
      select:
        "Period,Номенклатура,Количество,Стоимость,Склад_Key,Active,Recorder,Recorder_Type,Контрагент_Key",
      filter: `Period ge datetime'${isoDate}' and Active eq true`,
    }
  );
}

/** Випуск продукції (врожай) з BAS AGRO за період. */
export async function getBasHarvestOutputSince(
  isoDate: string
): Promise<BasHarvestMovement[]> {
  return fetchBasCatalog<BasHarvestMovement>(
    "AccumulationRegister_ИНАГРО_ВыпускПродукцииОрганизации_RecordType",
    {
      select:
        "Period,Номенклатура,Количество,Сумма,СкладПолучатель_Key,Active,Recorder,Recorder_Type",
      filter: `Period ge datetime'${isoDate}' and Active eq true`,
    }
  );
}

/** Продажі номенклатури (рухи реалізації) — витрати зі складу. */
export async function getBasSaleMovementsSince(
  isoDate: string
): Promise<BasSaleMovement[]> {
  return fetchBasCatalog<BasSaleMovement>(
    "AccumulationRegister_ИНАГРО_РеализацияОрганизаций_RecordType",
    {
      select:
        "Period,Номенклатура,Количество,Стоимость,Склад_Key,Active,Recorder,Recorder_Type,Контрагент_Key",
      filter: `Period ge datetime'${isoDate}' and Active eq true`,
    }
  );
}

/**
 * Залишки на складах. У цій базі OData Balance/RecordType порожні
 * (перевірено) — функція лишається на випадок, коли регістр з’явиться в OData.
 */
export async function getBasWarehouseBalances(
  periodIso?: string
): Promise<
  {
    Номенклатура_Key: string | null;
    Склад_Key: string | null;
    КоличествоBalance: number | null;
  }[]
> {
  const period = periodIso?.trim() || new Date().toISOString().slice(0, 19);
  const path = `AccumulationRegister_ИНАГРО_ТоварыНаСкладах/Balance(Period=datetime'${period}')?$format=json`;
  const url = `${odataBaseUrl()}/odata/standard.odata/${path}`;
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
    },
  });
  const raw = await response.text();
  let payload: ODataCollection<{
    Номенклатура_Key: string | null;
    Склад_Key: string | null;
    КоличествоBalance: number | null;
  }>;
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    throw new Error(
      `BAS OData ТоварыНаСкладах/Balance: відповідь не JSON (HTTP ${response.status})`
    );
  }
  const odataError = odataErrorMessage(payload);
  if (!response.ok || odataError) {
    throw new Error(
      `BAS OData ТоварыНаСкладах/Balance: HTTP ${response.status}${
        odataError ? ` — ${odataError}` : ""
      }`
    );
  }
  return Array.isArray(payload.value) ? payload.value : [];
}

// ── Документи надходження / реалізації / контрагенти ────────────────

export interface BasReceiptDoc {
  Ref_Key: string;
  Number: string | null;
  Date: string | null;
  Posted: boolean | null;
  СуммаДокумента: number | null;
  Контрагент_Key: string | null;
  Склад: string | null;
  Комментарий: string | null;
}

export interface BasSaleDoc {
  Ref_Key: string;
  Number: string | null;
  Date: string | null;
  Posted: boolean | null;
  СуммаДокумента: number | null;
  Контрагент_Key: string | null;
  Склад_Key: string | null;
}

export interface BasCounterparty {
  Ref_Key: string;
  Description: string | null;
  Code: string | null;
}

export async function getBasReceiptsSince(
  isoDate: string
): Promise<BasReceiptDoc[]> {
  return fetchBasCatalog<BasReceiptDoc>(
    "Document_ПоступлениеТоваровУслуг",
    {
      select:
        "Ref_Key,Number,Date,Posted,СуммаДокумента,Контрагент_Key,Склад,Комментарий",
      filter: `Date ge datetime'${isoDate}' and Posted eq true`,
    }
  );
}

export async function getBasSalesSince(
  isoDate: string
): Promise<BasSaleDoc[]> {
  return fetchBasCatalog<BasSaleDoc>(
    "Document_РеализацияТоваровУслуг",
    {
      select:
        "Ref_Key,Number,Date,Posted,СуммаДокумента,Контрагент_Key,Склад_Key",
      filter: `Date ge datetime'${isoDate}' and Posted eq true`,
    }
  );
}

export async function getBasCounterparties(): Promise<BasCounterparty[]> {
  return fetchBasCatalog<BasCounterparty>("Catalog_Контрагенты", {
    select: "Ref_Key,Description,Code",
    filter: "IsFolder eq false",
  });
}

export interface BasProductionDoc {
  Ref_Key: string;
  Number: string | null;
  Date: string | null;
  Posted: boolean | null;
}

export async function getBasProductionReportsSince(
  isoDate: string
): Promise<BasProductionDoc[]> {
  return fetchBasCatalog<BasProductionDoc>(
    "Document_ОтчетПроизводстваЗаСмену",
    {
      select: "Ref_Key,Number,Date,Posted",
      filter: `Date ge datetime'${isoDate}' and Posted eq true`,
    }
  );
}

// ── Рядки конкретного документа (Товары / Услуги) ───────────────────

export interface BasDocLineRaw {
  LineNumber?: string | number | null;
  Номенклатура_Key?: string | null;
  ЕдиницаИзмерения_Key?: string | null;
  Количество?: number | null;
  Цена?: number | null;
  Сумма?: number | null;
  СуммаНДС?: number | null;
  СтавкаНДС?: string | null;
  Содержание?: string | null;
  ПлановаяСтоимость?: number | null;
  СуммаПлановая?: number | null;
}

export type BasDocLine = {
  lineNumber: number;
  name: string;
  unit: string;
  qty: number;
  price: number;
  sum: number;
  vat: number;
  vatRate: string;
  kind: "goods" | "service";
};

export type BasDocumentInvoice = {
  type: "receipt" | "sale" | "production";
  refKey: string;
  number: string;
  date: string;
  posted: boolean;
  amount: number;
  amountVat: number;
  amountInclVat: number;
  vatIncluded: boolean;
  comment: string;
  organization: { name: string; edrpou: string };
  counterparty: { name: string; fullName: string; edrpou: string; inn: string };
  contract: string;
  warehouse: string;
  lines: BasDocLine[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

async function fetchBasEntity<T extends Record<string, unknown>>(
  entityPath: string
): Promise<T> {
  const url = `${odataBaseUrl()}/odata/standard.odata/${entityPath}?$format=json`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "мережева помилка";
    throw new Error(`BAS OData ${entityPath}: ${reason}`);
  }

  const raw = await response.text();
  let payload: T & ODataCollection<unknown>;
  try {
    payload = JSON.parse(raw) as T & ODataCollection<unknown>;
  } catch {
    throw new Error(
      `BAS OData ${entityPath}: відповідь не JSON (HTTP ${response.status})`
    );
  }

  const odataError = odataErrorMessage(payload);
  if (!response.ok || odataError) {
    throw new Error(
      `BAS OData ${entityPath}: HTTP ${response.status}${
        odataError ? ` — ${odataError}` : ""
      }`
    );
  }

  return payload;
}

function isGuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_RE.test(value) && value !== EMPTY_GUID);
}

function formatVatRate(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = raw.match(/(\d+)/);
  return m ? `${m[1]}%` : raw;
}

async function fetchBasNavCollection<T>(navPath: string): Promise<T[]> {
  const url = `${odataBaseUrl()}/odata/standard.odata/${navPath}?$format=json`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: basicAuthHeader(),
        Accept: "application/json",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "мережева помилка";
    throw new Error(`BAS OData ${navPath}: ${reason}`);
  }

  const raw = await response.text();
  let payload: ODataCollection<T>;
  try {
    payload = JSON.parse(raw) as ODataCollection<T>;
  } catch {
    throw new Error(
      `BAS OData ${navPath}: відповідь не JSON (HTTP ${response.status})`
    );
  }

  const odataError = odataErrorMessage(payload);
  if (!response.ok || odataError) {
    throw new Error(
      `BAS OData ${navPath}: HTTP ${response.status}${
        odataError ? ` — ${odataError}` : ""
      }`
    );
  }

  return Array.isArray(payload.value) ? payload.value : [];
}

async function resolveBasNames(
  nomKeys: string[],
  unitKeys: string[]
): Promise<{ names: Map<string, string>; units: Map<string, string> }> {
  const names = new Map<string, string>();
  const units = new Map<string, string>();

  const uniqueNom = [...new Set(nomKeys.filter((k) => UUID_RE.test(k)))];
  const uniqueUnits = [...new Set(unitKeys.filter((k) => UUID_RE.test(k)))];

  if (uniqueNom.length > 0) {
    // OData 1C: batch OR filters in chunks of 20
    for (let i = 0; i < uniqueNom.length; i += 20) {
      const chunk = uniqueNom.slice(i, i + 20);
      const filter = chunk.map((k) => `Ref_Key eq guid'${k}'`).join(" or ");
      const rows = await fetchBasCatalog<{
        Ref_Key: string;
        Description: string | null;
      }>("Catalog_Номенклатура", {
        select: "Ref_Key,Description",
        filter,
      });
      for (const row of rows) {
        names.set(row.Ref_Key.toLowerCase(), row.Description?.trim() || "Без назви");
      }
    }
  }

  if (uniqueUnits.length > 0) {
    for (let i = 0; i < uniqueUnits.length; i += 20) {
      const chunk = uniqueUnits.slice(i, i + 20);
      const filter = chunk.map((k) => `Ref_Key eq guid'${k}'`).join(" or ");
      const rows = await fetchBasCatalog<{
        Ref_Key: string;
        Description: string | null;
        Code: string | null;
      }>("Catalog_КлассификаторЕдиницИзмерения", {
        select: "Ref_Key,Description,Code",
        filter,
      });
      for (const row of rows) {
        units.set(
          row.Ref_Key.toLowerCase(),
          row.Description?.trim() || row.Code?.trim() || ""
        );
      }
    }
  }

  return { names, units };
}

/**
 * Рядки документа надходження або реалізації з BAS (read-only).
 * Підтягує Товары + Услуги і резолвить назви номенклатури.
 */
export async function getBasDocumentLines(
  type: "receipt" | "sale",
  refKey: string
): Promise<BasDocLine[]> {
  const key = refKey.trim().toLowerCase();
  if (!UUID_RE.test(key)) {
    throw new Error("Некоректний Ref_Key документа");
  }

  const entity =
    type === "receipt"
      ? "Document_ПоступлениеТоваровУслуг"
      : "Document_РеализацияТоваровУслуг";

  const [goods, services] = await Promise.all([
    fetchBasNavCollection<BasDocLineRaw>(
      `${entity}(guid'${key}')/Товары`
    ),
    type === "receipt"
      ? fetchBasNavCollection<BasDocLineRaw>(
          `${entity}(guid'${key}')/Услуги`
        ).catch(() => [] as BasDocLineRaw[])
      : fetchBasNavCollection<BasDocLineRaw>(
          `${entity}(guid'${key}')/Услуги`
        ).catch(() => [] as BasDocLineRaw[]),
  ]);

  const nomKeys = [...goods, ...services]
    .map((r) => r.Номенклатура_Key)
    .filter((k): k is string => Boolean(k));
  const unitKeys = [...goods, ...services]
    .map((r) => r.ЕдиницаИзмерения_Key)
    .filter((k): k is string => Boolean(k));

  const { names, units } = await resolveBasNames(nomKeys, unitKeys);

  const mapRow = (
    row: BasDocLineRaw,
    kind: "goods" | "service"
  ): BasDocLine => {
    const nomKey = (row.Номенклатура_Key || "").toLowerCase();
    const unitKey = (row.ЕдиницаИзмерения_Key || "").toLowerCase();
    const fromContent = row.Содержание?.trim();
    return {
      lineNumber: Number(row.LineNumber) || 0,
      name: names.get(nomKey) || fromContent || "Без назви",
      unit: units.get(unitKey) || "",
      qty: Number(row.Количество) || 0,
      price: Number(row.Цена) || 0,
      sum: Number(row.Сумма) || 0,
      vat: Number(row.СуммаНДС) || 0,
      vatRate: formatVatRate(row.СтавкаНДС),
      kind,
    };
  };

  return [
    ...goods.map((r) => mapRow(r, "goods")),
    ...services.map((r) => mapRow(r, "service")),
  ].sort((a, b) => a.lineNumber - b.lineNumber || a.name.localeCompare(b.name, "uk"));
}

/**
 * Повна «накладна» / звіт з BAS: шапка + рядки.
 * PDF/друк у BAS AGRO через OData недоступні — збираємо друковану форму з даних документа.
 */
export async function getBasDocumentInvoice(
  type: "receipt" | "sale" | "production",
  refKey: string
): Promise<BasDocumentInvoice> {
  const key = refKey.trim().toLowerCase();
  if (!UUID_RE.test(key)) {
    throw new Error("Некоректний Ref_Key документа");
  }

  if (type === "production") {
    return getBasProductionInvoice(key);
  }

  const entity =
    type === "receipt"
      ? "Document_ПоступлениеТоваровУслуг"
      : "Document_РеализацияТоваровУслуг";

  const doc = await fetchBasEntity<{
    Ref_Key: string;
    Number: string | null;
    Date: string | null;
    Posted: boolean | null;
    СуммаДокумента: number | null;
    СуммаВключаетНДС: boolean | null;
    Комментарий: string | null;
    Организация_Key: string | null;
    Контрагент_Key: string | null;
    ДоговорКонтрагента_Key: string | null;
    Склад_Key?: string | null;
    Склад?: string | null;
    Товары?: BasDocLineRaw[];
    Услуги?: BasDocLineRaw[];
  }>(`${entity}(guid'${key}')`);

  const goods = Array.isArray(doc.Товары) ? doc.Товары : [];
  const services = Array.isArray(doc.Услуги) ? doc.Услуги : [];

  const nomKeys = [...goods, ...services]
    .map((r) => r.Номенклатура_Key)
    .filter((k): k is string => Boolean(k));
  const unitKeys = [...goods, ...services]
    .map((r) => r.ЕдиницаИзмерения_Key)
    .filter((k): k is string => Boolean(k));

  const warehouseKey = isGuid(doc.Склад_Key)
    ? doc.Склад_Key
    : isGuid(doc.Склад)
      ? doc.Склад
      : null;

  const [{ names, units }, org, counterparty, contract, warehouse] =
    await Promise.all([
      resolveBasNames(nomKeys, unitKeys),
      isGuid(doc.Организация_Key)
        ? fetchBasEntity<{
            Description?: string | null;
            НаименованиеПолное?: string | null;
            КодПоЕДРПОУ?: string | null;
          }>(`Catalog_Организации(guid'${doc.Организация_Key}')`).catch(
            () => null
          )
        : Promise.resolve(null),
      isGuid(doc.Контрагент_Key)
        ? fetchBasEntity<{
            Description?: string | null;
            НаименованиеПолное?: string | null;
            КодПоЕДРПОУ?: string | null;
            ИНН?: string | null;
          }>(`Catalog_Контрагенты(guid'${doc.Контрагент_Key}')`).catch(
            () => null
          )
        : Promise.resolve(null),
      isGuid(doc.ДоговорКонтрагента_Key)
        ? fetchBasEntity<{ Description?: string | null }>(
            `Catalog_ДоговорыКонтрагентов(guid'${doc.ДоговорКонтрагента_Key}')`
          ).catch(() => null)
        : Promise.resolve(null),
      warehouseKey
        ? fetchBasEntity<{ Description?: string | null }>(
            `Catalog_Склады(guid'${warehouseKey}')`
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

  const mapRow = (
    row: BasDocLineRaw,
    kind: "goods" | "service"
  ): BasDocLine => {
    const nomKey = (row.Номенклатура_Key || "").toLowerCase();
    const unitKey = (row.ЕдиницаИзмерения_Key || "").toLowerCase();
    return {
      lineNumber: Number(row.LineNumber) || 0,
      name:
        names.get(nomKey) || row.Содержание?.trim() || "Без назви",
      unit: units.get(unitKey) || "",
      qty: Number(row.Количество) || 0,
      price: Number(row.Цена) || 0,
      sum: Number(row.Сумма) || 0,
      vat: Number(row.СуммаНДС) || 0,
      vatRate: formatVatRate(row.СтавкаНДС),
      kind,
    };
  };

  const lines = [
    ...goods.map((r) => mapRow(r, "goods")),
    ...services.map((r) => mapRow(r, "service")),
  ].sort(
    (a, b) =>
      a.lineNumber - b.lineNumber || a.name.localeCompare(b.name, "uk")
  );

  const docAmount = Number(doc.СуммаДокумента) || 0;
  const amountVat = Math.round(lines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
  const linesSum = Math.round(lines.reduce((s, l) => s + l.sum, 0) * 100) / 100;
  const vatIncluded = Boolean(doc.СуммаВключаетНДС);
  // У BAS СуммаДокумента — це завжди підсумок до сплати (з ПДВ).
  // СуммаВключаетНДС лише каже, чи в рядках Цена/Сумма вже з ПДВ.
  const amountInclVat = Math.round(
    (docAmount ||
      (vatIncluded ? linesSum : linesSum + amountVat)) *
      100
  ) / 100;
  const amountExclVat = Math.round(
    (vatIncluded
      ? amountInclVat - amountVat
      : linesSum || amountInclVat - amountVat) *
      100
  ) / 100;

  const warehouseName = warehouse?.Description?.trim() || "";

  return {
    type,
    refKey: key,
    number: doc.Number?.trim() || "—",
    date: doc.Date?.slice(0, 10) || "",
    posted: Boolean(doc.Posted),
    amount: amountExclVat,
    amountVat,
    amountInclVat,
    vatIncluded,
    comment: doc.Комментарий?.trim() || "",
    organization: {
      name:
        org?.НаименованиеПолное?.trim() ||
        org?.Description?.trim() ||
        "Організація",
      edrpou: org?.КодПоЕДРПОУ?.trim() || "",
    },
    counterparty: {
      name: counterparty?.Description?.trim() || "Контрагент",
      fullName:
        counterparty?.НаименованиеПолное?.trim() ||
        counterparty?.Description?.trim() ||
        "",
      edrpou: counterparty?.КодПоЕДРПОУ?.trim() || "",
      inn: counterparty?.ИНН?.trim() || "",
    },
    contract: contract?.Description?.trim() || "",
    warehouse: warehouseName,
    lines,
  };
}

async function getBasProductionInvoice(
  key: string
): Promise<BasDocumentInvoice> {
  const doc = await fetchBasEntity<{
    Ref_Key: string;
    Number: string | null;
    Date: string | null;
    Posted: boolean | null;
    Комментарий: string | null;
    Организация_Key: string | null;
    Склад_Key?: string | null;
    Продукция?: BasDocLineRaw[];
  }>(`Document_ОтчетПроизводстваЗаСмену(guid'${key}')`);

  const products = Array.isArray(doc.Продукция) ? doc.Продукция : [];
  const nomKeys = products
    .map((r) => r.Номенклатура_Key)
    .filter((k): k is string => Boolean(k));
  const unitKeys = products
    .map((r) => r.ЕдиницаИзмерения_Key)
    .filter((k): k is string => Boolean(k));

  const [{ names, units }, org, warehouse] = await Promise.all([
    resolveBasNames(nomKeys, unitKeys),
    isGuid(doc.Организация_Key)
      ? fetchBasEntity<{
          Description?: string | null;
          НаименованиеПолное?: string | null;
          КодПоЕДРПОУ?: string | null;
        }>(`Catalog_Организации(guid'${doc.Организация_Key}')`).catch(() => null)
      : Promise.resolve(null),
    isGuid(doc.Склад_Key)
      ? fetchBasEntity<{ Description?: string | null }>(
          `Catalog_Склады(guid'${doc.Склад_Key}')`
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const lines: BasDocLine[] = products
    .map((row) => {
      const nomKey = (row.Номенклатура_Key || "").toLowerCase();
      const unitKey = (row.ЕдиницаИзмерения_Key || "").toLowerCase();
      const qty = Number(row.Количество) || 0;
      const price = Number(row.ПлановаяСтоимость) || 0;
      const sum = Number(row.СуммаПлановая) || price * qty;
      return {
        lineNumber: Number(row.LineNumber) || 0,
        name: names.get(nomKey) || "Без назви",
        unit: units.get(unitKey) || "",
        qty,
        price,
        sum,
        vat: 0,
        vatRate: "",
        kind: "goods" as const,
      };
    })
    .sort(
      (a, b) =>
        a.lineNumber - b.lineNumber || a.name.localeCompare(b.name, "uk")
    );

  const amount = Math.round(lines.reduce((s, l) => s + l.sum, 0) * 100) / 100;

  return {
    type: "production",
    refKey: key,
    number: doc.Number?.trim() || "—",
    date: doc.Date?.slice(0, 10) || "",
    posted: Boolean(doc.Posted),
    amount,
    amountVat: 0,
    amountInclVat: amount,
    vatIncluded: true,
    comment: doc.Комментарий?.trim() || "",
    organization: {
      name:
        org?.НаименованиеПолное?.trim() ||
        org?.Description?.trim() ||
        "Організація",
      edrpou: org?.КодПоЕДРПОУ?.trim() || "",
    },
    counterparty: {
      name: "Внутрішній випуск",
      fullName: "Внутрішній випуск продукції",
      edrpou: "",
      inn: "",
    },
    contract: "",
    warehouse: warehouse?.Description?.trim() || "",
    lines,
  };
}
