/**
 * Канонічні доменні типи Операційної хронології (Field Operations Matrix).
 * Джерела: field_operations, inventory_local_moves, scouting_reports.
 */

export type UnifiedTimelineEventType = "equipment" | "inventory" | "scouting";

export type TimelineOperationStatus = "planned" | "in_progress" | "completed";

/** Погодний штамп з БД (weather_context JSONB). */
export type WeatherContext = {
  temp: number;
  humidity: number;
  condition: string;
  icon: string;
};

/** Презентаційна іконка для UI (не зберігається в БД). */
export type UnifiedTimelineIcon =
  | "tractor"
  | "package"
  | "flask"
  | "wheat"
  | "fuel"
  | "scout";

export type UnifiedTimelineEvent = {
  id: string;
  fieldId: string;
  date: Date;
  type: UnifiedTimelineEventType;
  title: string;
  subtitle: string;
  /** Відформатована метрика: «142 л», «5.2 т» — null якщо немає */
  metric: string | null;
  /** Загальна сума операції, ₴ (0 для скаутингу без витрат) */
  cost: number;
  imageUrl: string | null;
  notes: string | null;
  /** weather_context з БД; null якщо не збережено */
  weatherContext: WeatherContext | null;
  /** Статус наряду (лише для type === "equipment") */
  operationStatus?: TimelineOperationStatus | null;
};

export type FieldWithTimeline = {
  fieldId: string;
  fieldName: string;
  /** Площа поля, га */
  area: number;
  cropName: string;
  /** Колір лінії з паспорта поля (для метро-карти) */
  color: string;
  events: UnifiedTimelineEvent[];
  /** Сума cost усіх подій у видимому вікні */
  totalCost: number;
  /** totalCost / area, ₴/га */
  costPerHectare: number;
};

/** Скорочений вигляд поля для шторок CRUD (з FieldWithTimeline). */
export type FieldTimelineField = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
  color: string;
};

/** JSON з API: date серіалізується як ISO-рядок */
export type UnifiedTimelineEventWire = Omit<UnifiedTimelineEvent, "date"> & {
  date: string;
};

export type FieldWithTimelineWire = Omit<FieldWithTimeline, "events"> & {
  events: UnifiedTimelineEventWire[];
};

export function parseTimelineDate(value: string | Date): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }
  const trimmed = String(value).trim();
  const d = new Date(
    trimmed.length <= 10 ? `${trimmed.slice(0, 10)}T12:00:00` : trimmed
  );
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function timelineEventDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function reviveUnifiedTimelineEvent(
  wire: UnifiedTimelineEventWire
): UnifiedTimelineEvent {
  return {
    ...wire,
    date: parseTimelineDate(wire.date),
  };
}

export function reviveFieldWithTimeline(
  wire: FieldWithTimelineWire
): FieldWithTimeline {
  return {
    ...wire,
    events: wire.events.map(reviveUnifiedTimelineEvent),
  };
}

export function toTimelineField(item: FieldWithTimeline): FieldTimelineField {
  return {
    id: item.fieldId,
    name: item.fieldName,
    crop: item.cropName,
    areaHa: item.area,
    color: item.color,
  };
}

export function deriveTimelineIcon(
  event: UnifiedTimelineEvent
): UnifiedTimelineIcon {
  if (event.type === "equipment") return "tractor";
  if (event.type === "scouting") return "scout";
  if (event.subtitle === "Насіння") return "wheat";
  if (event.subtitle === "Добрива") return "flask";
  return "package";
}

export function isFutureTimelineOperation(event: UnifiedTimelineEvent): boolean {
  if (event.type !== "equipment") return false;
  if (
    event.operationStatus !== "planned" &&
    event.operationStatus !== "in_progress"
  )
    return false;
  // Якщо дата в минулому — це не «майбутня» операція, навіть якщо статус planned
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const eventDate =
    event.date instanceof Date ? event.date : new Date(event.date);
  return eventDate >= now;
}

export function timelineOperationStatusLabel(
  status: TimelineOperationStatus | null | undefined,
  date?: Date
): string | null {
  // Якщо дата в минулому — статус «заплановано/в роботі» більше не актуальний
  if (date) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = date instanceof Date ? date : new Date(date);
    if (d < now) return null;
  }
  if (status === "planned") return "Заплановано";
  if (status === "in_progress") return "В роботі";
  return null;
}

/** Прямий pass-through weather_context → weatherContext (без генерації). */
export function mapWeatherContext(
  value: WeatherContext | null | undefined
): WeatherContext | null {
  if (value == null) return null;
  return value;
}
