import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createLocalOutboundMove } from "@/app/admin/inventory/actions";
import { loadAgentInventoryStock } from "@/lib/agent-warehouse-stock";
import {
  buildInvoicePreview,
  executeWarehouseReceipt,
  rollbackWarehouseReceipt,
  INVOICE_CATEGORIES,
} from "@/lib/agent-warehouse-receipt";
import {
  buildServiceActPreview,
  deleteServiceActs,
  executeServiceActSave,
  SERVICE_ACT_CATEGORIES,
} from "@/lib/agent-service-act";
import { fetchLiveFieldEconomics } from "@/lib/field-analytics";
import { normalizeWorkTypeKey } from "@/lib/field-operation-wage";
import { resolveFieldCoordinates } from "@/lib/field-weather-context";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";
import { DEFAULT_SEASON, normalizeSeason } from "@/lib/season";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canAccessLevadius } from "@/lib/levadius-access";
import { getCurrentActor } from "@/lib/app-actor";
import {
  estimatePlanFuelLiters,
  estimatePlanWageUah,
  IMPLEMENT_PRESETS,
  OPERATION_TYPES,
  WAGE_UAH_PER_HA,
} from "@/lib/field-operation-norms";
import {
  evaluateFieldWeatherAdvisory,
  fetchWeatherWithHourly,
} from "@/lib/weather";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  estimateMaterialQty,
  operationRequiresMaterial,
} from "@/lib/operation-material-categories";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Flash only — без -pro. Thinking вимкнено через thinkingBudget: 0. */
const DEFAULT_MODEL = "gemini-3.7-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-3.6-flash"] as const;

/** Старі Flash, які Google вже не дає новим ключам — не підставляти навіть з env. */
const RETIRED_FLASH_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-flash-latest",
]);

/** Ковзне вікно історії для LLM (без системного — він окремо в system) */
const MAX_LLM_HISTORY_MESSAGES = 6;

/** Вимкнення reasoning/thinking (дорогі output-токени). AI SDK: thinkingBudget ≡ budgetTokens з ТЗ. */
const GOOGLE_NO_THINKING = {
  thinkingConfig: {
    thinkingBudget: 0,
    includeThoughts: false,
  },
} as const;

function isProModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id.includes("-pro") ||
    id.endsWith("/pro") ||
    /(^|[^a-z])pro([^a-z]|$)/.test(id)
  );
}

function isRetiredFlashModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase().replace(/^models\//, "");
  return RETIRED_FLASH_MODELS.has(id);
}

function resolveModelCandidates(): string[] {
  const primary =
    process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || DEFAULT_MODEL;
  const fromEnv = (process.env.GOOGLE_GENERATIVE_AI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fallbacks = fromEnv.length > 0 ? fromEnv : [...DEFAULT_FALLBACK_MODELS];
  const unique = [...new Set([primary, ...fallbacks])].filter(Boolean);
  const flashOnly = unique.filter((id) => !isProModelId(id));
  const active = flashOnly.filter((id) => !isRetiredFlashModelId(id));
  if (active.length < flashOnly.length) {
    console.warn(
      `[LEVADIUS] Відхилено застарілі Flash: ${flashOnly
        .filter((id) => isRetiredFlashModelId(id))
        .join(", ")}`
    );
  }
  if (active.length === 0) {
    console.warn(
      "[LEVADIUS] Немає валідних Flash → fallback на 3.7 / 3.6"
    );
    return [DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS];
  }
  if (active.length < unique.length) {
    const dropped = unique.filter((id) => !active.includes(id));
    if (dropped.some((id) => isProModelId(id))) {
      console.warn(
        `[LEVADIUS] Відхилено -pro моделі: ${dropped
          .filter((id) => isProModelId(id))
          .join(", ")}`
      );
    }
  }
  return active;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function isRetiredModelApiError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("no longer available") ||
    message.includes("update your code to use") ||
    message.includes("interactions api")
  );
}

function isCapacityError(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("high demand") ||
    message.includes("resource exhausted") ||
    message.includes("overloaded") ||
    message.includes("503") ||
    message.includes("429") ||
    /\bunavailable\b/.test(message) ||
    message.includes("model_not_found") ||
    (message.includes("model") && message.includes("not found"))
  );
}

/** 503 / retired model — пробуємо наступну з ланцюжка fallback. */
function isRetriableModelError(error: unknown): boolean {
  return isCapacityError(error) || isRetiredModelApiError(error);
}

function humanizeAgentError(error: unknown): string {
  if (isRetiredModelApiError(error)) {
    return "Модель Gemini застаріла в конфігу. Оновіть GOOGLE_GENERATIVE_AI_MODEL на gemini-3.7-flash.";
  }
  if (isCapacityError(error)) {
    return "Модель Google зараз перевантажена. Спробуй ще раз за кілька секунд.";
  }
  const message = errorText(error).trim();
  return message || "Помилка LEVADIUS";
}

const SYSTEM_PROMPT = `
Ти — LEVADIUS, розумний, досвідчений і уважний цифровий партнер господарства LEVADA.
Спілкуйся українською: вільно, впевнено, по-діловому і дружньо. Без канцеляриту
(«За оперативними даними…», «Доводимо до відома…») і без фамільярності.

Зона: агрономія, поля, техніка, паливо, склад, хронологія. Факти — лише з інструментів,
нічого не вигадуй. BAS тільки читання. Якщо даних бракує — одне чітке уточнення.

Доступні Tools (і тільки вони):
getFieldsStatus, getWarehouseStock, getFleetAndImplements, getDriversList,
getFieldWeather, getFieldOperationsHistory, getFieldCostAnalysis, updateFieldDetails,
writeOffInventoryToField, registerWarehouseItem,
previewInvoiceReceipt, executeWarehouseReceipt, rollbackWarehouseReceipt,
previewServiceAct, executeServiceActSave, deleteServiceActs,
prepareWorkOrder, confirmWorkOrder, deleteWorkOrder,
getOperationRates, setOperationRate,
logUnsupportedRequest, getUnhandledRequests.

Supabase (реальні таблиці — не вигадуй інших назв):
- поля: farm_fields
- техніка: equipment | причіпне: implements
- склад: inventory_items_cache | рухи: inventory_local_moves | накладні: warehouse_receipts
- матеріали нарядів: field_operation_materials
- тарифи ₴/га: work_type_wage_rates
- акти послуг: accounting_acts (+ equipment_expenses при привʼязці до техніки)

Anti-Mock Rule (СУВОРА ЗАБОРОНА ФЕЙКОВИХ ПРИКЛАДІВ):
- НІКОЛИ не вигадуй назви техніки (John Deere, Fendt тощо), знарядь, прізвища водіїв
  (Коваль, Бондар) чи назви препаратів/насіння.
- Усі кнопки [[CHOICE:…]] для техніки, знаряддя, водіїв і препаратів — ВИКЛЮЧНО з даних Tools.
- Якщо Tool повернув порожній список — прямо скажи:
  «У довіднику поки немає зареєстрованої техніки/водіїв. Напиши імʼя вручну»
  (або аналог для складу). Жодних вигаданих варіантів «для прикладу».

Anti-Hallucination (залізне правило):
- Жодних вигадок виконання. Якщо користувач просить дію, звіт чи процес,
  для якого немає відповідного Tool (дрон, 3D-експорт, списання ЗП без правил тощо) —
  СУВОРО заборонено вигадувати результат або стверджувати, що ти це вже зробив.
- Обовʼязкова реакція на непідтримуване: спочатку викликай logUnsupportedRequest
  (оригінальний запит + category + reason), потім відповідай користувачу.
- У відповіді ОБОВʼЯЗКОВО має бути фраза дослівно:
  «Повна халепа, такого я ще не вмію робити, але Назар навчить скоро!»
- Можна додати одне коротке речення:
  «Записав цей запит Назару в план прокачки.»
- Не вигадуй обхідні «я ніби зробив» — лише чесна відмова + лог у беклог.
- ВАЖЛИВО: технічна помилка існуючого Tool (confirmWorkOrder / prepareWorkOrder /
  getWarehouseStock / writeOffInventoryToField тощо) — це НЕ «не вмію». Не викликай
  logUnsupportedRequest. Поясни помилку коротко і запропонуй повторити.

ЗАБОРОНА ІМІТАЦІЇ СПИСАННЯ ТМЦ:
- ЗАБОРОНЕНО писати «списав», «оформив списання», «залишок оновлено», якщо НЕ було
  виклику writeOffInventoryToField з success:true.
- Без tool-результату — лише збір слотів і CHOICE, ніколи факт списання.

ЗАБОРОНА ІМІТАЦІЇ ЗМІН ПОЛЯ (залізне, без винятків):
- ЗАБОРОНЕНО стверджувати, що змінив назву, площу чи культуру поля, якщо НЕ було
  реального виклику updateFieldDetails і результат НЕ містить success:true / status:updated.
- Без tool-результату updated — НІКОЛИ не пиши «готово», «змінив», «оновив у базі»,
  «тепер поле називається…». Це галюцинація.
- Якщо tool повернув error / needs_slots — скажи про помилку, не імітуй успіх.

Беклог фіч (для Назара / власника):
Якщо запитують «Що ти ще не вмієш?», «Які запити висять у беклозі?»,
«Чому тебе навчити?» — викликай getUnhandledRequests і покажи структурований список
за категоріями, хто і що найчастіше просив. Додай [[CHOICE:…]] або
[[ACTION:REPLY|Sparkles|…]] для швидких уточнень.

Аудит тарифів ЗП (₴/га):
Коли питають про розцінки, ставки, «які операції без тарифу», «скільки платимо за га»:
1) Виклич getOperationRates.
2) Оформи два блоки:
   **Налаштовані тарифи** — кожен рядок: назва операції білим (**Операція**) і
   сума смарагдовим через markdown/цифри: **120 ₴/га**.
   Можна [row:tractor|Дискування|120 ₴/га].
   **Потребують встановлення ставки** — список без тарифу з [icon:alert] біля назви.
3) Проактивно: «Хочеш задати ставку для [перша з missing]? Напиши суму або обери нижче.»
   і [[CHOICE:Встановити для Дискування 120 ₴/га]] (реальні назви з missing + типові суми).
   Без [[ACTION:NAVIGATE|…]] — тарифи редагуються тут у чаті.
4) Коли користувач задає суму — setOperationRate, потім коротко підтверди нову цифру.

Погода по полю (як у картці поля: атмосфера + ґрунт):
Коли питають погоду / мікроклімат / вологість ґрунту по полю:
1) Виклич getFieldWeather (назва або ID; якщо поле в контексті — можна його).
2) Покажи не лише повітря й вітер, а й ґрунт:
   [row:mappin|Поле|…]
   Температура повітря, вітер, вологість повітря — жирні цифри.
   **T ґрунту (18 см)** і **волога ґрунту (3–9 см)** обовʼязково.
3) Якщо є advisory/попередження (напр. «Низька волога ґрунту») —
   підсвіти: [icon:alert] **Низька волога ґрунту** + короткий detail.
4) Дії (без зайвих NAVIGATE, хіба що користувач просить відкрити поле):
   [[CHOICE:Запланувати роботи на цьому полі]]
   [[CHOICE:Перевірити інші поля]]
5) Погодинний прогноз — коротко 3–6 найближчих годин, якщо релевантно.

Історія робіт / техніка на полі:
Коли питають «яка історія поля…», «що робили на Василисі», «яка техніка була в червні»:
1) Виклич getFieldOperationsHistory (fieldIdOrName + startDate/endDate або month).
2) Таймлайн: дата, тип робіт, техніка, агрегат, механізатор, ТМЦ, паливо (л).
3) Якщо питають лише про техніку — агрегуй унікальні трактори/обприскувачі + водіїв.
4) Дії: [[CHOICE:Собівартість цього поля]] [[CHOICE:Відкрити поле на карті]]
   і за потреби [[ACTION:NAVIGATE|/?field=UUID|MapPin|Відкрити поле]].

Собівартість поля:
Коли питають витрати / собівартість / «скільки вклали в поле» / ₴ на га:
1) Виклич getFieldCostAnalysis (season за замовчуванням 2026).
2) Лаконічно: **загальна сума ₴**, **₴/га**, частки **паливо / ТМЦ / ЗП** (% або ₴).
3) [row:…] для трьох статей. Якщо є unpricedMaterials — [icon:alert] без ціни.
4) [[CHOICE:Історія робіт по полю]] [[CHOICE:Відкрити поле на карті]].

Оновлення паспорта поля (updateFieldDetails — ОБОВʼЯЗКОВЕ підтвердження):
Будь-яка зміна назви / гектарів / культури — ТІЛЬКИ через 2 кроки. Примітки (notes) —
можна без confirmation.
Параметри: fieldIdOrName (або activeFieldId), newName, newCulture, newArea, confirmed.

Крок A (ДО запису в БД):
- Користувач: «Зміни назву на Василиха 22».
- Виклич updateFieldDetails з confirmed=false (отримаєш поточні значення з БД)
  АБО спитай після getFieldsStatus — але НЕ стверджуй успіх.
- Відповідь користувачу — короткий ЗАПИТ (не факт). UI намалює картку з кнопками —
  НЕ додавай [[CHOICE:Так, змінити…]] / [[CHOICE:Скасувати]] (дубль).
- Для площі/культури додатково [icon:alert] про вплив на норми палива / ТМЦ / ЗП.

Крок B (ПІСЛЯ «Так…» / «так» / «змінюй»):
- У чаті користувач надсилає лише короткий текст кнопки (без fieldId/confirmed у повідомленні).
- Ти сам підставляєш параметри з попереднього requires_confirmation: fieldId, pending.newName /
  newCulture / newArea і викликаєш updateFieldDetails з confirmed: true.
- Успіх лише якщо tool повернув success:true і updatedField — тоді підтверди
  фактичні значення з updatedField.
- «Скасувати» — без виклику tool: «Зміну скасовано, у базі нічого не чіпав.»
- Назва/площа/культура — НІКОЛИ без confirmed:true. Не вигадуй площу/назву.

Пряме списання ТМЦ на поле (writeOffInventoryToField — Slot Filling):
Коли кажуть «спиши добрива на Василиху», «спиши ЗЗР з поля 1.2», «селітру на поле»:
1) Поле: fieldIdOrName або activeFieldId. Якщо немає — уточни / getFieldsStatus.
2) Якщо товар не названо — getWarehouseStock(category) і одразу CHOICE з реальних залишків:
   «Яке добриво зі складу списуємо на **[Поле]**?»
   [[CHOICE:Карбамід (залишок 12 т)]]
   (назви й залишки ТІЛЬКИ з Tool, не вигадуй)
3) Якщо кількість не вказана — після вибору товару спитай:
   «Скільки **[кг/л/т]** списати на поле?»
4) Перед записом — коротке резюме і підтвердження:
   [[CHOICE:Підтвердити списання [Кількість] [Од.] на [Поле]]]
   [[CHOICE:Скасувати]]
5) ТІЛЬКИ після «Підтвердити…» виклич writeOffInventoryToField з confirmed:true,
   itemId=ref з getWarehouseStock, quantity, fieldIdOrName, category, date.
6) Успіх лише при success:true — покажи списану к-сть і новий залишок newStockBalance.
   Помилка залишку / tool — чесно скажи, не імітуй списання.

Формат відповіді:
1) Короткий підсумок по суті.
2) Структуровані факти (список/рядки), з акцентом на ключових цифрах.
3) Обовʼязково проактивна пропозиція наступного кроку (конкретна дія або допомога).
4) Інтерактив: за потреби 1–3 [[CHOICE:…]] або [[ACTION:REPLY|Icon|…]] по темі.
   Кнопку переходу [[ACTION:NAVIGATE|…]] — лише якщо вона реально доречна (див. нижче).

Типографіка (Markdown + теги):
- Звичайний текст — без зайвого форматування.
- Назви полів, заголовки блоків — жирним: **Поле 11.2**.
- Цифри, га, літри, кг — жирним: **78.9 га**, **6 890 л**.
- ЗАБОРОНЕНО будь-які емодзі. Лише SVG через [icon:назва]:
  wheat, fuel, warehouse, tractor, check, alert, mappin, calendar, filetext.

Рядки-картки для полів / залишків (замість «- …»):
Кожен пункт окремим рядком у форматі:
[row:mappin|Поле 11.2|78.9 га]
[row:fuel|ДТ цистерна №1|4 200 л]
[row:warehouse|Раундап|128 л]
Іконки row: mappin, wheat, fuel, warehouse, tractor, calendar.

Проактивність (головне правило):
Після фактів ніколи не замовкай — запропонуй логічний наступний крок.
Приклади тону:
- Кукурудза: «Найбільший масив — **Поле 11.2** (**78.9 га**). Хочеш глянемо витрати палива
  по ньому за останні операції чи сплануємо обробіток?»
- Паливо: «У цистернах зараз **6 890 л**, бензовоз порожній. Перевірити, кому з тракторів
  у полі завтра потрібна дозаправка?»

Кнопки в кінці (UI сам намалює; теги користувачу не пояснюй):
Перехід:
[[ACTION:NAVIGATE|/шлях|IconName|Текст кнопки]]
Швидка відповідь (клік надішле текст як новий запит):
[[ACTION:REPLY|IconName|Текст швидкої відповіді]]
Скасування чернетки наряду в чаті (без запису в БД):
[[ACTION:DISMISS_DRAFT]]

Контекстні NAVIGATE (залізне правило — не спамити переходами):
- НЕ додавай [[ACTION:NAVIGATE|…]] «про запас» і НЕ повторюй одну й ту саму
  «Відкрити Хронологію» / «Відкрити Склад» у кожній відповіді.
- Кнопку переходу став ТІЛЬКИ коли тема відповіді прямо про цей розділ
  АБО користувач явно хоче туди перейти.
- Відповідність теми → маршрут (максимум одна релевантна NAVIGATE):
  · паливо / цистерни / дозаправка → /fuel | Fuel | Перейти в Паливо
  · склад / ЗЗР / насіння / залишки ТМЦ → /inventory | Warehouse | Відкрити Склад
  · наряди / хронологія / план робіт (після збереження наряду) → /operations | Calendar | Відкрити Хронологію
  · конкретне поле / карта / погода / історія / собівартість поля → /?field=UUID | MapPin | Відкрити поле
    (завжди /?field=UUID, НЕ /fields?... — редірект губить параметр)
  · техніка / трактори / флот → /equipment | Tractor | Відкрити Техніку
- Якщо розмова про тарифи ₴/га, ставки, уточнення слотів наряду, беклог фіч —
  NAVIGATE НЕ потрібен. Давай лише [[CHOICE:…]] / текст.
- Краще 0 кнопок переходу, ніж недоречна.

Скасування / видалення нарядів:
1) Чернетка в чаті (картка ще не підтверджена): користувач каже «скасуй»,
   «не зберігай», «забудь цей наряд» — НЕ викликай deleteWorkOrder і не лізь у БД.
   Відповідь дослівно (плюс тег):
   [[ACTION:DISMISS_DRAFT]]
   Зрозумів, чернетку наряду скасовано. Нічого в історію не записував.
2) Вже збережений наряд: «видали наряд», «видали останній по полю X».
3) Займенники «цей», «той що створив», «щойно створений», «прибери його»,
   «видали цей»:
   - Переглянь історію tool-результатів і знайди останній workOrderId
     (з confirmWorkOrder або prepareWorkOrder).
   - Якщо workOrderId є — одразу deleteWorkOrder({ workOrderId }) без зайвих питань.
   - Якщо ID немає — deleteWorkOrder без ID (візьме останній наряд поточного
     користувача) або перепитай поле.
4) Після успішного deleteWorkOrder відповідай коротко:
   «Видалив щойно створений наряд [Назва операції] з бази Хронології ✓»
   (без емодзі-іконок окрім цього символу ✓ у цій фразі).
5) Якщо deleteWorkOrder повернув requires_confirmation — дочекайся кнопки в UI;
   після «Так, видалити наряд назавжди» виклич знову з тим workOrderId
   (і confirmed=true, якщо потрібно).

Після підтвердження наряду в UI / через confirmWorkOrder у результаті буде
workOrderId — запамʼятай його для подальшого «видали цей».

Choice Chips — коли ставиш запитання з обмеженим переліком відповідей
(вибір насіння/ЗЗР/добрива зі складу, техніки, дати, так/ні тощо):
- ОБОВʼЯЗКОВО сформуй кнопки варіантів ТІЛЬКИ з реальних даних Tools.
- Перед цим виклич відповідний інструмент і візьми 2–4 найрелевантніші позиції.
- Формат у кінці тексту (кожен варіант окремим рядком):
[[CHOICE:Текст варіанту]]
Приклад (назви мають бути з getWarehouseStock, НЕ з цього прикладу):
Яке ЗЗР беремо зі складу?
[[CHOICE:Сетар 375 SC (42 л)]]
[[CHOICE:Коннект SC (18 л)]]

Сценарій наряду «Підготувати наряд на внесення ЗЗР» (і подібні):
1) Уточни поле/дату якщо бракує; для ЗЗР/посіву/добрив спочатку виклич
   getWarehouseStock з потрібною категорією і покажи [[CHOICE:…]] лише з реальних позицій.
2) Після вибору препарату (або одразу для механічних робіт) виклич
   getFleetAndImplements + getDriversList і покажи кнопки лише з наших тракторів/
   обприскувачів/знарядь і реальних механізаторів.
3) Коли всі слоти зібрані — prepareWorkOrder.

Inline Upsert (розширення бази під час діалогу):
- Механізатор: якщо імʼя нове (немає в getDriversList) — НЕ блокуй. Прийми як є і скажи:
  «Зафіксував нового механізатора [Імʼя]. Після збереження наряду він автоматично
  закріпиться в системі.» Потім готуй наряд з цим імʼям.
- Препарат / насіння / добриво, якого немає на складі:
  СУВОРА ЗАБОРОНА: НЕ викликай registerWarehouseItem з initialStock=0 / нульовим
  залишком «просто щоб створити картку» без згоди на оприбуткування.
  Обовʼязкова відповідь (підстав реальну назву):
  «Позиції [Назва] ще немає в обліку складу. Щоб оприбуткувати її коректно,
  вкажи кількість і ціну або просто завантаж фото накладної (скріпка в полі вводу),
  і я внесу все сам.»
  Кнопки ОБОВʼЯЗКОВО:
  [[CHOICE:📷 Прикріпити накладну]]
  [[CHOICE:Ввести кількість вручну]]
  «📷 Прикріпити накладну» — фронтенд відкриє вибір фото/PDF; коли файл прийде
  в повідомленні — подякуй і скажи, що розпізнавання накладної підключаємо
  (поки можна попросити кількість+ціну вручну, якщо OCR ще недоступний).
  «Ввести кількість вручну» — спитай кількість і ціну ₴/од., потім
  registerWarehouseItem лише з initialStock > 0.
  ЗАБОРОНЕНО стверджувати «додав на склад», якщо tool не повернув created
  з initialStock > 0.

Розпізнавання документів (Smart Document Router + Gemini Vision):
Якщо в повідомленні є прикріплене фото/PDF документа — СПОЧАТКУ визнач тип:

A) Прибуткова накладна / ТМЦ (насіння, ЗЗР, добрива, пальне, запчастини, товари):
1) Витягни: постачальник (+ ЄДРПОУ), номер, дата, позиції
   (name, category∈ЗЗР|Добрива|Насіння|Паливо|Запчастини, quantity, unit,
   pricePerUnit, totalAmount).
2) ОБОВʼЯЗКОВО виклич previewInvoiceReceipt.
3) UI намалює складську картку з кнопкою оприбуткування. Правки текстом → знову
   previewInvoiceReceipt. НЕ дублюй [[CHOICE:Підтвердити…]] / [[CHOICE:Скасувати]].
4) Запис: кнопка в UI або executeWarehouseReceipt після явного підтвердження.
5) Паливо з накладної — не в ТМЦ (skipped); підкажи /fuel.
6) ЗАБОРОНЕНО «оприбутковано» без success:true / posted.
7) Після executeWarehouseReceipt запамʼятай receiptId (для rollback).

B) Акт здачі-прийняття робіт / послуг (Акт виконаних робіт, сервіс, логістика):
1) Витягни: actNumber, actDate (YYYY-MM-DD), contractorName, contractorEdrpou,
   services[] (name, quantity, unit, pricePerUnit, totalAmount),
   totalAmount, vatAmount (якщо видно), targetAssetHint (назва техніки з тексту,
   напр. «телескопічний навантажувач»), category
   ∈ Сервіс техніки|Логістика|Польові послуги|Адміністративні.
2) ОБОВʼЯЗКОВО виклич previewServiceAct (НЕ previewInvoiceReceipt).
3) UI покаже картку «Акт виконаних послуг» з кнопкою «Записати в Бухгалтерію».
   НЕ додавай [[CHOICE:Підтвердити…]] / [[CHOICE:Скасувати]] — кнопки вже на картці.
4) Запис також можливий через executeServiceActSave після явного підтвердження
   (linkEquipment=true якщо ремонт і знайдена техніка в equipment).
5) ЗАБОРОНЕНО «записано в бухгалтерію» без success:true / posted.

Скасування / видалення актів послуг (deleteServiceActs):
Якщо користувач пише: «Видали ті 2 акти», «Скасуй останній акт»,
«Прибери акт Нової Пошти», «Видали помилковий акт»:
1) Виклич deleteServiceActs БЕЗ confirmed (або confirmed=false).
   - «останній / останні N» → count=N (за замовчуванням 1).
   - Якщо в розмові є actId з executeServiceActSave / попереднього
     requires_confirmation — передай actIds.
   - За назвою контрагента («акт Нової Пошти») — contractorHint.
2) Tool поверне requires_confirmation зі списком acts / confirmChoice / cancelChoice.
3) Коротко опиши список у тексті. UI сам намалює червону картку з кнопками —
   НЕ додавай [[CHOICE:…]] / [[ACTION:REPLY|…]] для «Так, видалити…» / «Скасувати»
   (інакше кнопки задублюються).
4) Після «Так, видалити ці акти» — знову deleteServiceActs з тим самим
   actIds і confirmed: true. actIds бери ЛИШЕ з попереднього tool-результату.
5) «Скасувати» — нічого не міняй.
6) ЗАБОРОНЕНО стверджувати «видалено», якщо немає success:true / status:deleted.

Якщо тип неочевидний — одне уточнення з CHOICE:
[[CHOICE:Це накладна на склад (ТМЦ)]]
[[CHOICE:Це акт виконаних послуг]]

Скасування / видалення накладної (rollbackWarehouseReceipt):
Якщо користувач пише: «Видали ту накладну», «Скасуй останній прихід»,
«Це була помилкова накладна», «Анулюй накладну №…»:
1) Виклич rollbackWarehouseReceipt БЕЗ confirmed (або confirmed=false).
   - Якщо є receiptId з попереднього executeWarehouseReceipt у розмові — передай його.
   - Інакше можна invoiceNumber; якщо нічого — інструмент візьме останній posted.
2) Tool поверне requires_confirmation з userHint / items / shortageWarnings.
3) Коротко опиши наслідки. UI сам намалює червону картку з кнопками —
   НЕ додавай [[CHOICE:…]] для confirmChoice/cancelChoice (дубль кнопок).
4) Після кліку «Так, анулювати…» — знову rollbackWarehouseReceipt з тим самим
   receiptId (або invoiceNumber) і confirmed: true.
   receiptId бери ТІЛЬКИ з попереднього tool-результату requires_confirmation /
   executeWarehouseReceipt — НЕ проси користувача його писати і НЕ вставляй
   «(receiptId: …)» у відповідь/CHOICE.
5) «Залишити накладну» — нічого не змінюй, коротко підтверди.
6) ЗАБОРОНЕНО стверджувати «скасовано / видалено», якщо немає success:true /
   status:rolled_back.

IconName: Fuel, Tractor, Wheat, Warehouse, MapPin, AlertCircle, CheckCircle2, Calendar, ArrowUpRight, FileText, Sparkles.

Маршрути:
- /fuel | Fuel | Перейти в Паливо
- /inventory | Warehouse | Відкрити Склад
- /?field=UUID | MapPin | Відкрити поле
- / | MapPin | До карти полів
- /operations | Calendar | Відкрити Хронологію
- /equipment | Tractor | Відкрити Техніку
- /accounting | FileText | Відкрити Бухгалтерію

Створення нарядів / операцій (Slot Filling — залізне правило):
Базові обовʼязкові параметри: Поле, Тип операції, Дата, Техніка (equipmentId/назва), Механізатор.
- Суворо заборонено вигадувати техніку, механізатора чи ТМЦ або викликати prepareWorkOrder
  з порожніми/вигаданими значеннями.
- Якщо користувач назвав лише частину — НЕ викликай prepareWorkOrder. Коротко перепитай
  і додай [[CHOICE:…]] з реальними варіантами після getWarehouseStock /
  getFleetAndImplements / getDriversList.
  Приклад: «Зрозумів, готую внесення ЗЗР на полі Василиха 1 на завтра. Який трактор
  і хто за кермом?»
- Для операцій «Посів», «Внесення ЗЗР», «Внесення добрив» наявність складської позиції
  ОБОВʼЯЗКОВА. Якщо не вказана — getWarehouseStock + «Яку позицію зі складу списуємо
  під цю операцію?» з [[CHOICE:…]] лише з реальних позицій.
- Для суто механічних робіт (Оранка, Культивація, Дискування) складський матеріал НЕ вимагати.
- Знаряддя (implementId) — бажано, але не блокує, якщо користувач не назвав.
- Збирай параметри з усієї історії діалогу. Викликай prepareWorkOrder лише коли відомі всі
  обовʼязкові слоти для цього типу робіт.
- Якщо в контексті є activeFieldId і поле не назване — можна взяти його.
- Дата: «завтра»/«сьогодні»/«післязавтра» — ТІЛЬКИ за календарем з блоку «Поточний
  контекст» (Europe/Kyiv). Ніколи не вигадуй дату з памʼяті моделі.
  Час за замовчуванням 08:00–18:00.
- Після status=ready UI покаже картку. Не кажи «вже внесено», поки немає підтвердження в UI.
`.trim();

const userContextSchema = z
  .object({
    pathname: z.string().trim().max(500).optional(),
    activeFieldId: z.string().trim().max(100).nullish(),
    userName: z.string().trim().max(200).optional(),
    userRole: z.string().trim().max(100).optional(),
    client: z.enum(["pwa", "drawer"]).optional(),
  })
  .optional();

const uiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(z.record(z.string(), z.unknown())).optional(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
  })
  .passthrough();

const requestSchema = z
  .object({
    id: z.string().optional(),
    prompt: z.string().trim().min(1).max(20_000).optional(),
    messages: z.array(uiMessageSchema).min(1).max(100).optional(),
    userContext: userContextSchema,
  })
  .refine(
    (value) => value.prompt || (value.messages && value.messages.length > 0),
    {
      message: "Передайте prompt або messages",
    }
  );

const categoryAliases: Record<string, string> = {
  "ззр": "zzr",
  "засоби захисту рослин": "zzr",
  "zzr": "zzr",
  "добрива": "fertilizer",
  "добриво": "fertilizer",
  "fertilizer": "fertilizer",
  "насіння": "seed",
  "насиння": "seed",
  "seed": "seed",
  "паливо": "fuel",
  "пальне": "fuel",
  "fuel": "fuel",
  "врожай": "harvest",
  "harvest": "harvest",
  "запчастини": "parts",
  "parts": "parts",
};

const categoryLabels: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  fuel: "Паливо",
  harvest: "Врожай",
  parts: "Запчастини",
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCategory(value?: string): string | null | undefined {
  if (!value?.trim()) return undefined;
  return categoryAliases[value.trim().toLocaleLowerCase("uk-UA")] ?? null;
}

function serializeToolCalls(steps: unknown): unknown[] {
  if (!Array.isArray(steps)) return [];

  return steps.flatMap((step) => {
    if (!step || typeof step !== "object" || !("toolCalls" in step)) return [];
    const calls = (step as { toolCalls?: unknown }).toolCalls;
    return Array.isArray(calls) ? calls : [];
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type AgentFieldRow = {
  id: string;
  name: string | null;
  canonical_name: string | null;
  crop: string | null;
  area_ha: number | null;
  season?: string | null;
  notes?: string | null;
};

type ResolveAgentFieldResult =
  | { ok: true; field: AgentFieldRow; fieldName: string }
  | {
      ok: false;
      status: "needs_slots" | "field_not_found" | "ambiguous_field" | "error";
      error: string;
      candidates?: { id: string; name: string; areaHa?: number }[];
    };

function agentFieldDisplayName(field: AgentFieldRow): string {
  return (
    (field.canonical_name && field.canonical_name.trim()) ||
    field.name ||
    "Поле"
  );
}

async function resolveAgentFieldByLookup(
  supabase: SupabaseClient,
  lookupRaw: string,
  selectCols = "id, name, canonical_name, crop, area_ha, season"
): Promise<ResolveAgentFieldResult> {
  const lookup = lookupRaw.trim();
  if (!lookup) {
    return {
      ok: false,
      status: "needs_slots",
      error: "Вкажи назву або ID поля.",
    };
  }

  let field: AgentFieldRow | null = null;

  if (isUuid(lookup)) {
    const { data, error } = await supabase
      .from("farm_fields")
      .select(selectCols)
      .eq("id", lookup)
      .eq("is_field", true)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        status: "error",
        error: `Не вдалося знайти поле: ${error.message}`,
      };
    }
    field = (data as unknown as AgentFieldRow | null) ?? null;
  }

  if (!field) {
    const safe = lookup.replaceAll(",", " ");
    const { data: matches, error } = await supabase
      .from("farm_fields")
      .select(selectCols)
      .eq("is_field", true)
      .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
      .order("name")
      .limit(5);
    if (error) {
      return {
        ok: false,
        status: "error",
        error: `Не вдалося шукати поле: ${error.message}`,
      };
    }
    const rows = (matches ?? []) as unknown as AgentFieldRow[];
    if (rows.length === 0) {
      return {
        ok: false,
        status: "field_not_found",
        error: `Поле «${lookup}» не знайдено.`,
      };
    }
    const needle = lookup.toLocaleLowerCase("uk-UA");
    const exact = rows.find(
      (row) =>
        String(row.name ?? "").toLocaleLowerCase("uk-UA") === needle ||
        String(row.canonical_name ?? "").toLocaleLowerCase("uk-UA") === needle
    );
    if (rows.length > 1 && !exact) {
      return {
        ok: false,
        status: "ambiguous_field",
        error: `Знайдено кілька полів для «${lookup}». Уточни.`,
        candidates: rows.map((row) => ({
          id: row.id,
          name: agentFieldDisplayName(row),
          areaHa: finiteNumber(row.area_ha),
        })),
      };
    }
    field = exact ?? rows[0]!;
  }

  return {
    ok: true,
    field,
    fieldName: agentFieldDisplayName(field),
  };
}

function resolveHistoryDateRange(options: {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
}): { startDate: string | null; endDate: string | null; label: string | null } {
  const start = options.startDate?.trim().slice(0, 10) || null;
  const end = options.endDate?.trim().slice(0, 10) || null;
  if (start || end) {
    return {
      startDate: start,
      endDate: end,
      label:
        start && end
          ? `${start}…${end}`
          : start
            ? `з ${start}`
            : end
              ? `до ${end}`
              : null,
    };
  }

  const month = options.month;
  if (month != null && Number.isFinite(month) && month >= 1 && month <= 12) {
    const year =
      options.year && Number.isFinite(options.year)
        ? Math.trunc(options.year)
        : Number(DEFAULT_SEASON) || new Date().getFullYear();
    const mm = String(Math.trunc(month)).padStart(2, "0");
    const lastDay = new Date(year, Math.trunc(month), 0).getDate();
    const startDate = `${year}-${mm}-01`;
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
    return {
      startDate,
      endDate,
      label: `${mm}.${year}`,
    };
  }

  return { startDate: null, endDate: null, label: null };
}

async function applyFieldDetailsUpdate(
  supabase: SupabaseClient,
  resolved: { field: AgentFieldRow; fieldName: string },
  patchInput: {
    name?: string;
    culture?: string;
    area?: number;
    notes?: string;
  }
) {
  const patch: Record<string, unknown> = {};
  if (patchInput.name?.trim()) {
    const nextName = patchInput.name.trim();
    // UI показує canonical_name ?? name — оновлюємо обидва
    patch.name = nextName;
    patch.canonical_name = nextName;
  }
  if (patchInput.culture?.trim()) {
    patch.crop = patchInput.culture.trim();
  }
  if (
    patchInput.area != null &&
    Number.isFinite(patchInput.area) &&
    patchInput.area > 0
  ) {
    patch.area_ha = round2(patchInput.area);
  }
  if (patchInput.notes != null) {
    patch.notes = patchInput.notes.trim();
  }

  if (Object.keys(patch).length === 0) {
    return {
      success: false as const,
      status: "needs_slots" as const,
      error: "Немає валідних полів для оновлення.",
    };
  }

  const selectCols =
    "id, name, canonical_name, crop, area_ha, season, notes";

  const { data, error } = await supabase
    .from("farm_fields")
    .update(patch)
    .eq("id", resolved.field.id)
    .select(selectCols)
    .single();

  if (error) {
    if (
      (error.message?.includes("notes") || error.code === "42703") &&
      "notes" in patch
    ) {
      const { notes: _notes, ...withoutNotes } = patch;
      if (Object.keys(withoutNotes).length === 0) {
        return {
          success: false as const,
          status: "error" as const,
          error:
            "Колонка notes ще відсутня. Застосуй міграцію 061_farm_fields_notes.sql.",
        };
      }
      const retry = await supabase
        .from("farm_fields")
        .update(withoutNotes)
        .eq("id", resolved.field.id)
        .select("id, name, canonical_name, crop, area_ha, season")
        .single();
      if (retry.error) {
        return {
          success: false as const,
          status: "error" as const,
          error: `Не вдалося оновити поле: ${retry.error.message}`,
        };
      }
      const row = retry.data as unknown as AgentFieldRow;
      const area = finiteNumber(row.area_ha);
      const name =
        (row.canonical_name && row.canonical_name.trim()) ||
        row.name ||
        resolved.fieldName;
      return {
        success: true as const,
        status: "updated" as const,
        fieldId: row.id,
        fieldName: name,
        updatedField: {
          id: row.id,
          name,
          area,
          crop: row.crop,
        },
        warning:
          "Примітки не збережено — потрібна міграція 061_farm_fields_notes.sql",
        openFieldPath: `/?field=${row.id}`,
      };
    }
    return {
      success: false as const,
      status: "error" as const,
      error: `Не вдалося оновити поле: ${error.message}`,
    };
  }

  const row = data as unknown as AgentFieldRow;
  const area = finiteNumber(row.area_ha);
  const name =
    (row.canonical_name && row.canonical_name.trim()) ||
    row.name ||
    resolved.fieldName;
  return {
    success: true as const,
    status: "updated" as const,
    fieldId: row.id,
    fieldName: name,
    updatedField: {
      id: row.id,
      name,
      area,
      crop: row.crop,
    },
    openFieldPath: `/?field=${row.id}`,
  };
}

const WORK_ORDER_TYPES = [
  "Посів",
  "Оранка",
  "Культивація",
  "Дискування",
  "Внесення ЗЗР",
  "Внесення добрив",
  "Збирання",
] as const;

type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

function normalizeWorkOrderType(raw: string): WorkOrderType | null {
  const value = raw.trim().toLocaleLowerCase("uk-UA");
  if (!value) return null;
  if (value.includes("посів")) return "Посів";
  if (value.includes("оран")) return "Оранка";
  if (value.includes("культив")) return "Культивація";
  if (value.includes("диск")) return "Дискування";
  if (value.includes("ззр") || value.includes("захист")) return "Внесення ЗЗР";
  if (value.includes("добрив")) return "Внесення добрив";
  if (value.includes("збир") || value.includes("жнив")) return "Збирання";
  const exact = WORK_ORDER_TYPES.find(
    (item) => item.toLocaleLowerCase("uk-UA") === value
  );
  return exact ?? null;
}

function formatUkLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

function resolveWorkOrderDateInput(raw: string): {
  date: string;
  resolvedFrom?: string;
} | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Не вказано дату" };

  const today = todayKyivYmd();
  const lower = value.toLocaleLowerCase("uk-UA");

  if (
    lower === "сьогодні" ||
    lower === "сегодня" ||
    lower === "today"
  ) {
    return { date: today, resolvedFrom: value };
  }
  if (lower === "завтра" || lower === "tomorrow") {
    return { date: shiftKyivYmd(today, 1), resolvedFrom: value };
  }
  if (
    lower === "післязавтра" ||
    lower === "послезавтра" ||
    lower === "day after tomorrow"
  ) {
    return { date: shiftKyivYmd(today, 2), resolvedFrom: value };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: value };
  }

  return {
    error: `Некоректна дата «${value}». Передай YYYY-MM-DD або «сьогодні»/«завтра».`,
  };
}

function uiMessagesHaveFileAttachment(messages: unknown[]): boolean {
  return extractLastUserFileAttachments(messages).length > 0;
}

/** Усі файли з останнього user-повідомлення (скани актів/накладних). */
function extractLastUserFileAttachments(messages: unknown[]): Array<{
  fileName: string;
  mimeType: string;
  base64: string;
}> {
  const out: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: unknown }).role !== "user") continue;
    const parts = (message as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const row = part as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type : "";
      if (type !== "file" && type !== "image") continue;

      const mimeType =
        (typeof row.mediaType === "string" && row.mediaType) ||
        (typeof row.mimeType === "string" && row.mimeType) ||
        "image/jpeg";
      const fileName =
        (typeof row.filename === "string" && row.filename) ||
        (typeof row.name === "string" && row.name) ||
        (mimeType.includes("pdf") ? "document.pdf" : "document.jpg");

      let base64: string | null = null;
      const url = typeof row.url === "string" ? row.url : null;
      const data = typeof row.data === "string" ? row.data : null;

      if (url?.startsWith("data:")) {
        const comma = url.indexOf(",");
        if (comma >= 0) base64 = url.slice(comma + 1);
      } else if (data?.startsWith("data:")) {
        const comma = data.indexOf(",");
        if (comma >= 0) base64 = data.slice(comma + 1);
      } else if (data && data.length > 80) {
        base64 = data.replace(/\s+/g, "");
      }

      if (!base64) continue;
      out.push({ fileName, mimeType, base64 });
    }

    if (out.length > 0) return out;
  }
  return out;
}

function isHeavyMediaPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const row = part as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "file" || type === "image") return true;
  if (typeof row.data === "string" && row.data.length > 500) {
    // data:image… / base64 blobs
    if (
      row.data.startsWith("data:") ||
      (/^[A-Za-z0-9+/=\s]+$/.test(row.data.slice(0, 80)) &&
        row.data.length > 2_000)
    ) {
      return true;
    }
  }
  if (typeof row.url === "string" && row.url.startsWith("data:")) return true;
  return false;
}

function countHeavyItems(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.length;
}

function compactHeavyToolOutput(
  output: unknown,
  toolName: string
): unknown {
  if (!output || typeof output !== "object") return output;
  const row = output as Record<string, unknown>;

  // Великі списки складу / флоту / полів / історії → компактний статус
  const arrayKeys = [
    "stock",
    "inventory",
    "fuel",
    "fields",
    "selfPropelled",
    "implements",
    "drivers",
    "operations",
    "configured",
    "missing",
    "items",
    "services",
    "recent",
    "candidates",
    "equipmentCandidates",
  ] as const;

  let totalItems = 0;
  let hadHeavyArray = false;
  const compact: Record<string, unknown> = {
    success: true,
    status: "loaded",
  };

  for (const key of arrayKeys) {
    if (!(key in row)) continue;
    const n = countHeavyItems(row[key]);
    if (n >= 3 || (Array.isArray(row[key]) && JSON.stringify(row[key]).length > 400)) {
      hadHeavyArray = true;
      totalItems += n;
    }
  }

  // Також якщо весь output великий
  const raw = JSON.stringify(output);
  if (!hadHeavyArray && raw.length <= 500) {
    return output;
  }

  if (hadHeavyArray || raw.length > 500) {
    // Зберігаємо критичні скаляри для підтверджень
    for (const key of [
      "status",
      "success",
      "error",
      "receiptId",
      "actId",
      "actIds",
      "fieldId",
      "fieldName",
      "confirmChoice",
      "cancelChoice",
      "userHint",
      "warning",
      "message",
      "invoiceNumber",
      "supplier",
      "contractorName",
      "totalAmount",
      "deletedCount",
      "count",
      "fieldCount",
      "empty",
      "emptyHint",
    ] as const) {
      if (key in row && row[key] != null && typeof row[key] !== "object") {
        compact[key] = row[key];
      }
    }
    if (typeof row.status === "string") compact.status = row.status;
    compact.count =
      totalItems ||
      (typeof row.count === "number" ? row.count : undefined) ||
      (typeof row.fieldCount === "number" ? row.fieldCount : undefined) ||
      Math.max(0, Math.round(raw.length / 80));
    compact.tool = toolName;
    compact.note = "Повний список скорочено (історія діалогу).";
    return compact;
  }

  return output;
}

function slimHistoricToolPart(part: Record<string, unknown>): Record<string, unknown> {
  const next = { ...part };
  const toolName =
    typeof next.toolName === "string"
      ? next.toolName
      : typeof next.type === "string"
        ? next.type.replace(/^tool-/, "")
        : "tool";

  if ("output" in next && next.output != null) {
    next.output = compactHeavyToolOutput(next.output, toolName);
  }
  if ("input" in next && next.input != null) {
    const raw = JSON.stringify(next.input);
    if (raw.length > 300) {
      next.input = { success: true, status: "loaded", count: 1 };
    }
  }
  return next;
}

/**
 * Перед LLM: slice(-6) + без старих PDF/фото + компактні tool-result.
 * Останнє повідомлення лишається з вкладеннями (Vision).
 */
function sanitizeUiMessagesForLlm(messages: UIMessage[]): UIMessage[] {
  const trimmedMessages = messages.slice(-MAX_LLM_HISTORY_MESSAGES);
  const lastIndex = trimmedMessages.length - 1;

  return trimmedMessages.map((message, index) => {
    if (index === lastIndex) return message;

    const parts = Array.isArray(message.parts) ? message.parts : [];
    let strippedFiles = 0;
    const nextParts: UIMessage["parts"] = [];

    for (const part of parts) {
      if (isHeavyMediaPart(part)) {
        strippedFiles += 1;
        continue;
      }
      if (part && typeof part === "object") {
        const row = part as Record<string, unknown>;
        const type = typeof row.type === "string" ? row.type : "";
        if (type === "dynamic-tool" || type.startsWith("tool-")) {
          nextParts.push(
            slimHistoricToolPart(row) as UIMessage["parts"][number]
          );
          continue;
        }
      }
      nextParts.push(part);
    }

    if (strippedFiles > 0) {
      nextParts.unshift({
        type: "text",
        text: `[Раніше прикріплено файл(и): ${strippedFiles}. Вміст не передається повторно.]`,
      } as UIMessage["parts"][number]);
    }

    const cleaned = { ...message, parts: nextParts } as UIMessage & {
      experimental_attachments?: unknown;
    };
    if ("experimental_attachments" in cleaned) {
      delete cleaned.experimental_attachments;
    }
    return cleaned;
  });
}

const DOCUMENT_VISION_PROMPT = `
РЕЖИМ ДОКУМЕНТА (фото/PDF у повідомленні) — Smart Document Router:
1) Визнач тип документа з вмісту (не з назви файлу):
   - Накладна / рахунок / товарний чек з ТМЦ (насіння, ЗЗР, добрива, пальне, товари)
     → виклич previewInvoiceReceipt (supplierName, supplierEdrpou, invoiceNumber,
       invoiceDate YYYY-MM-DD, items[], totalAmount).
   - Акт здачі-прийняття робіт / акт виконаних послуг / сервісний акт
     → виклич previewServiceAct (actNumber, actDate YYYY-MM-DD, contractorName,
       contractorEdrpou, services[], totalAmount, vatAmount, category
       ∈ Сервіс техніки|Логістика|Польові послуги|Адміністративні,
       targetAssetHint якщо згадана техніка).
2) Не вигадуй рядків, яких немає на документі.
3) Після tool — коротка фраза українською; картку малює UI.
4) Не стверджуй, що вже збережено, поки немає execute* / кнопки в картці.
`.trim();

function buildSystemPrompt(
  userContext?: {
    pathname?: string;
    activeFieldId?: string | null;
    userName?: string;
    userRole?: string;
  },
  options?: { hasInvoiceAttachment?: boolean }
): string {
  const today = todayKyivYmd();
  const tomorrow = shiftKyivYmd(today, 1);
  const dayAfter = shiftKyivYmd(today, 2);

  const contextBlock = [
    "Поточний контекст користувача:",
    `Сторінка: ${userContext?.pathname?.trim() || "невідомо"}`,
    `Обране поле ID: ${userContext?.activeFieldId?.trim() || "не обрано"}`,
    userContext?.userName ? `Імʼя: ${userContext.userName}` : null,
    userContext?.userRole ? `Роль: ${userContext.userRole}` : null,
    "Якщо поле вже обране в контексті, використовуй його за замовчуванням.",
    "",
    "Календар господарства (Europe/Kyiv) — джерело правди для дат:",
    `Сьогодні: ${today} (${formatUkLongDate(today)})`,
    `Завтра: ${tomorrow} (${formatUkLongDate(tomorrow)})`,
    `Післязавтра: ${dayAfter} (${formatUkLongDate(dayAfter)})`,
    "«завтра» у запиті = рівно дата Завтра вище. Не підставляй інших місяців/років.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const visionBlock = options?.hasInvoiceAttachment
    ? `\n\n${DOCUMENT_VISION_PROMPT}`
    : "";

  return `${SYSTEM_PROMPT}\n\n${contextBlock}${visionBlock}`;
}

function extractPromptText(messages: unknown[]): string {
  const lastUserMessage = messages
    .filter((m) => {
      if (!m || typeof m !== "object") return false;
      return (m as { role?: unknown }).role === "user";
    })
    .pop() as
    | {
        content?: unknown;
        parts?: unknown;
      }
    | undefined;

  if (!lastUserMessage) return "Запит без тексту";

  if (typeof lastUserMessage.content === "string") {
    const text = lastUserMessage.content.trim();
    return text || "Запит без тексту";
  }

  if (Array.isArray(lastUserMessage.content)) {
    const text = lastUserMessage.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ")
      .trim();
    return text || "Запит без тексту";
  }

  if (Array.isArray(lastUserMessage.parts)) {
    const text = lastUserMessage.parts
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text"
        ) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ")
      .trim();
    return text || "Запит без тексту";
  }

  return "Запит без тексту";
}

async function writeAgentLog(input: {
  userId: string;
  request: unknown;
  prompt: string;
  response: string | null;
  toolCalls: unknown[];
  finishReason: string | null;
  status: "completed" | "failed";
  model: string;
  error?: string | null;
}) {
  try {
    const supabase = createServiceSupabase();
    const promptText = input.prompt.trim() || "Запит без тексту";
    const { error } = await supabase.from("ai_agent_logs").insert({
      user_id: input.userId,
      prompt: promptText,
      input_request: input.request,
      output_response: input.response,
      tool_calls: input.toolCalls,
      model: input.model,
      finish_reason: input.finishReason,
      status: input.status,
      error: input.error ?? null,
    });

    if (error) {
      console.error("Помилка збереження логу LEVADIUS:", error.message);
    }
  } catch (error) {
    console.error(
      "Помилка збереження логу LEVADIUS:",
      error instanceof Error ? error.message : error
    );
  }
}

function createAgentTools(options?: {
  activeFieldId?: string | null;
  userId?: string | null;
  userName?: string | null;
  documentAttachment?: {
    fileName: string;
    mimeType: string;
    base64: string;
  } | null;
  documentAttachments?: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> | null;
}) {
  const supabase = createServiceSupabase();
  const defaultFieldId = options?.activeFieldId?.trim() || null;
  const actorUserId = options?.userId?.trim() || null;
  const actorName =
    options?.userName?.trim() || "Невідомий";
  const documentAttachments = (
    options?.documentAttachments?.length
      ? options.documentAttachments
      : options?.documentAttachment
        ? [options.documentAttachment]
        : []
  ).filter((d) => d?.base64);

  async function attachDocumentsToEntity(
    entityType: "inventory_move" | "fuel_transaction" | "accounting_act",
    entityId: string
  ) {
    if (documentAttachments.length === 0 || !entityId) return;
    try {
      const {
        countAttachments,
        uploadOperationAttachment,
        MAX_ATTACHMENTS_PER_ENTITY,
      } = await import("@/lib/operation-attachments");
      for (const doc of documentAttachments) {
        const existing = await countAttachments(entityType, entityId);
        if (existing >= MAX_ATTACHMENTS_PER_ENTITY) break;
        const bytes = Buffer.from(doc.base64, "base64");
        await uploadOperationAttachment({
          entityType,
          entityId,
          fileName: doc.fileName || "document.jpg",
          mimeType: doc.mimeType || "image/jpeg",
          bytes,
        });
      }
    } catch (err) {
      console.error(`[LEVADIUS] attach ${entityType}`, err);
    }
  }

  const unhandledCategories = [
    "fields",
    "equipment",
    "fuel",
    "warehouse",
    "finance",
    "accounting",
    "other",
  ] as const;

  const unhandledCategoryLabels: Record<
    (typeof unhandledCategories)[number],
    string
  > = {
    fields: "Поля",
    equipment: "Техніка",
    fuel: "Паливо",
    warehouse: "Склад",
    finance: "Фінанси",
    accounting: "Бухгалтерія",
    other: "Інше",
  };

  return {
    getFieldsStatus: tool({
      description: "Читає стан полів (площа, культура, остання операція).",
      inputSchema: z.object({
        crop: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Необов'язкова назва культури, наприклад Кукурудза"),
      }),
      execute: async ({ crop }) => {
        let fieldsQuery = supabase
          .from("farm_fields")
          .select("id, name, canonical_name, area_ha, crop, season")
          .eq("is_field", true)
          .order("name")
          .limit(120);

        if (crop) {
          fieldsQuery = fieldsQuery.ilike("crop", `%${crop.trim()}%`);
        }

        const { data: fields, error: fieldsError } = await fieldsQuery;
        if (fieldsError) {
          throw new Error(`Не вдалося прочитати поля: ${fieldsError.message}`);
        }

        const fieldRows = fields ?? [];
        const fieldIds = fieldRows.map((field) => String(field.id));
        const latestByField = new Map<string, Record<string, unknown>>();

        if (fieldIds.length > 0) {
          const { data: operations, error: operationsError } = await supabase
            .from("field_operations")
            .select("field_id, work_type, status, occurred_at")
            .in("field_id", fieldIds)
            .order("occurred_at", { ascending: false })
            .limit(800);

          if (operationsError) {
            throw new Error(
              `Не вдалося прочитати операції полів: ${operationsError.message}`
            );
          }

          for (const operation of operations ?? []) {
            const fieldId = String(operation.field_id ?? "");
            if (fieldId && !latestByField.has(fieldId)) {
              latestByField.set(
                fieldId,
                operation as Record<string, unknown>
              );
            }
          }
        }

        const result = fieldRows.map((field) => {
          const latest = latestByField.get(String(field.id));
          const displayName =
            (typeof field.canonical_name === "string" &&
              field.canonical_name.trim()) ||
            String(field.name ?? "Поле");
          return {
            id: field.id,
            name: displayName,
            areaHa: finiteNumber(field.area_ha),
            crop: field.crop || "Не вказано",
            season: field.season,
            lastOp: latest
              ? {
                  type: latest.work_type,
                  status: latest.status,
                  date: latest.occurred_at,
                }
              : null,
          };
        });

        return {
          fieldCount: result.length,
          totalAreaHa: round2(
            result.reduce((sum, field) => sum + field.areaHa, 0)
          ),
          fields: result,
        };
      },
    }),

    getWarehouseStock: tool({
      description: "Читає залишки складу та палива.",
      inputSchema: z.object({
        category: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("ЗЗР, Добрива, Паливо, Насіння, Врожай або Запчастини"),
        includeZero: z
          .boolean()
          .optional()
          .describe(
            "Якщо true — також позиції з нульовим залишком (за замовчуванням лише > 0)"
          ),
      }),
      execute: async ({ category, includeZero }) => {
        console.log("[TOOL: getWarehouseStock] Start fetching stock...", {
          category,
          includeZero,
        });

        try {
          const normalizedCategory = normalizeCategory(category);
          if (normalizedCategory === null) {
            return {
              stock: [],
              error: `Невідома категорія «${category}»`,
              supportedCategories: Object.values(categoryLabels),
            };
          }

          const includeFuel =
            normalizedCategory === undefined || normalizedCategory === "fuel";
          const inventoryCategory =
            normalizedCategory && normalizedCategory !== "fuel"
              ? normalizedCategory
              : undefined;
          const includeInventory = normalizedCategory !== "fuel";

          const fuelPromise = includeFuel
            ? supabase
                .from("fuel_storages")
                .select("id, name, type, capacity, current_volume")
                .order("name")
            : Promise.resolve({ data: [] as const, error: null });

          const [fuelResult, inventoryResult] = await Promise.all([
            fuelPromise,
            includeInventory
              ? loadAgentInventoryStock({
                  categoryKey: inventoryCategory,
                  includeZero: includeZero === true,
                  limit: 40,
                })
              : Promise.resolve({
                  items: [],
                  basOk: true,
                  dataQualityNote: "",
                } satisfies Awaited<
                  ReturnType<typeof loadAgentInventoryStock>
                >),
          ]);

          if (fuelResult.error) {
            console.error(
              "[TOOL: getWarehouseStock] Fuel query error:",
              fuelResult.error.message
            );
            return {
              stock: [],
              error: `Не вдалося прочитати паливні сховища: ${fuelResult.error.message}`,
            };
          }
          if ("error" in inventoryResult && inventoryResult.error) {
            console.error(
              "[TOOL: getWarehouseStock] Inventory error:",
              inventoryResult.error
            );
            return {
              stock: [],
              error: inventoryResult.error,
            };
          }

          const inventory = inventoryResult.items.map((item) => ({
            ref: item.ref,
            name: item.name,
            cat: item.category,
            unit: item.unit,
            qty: item.quantity,
          }));

          const fuel = (fuelResult.data ?? []).map((storage) => ({
            id: storage.id,
            name: storage.name,
            cat: categoryLabels.fuel,
            unit: "л",
            qty: finiteNumber(storage.current_volume),
          }));

          const stock = [...inventory, ...fuel];
          console.log(
            "[TOOL: getWarehouseStock] Success, items found:",
            stock.length,
            "basOk=",
            inventoryResult.basOk
          );

          return {
            stock,
            empty: stock.length === 0,
            emptyHint:
              stock.length === 0
                ? inventoryCategory
                  ? `Немає позицій «${categoryLabels[inventoryCategory]}» із залишком.`
                  : "Залишків не знайдено."
                : null,
          };
        } catch (error) {
          console.error(
            "[TOOL: getWarehouseStock] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            stock: [],
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання складу",
          };
        }
      },
    }),

    getFleetAndImplements: tool({
      description: "Читає техніку (equipment) і знаряддя (implements).",
      inputSchema: z.object({
        kind: z
          .enum(["all", "self_propelled", "implements"])
          .optional()
          .default("all")
          .describe(
            "all | self_propelled (трактори/комбайни/обприскувачі) | implements (причіпне)"
          ),
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Необовʼязковий пошук за назвою"),
      }),
      execute: async ({ kind, query }) => {
        const mode = kind ?? "all";
        console.log("[TOOL: getFleetAndImplements]", { mode, query });

        const typeLabels: Record<string, string> = {
          tractor: "Трактор",
          combine: "Комбайн",
          harvester: "Комбайн",
          sprayer: "Обприскувач",
          loader: "Навантажувач",
          truck: "Вантажівка",
          car: "Автомобіль",
          seeder: "Сівалка",
          plow: "Плуг",
          harrow: "Борона / диски",
          header: "Жатка",
          cultivator: "Культиватор",
          spreader: "Розкидач",
          compactor: "Коток",
          other: "Інше",
        };

        try {
          const q = query?.trim();
          const wantSelf = mode === "all" || mode === "self_propelled";
          const wantImpl = mode === "all" || mode === "implements";

          let equipmentQuery = supabase
            .from("equipment")
            .select("id, name, type, is_active, wialon_id")
            .order("name")
            .limit(80);
          if (q) equipmentQuery = equipmentQuery.ilike("name", `%${q}%`);

          let implementsQuery = supabase
            .from("implements")
            .select("id, name, type, working_width_m")
            .order("name")
            .limit(80);
          if (q) implementsQuery = implementsQuery.ilike("name", `%${q}%`);

          const [equipmentResult, implementsResult, activeOpsResult] =
            await Promise.all([
              wantSelf
                ? equipmentQuery
                : Promise.resolve({ data: [] as const, error: null }),
              wantImpl
                ? implementsQuery
                : Promise.resolve({ data: [] as const, error: null }),
              supabase
                .from("field_operations")
                .select("equipment_id, machinery, status")
                .in("status", ["planned", "in_progress"])
                .limit(500),
            ]);

          if (equipmentResult.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати техніку: ${equipmentResult.error.message}`,
              selfPropelled: [],
              implements: [],
            };
          }
          if (implementsResult.error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати знаряддя: ${implementsResult.error.message}`,
              selfPropelled: [],
              implements: [],
            };
          }

          const busyEquipmentIds = new Set<string>();
          for (const op of activeOpsResult.data ?? []) {
            if (op.equipment_id) {
              busyEquipmentIds.add(String(op.equipment_id));
            }
          }

          const selfPropelled = (equipmentResult.data ?? [])
            .filter((row) => row.is_active !== false)
            .map((row) => {
              const id = String(row.id);
              const busy = busyEquipmentIds.has(id);
              const type = String(row.type ?? "other");
              return {
                id,
                name: String(row.name ?? "").trim() || "Техніка",
                type,
                typeLabel: typeLabels[type] ?? type,
                status: busy ? ("busy" as const) : ("available" as const),
              };
            });

          const implementsList = (implementsResult.data ?? []).map((row) => {
            const type = String(row.type ?? "other");
            return {
              id: String(row.id),
              name: String(row.name ?? "").trim() || "Знаряддя",
              type,
              typeLabel: typeLabels[type] ?? type,
              widthM: finiteNumber(row.working_width_m) || null,
            };
          });

          const empty =
            selfPropelled.length === 0 && implementsList.length === 0;

          return {
            status: "ok" as const,
            empty,
            emptyHint: empty
              ? "У довіднику немає техніки/знаряддя. Напиши назву вручну."
              : null,
            selfPropelled,
            implements: implementsList,
            counts: {
              self: selfPropelled.length,
              impl: implementsList.length,
              free: selfPropelled.filter((item) => item.status === "available")
                .length,
            },
          };
        } catch (error) {
          console.error(
            "[TOOL: getFleetAndImplements] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання техніки",
            selfPropelled: [],
            implements: [],
          };
        }
      },
    }),

    getDriversList: tool({
      description: "Читає список механізаторів.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Необовʼязковий пошук за ПІБ"),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Скільки імен повернути"),
      }),
      execute: async ({ query, limit }) => {
        const take = limit ?? 20;
        console.log("[TOOL: getDriversList]", { query, take });
        try {
          let opsQuery = supabase
            .from("field_operations")
            .select("mechanic_name")
            .not("mechanic_name", "is", null)
            .order("occurred_at", { ascending: false })
            .limit(2_000);

          if (query?.trim()) {
            opsQuery = opsQuery.ilike("mechanic_name", `%${query.trim()}%`);
          }

          const { data, error } = await opsQuery;
          if (error) {
            if (
              error.message?.includes("mechanic_name") ||
              error.code === "42703"
            ) {
              return {
                status: "ok" as const,
                drivers: [],
                empty: true,
                emptyHint:
                  "У довіднику поки немає зареєстрованих водіїв. Напиши імʼя вручну.",
              };
            }
            return {
              status: "error" as const,
              error: `Не вдалося прочитати механізаторів: ${error.message}`,
              drivers: [],
            };
          }

          const counts = new Map<string, { name: string; count: number }>();
          for (const row of data ?? []) {
            const name = String(row.mechanic_name ?? "").trim();
            if (!name) continue;
            const key = name.toLocaleLowerCase("uk-UA");
            const prev = counts.get(key);
            if (prev) prev.count += 1;
            else counts.set(key, { name, count: 1 });
          }

          const drivers = [...counts.values()]
            .sort(
              (a, b) =>
                b.count - a.count || a.name.localeCompare(b.name, "uk")
            )
            .slice(0, take)
            .map((item) => ({
              name: item.name,
              operationsCount: item.count,
            }));

          return {
            status: "ok" as const,
            drivers,
            empty: drivers.length === 0,
            emptyHint:
              drivers.length === 0
                ? "У довіднику поки немає зареєстрованих водіїв. Напиши імʼя вручну."
                : null,
          };
        } catch (error) {
          console.error(
            "[TOOL: getDriversList] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання механізаторів",
            drivers: [],
          };
        }
      },
    }),

    registerWarehouseItem: tool({
      description: "Реєструє нову позицію складу з початковим залишком > 0.",
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe("Повна назва препарату/матеріалу"),
        category: z
          .enum(["ЗЗР", "Добрива", "Насіння", "Паливо", "Інше"])
          .optional()
          .default("ЗЗР")
          .describe("Категорія номенклатури"),
        unit: z
          .enum(["л", "кг", "т", "п.о.", "шт"])
          .optional()
          .default("л")
          .describe("Одиниця виміру"),
        initialStock: z
          .number()
          .finite()
          .positive()
          .describe(
            "Початковий залишок на складі (обовʼязково > 0; нуль заборонено)"
          ),
      }),
      execute: async ({ name, category, unit, initialStock }) => {
        const displayName = name.trim();
        const categoryUk = category ?? "ЗЗР";
        const unitValue = unit ?? "л";
        const stock = initialStock ?? 0;

        const categoryMap: Record<
          "ЗЗР" | "Добрива" | "Насіння" | "Паливо" | "Інше",
          "zzr" | "fertilizer" | "seed" | "parts"
        > = {
          ЗЗР: "zzr",
          Добрива: "fertilizer",
          Насіння: "seed",
          Паливо: "parts",
          Інше: "parts",
        };
        const categoryKey = categoryMap[categoryUk];

        console.log("[TOOL: registerWarehouseItem]", {
          displayName,
          categoryUk,
          unitValue,
          stock,
        });

        if (!(stock > 0)) {
          return {
            status: "needs_inbound" as const,
            success: false as const,
            error:
              "Не можна створити картку з нульовим залишком. Потрібні кількість і ціна або фото накладної.",
            itemName: displayName,
            category: categoryUk,
            hint: "Запропонуй [[CHOICE:📷 Прикріпити накладну]] або [[CHOICE:Ввести кількість вручну]].",
          };
        }

        try {
          const basRefKey = crypto.randomUUID();
          const payload: Record<string, unknown> = {
            bas_ref_key: basRefKey,
            name: displayName,
            category: categoryKey,
            unit: unitValue,
            planned_price_uah: 0,
            is_local: true,
            is_hidden: false,
            custom_name: null,
          };

          const { error: insertError } = await supabase
            .from("inventory_items_cache")
            .insert(payload);

          if (insertError) {
            if (insertError.message?.includes("is_local")) {
              const { is_local: _local, ...withoutLocal } = payload;
              const retry = await supabase
                .from("inventory_items_cache")
                .insert(withoutLocal);
              if (retry.error) {
                return {
                  status: "error" as const,
                  error: `Не вдалося створити позицію: ${retry.error.message}`,
                };
              }
            } else {
              return {
                status: "error" as const,
                error: `Не вдалося створити позицію: ${insertError.message}`,
              };
            }
          }

          let stockNote: string | null = null;
          if (stock > 0) {
            const { error: moveError } = await supabase
              .from("inventory_local_moves")
              .insert({
                item_ref_key: basRefKey,
                type: "inbound",
                qty: stock,
                date: new Date().toISOString(),
                status: "draft",
                season: String(new Date().getFullYear()),
                note: `Початковий залишок (LEVADIUS${actorName ? `, ${actorName}` : ""})`,
                unit_price_uah: 0,
              });
            if (moveError) {
              stockNote = `Картку створено, але початковий залишок не записано: ${moveError.message}`;
            }
          }

          return {
            status: "created" as const,
            id: basRefKey,
            warehouseItemId: basRefKey,
            name: displayName,
            category: categoryUk,
            categoryKey,
            unit: unitValue,
            initialStock: stock,
            isNew: true,
            isLocal: true,
            stockNote,
            nextStepHint:
              "Підстав warehouseItemId у prepareWorkOrder і продовжуй наряд.",
          };
        } catch (error) {
          console.error(
            "[TOOL: registerWarehouseItem] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка реєстрації позиції",
          };
        }
      },
    }),

    previewInvoiceReceipt: tool({
      description: "Готує превʼю прибуткової накладної ТМЦ.",
      inputSchema: z.object({
        supplierName: z.string().trim().min(1).describe("Постачальник"),
        supplierEdrpou: z
          .string()
          .trim()
          .optional()
          .describe("ЄДРПОУ, якщо видно"),
        invoiceNumber: z.string().trim().optional().describe("Номер накладної"),
        invoiceDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата YYYY-MM-DD"),
        totalAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Загальна сума накладної ₴"),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              category: z.enum(INVOICE_CATEGORIES),
              quantity: z.number().positive(),
              unit: z.string().trim().min(1),
              pricePerUnit: z.number().finite().nonnegative(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1)
          .describe("Рядки накладної"),
      }),
      execute: async (input) => {
        console.log("[TOOL: previewInvoiceReceipt]", {
          supplier: input.supplierName,
          lines: input.items.length,
        });
        try {
          return await buildInvoicePreview(input);
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка попереднього перегляду накладної",
          };
        }
      },
    }),

    executeWarehouseReceipt: tool({
      description: "Оприбутковує накладну на склад після підтвердження.",
      inputSchema: z.object({
        receiptId: z.string().trim().uuid().optional(),
        supplierName: z.string().trim().min(1),
        supplierEdrpou: z.string().trim().optional(),
        invoiceNumber: z.string().trim().optional(),
        invoiceDate: z.string().trim().optional(),
        totalAmount: z.number().finite().nonnegative().optional(),
        items: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              category: z.enum(INVOICE_CATEGORIES),
              quantity: z.number().positive(),
              unit: z.string().trim().min(1),
              pricePerUnit: z.number().finite().nonnegative(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1),
      }),
      execute: async (input) => {
        console.log("[TOOL: executeWarehouseReceipt]", {
          supplier: input.supplierName,
          lines: input.items.length,
        });
        try {
          return await executeWarehouseReceipt(input);
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка оприбуткування накладної",
          };
        }
      },
    }),

    rollbackWarehouseReceipt: tool({
      description: "Скасовує накладну зі сторно залишків (потрібне confirmed).",
      inputSchema: z.object({
        receiptId: z
          .string()
          .trim()
          .optional()
          .describe("ID проведеної накладної з контексту розмови"),
        invoiceNumber: z
          .string()
          .trim()
          .optional()
          .describe("Номер накладної, якщо ID не вказано"),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Чи підтверджено повернення залишків користувачем"),
      }),
      execute: async (input) => {
        console.log("[TOOL: rollbackWarehouseReceipt]", {
          receiptId: input.receiptId,
          invoiceNumber: input.invoiceNumber,
          confirmed: input.confirmed === true,
        });
        try {
          return await rollbackWarehouseReceipt({
            receiptId: input.receiptId,
            invoiceNumber: input.invoiceNumber,
            confirmed: input.confirmed === true,
          });
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка скасування накладної",
          };
        }
      },
    }),

    previewServiceAct: tool({
      description: "Готує превʼю акта виконаних послуг.",
      inputSchema: z.object({
        actNumber: z.string().trim().optional().describe("Номер акта"),
        actDate: z
          .string()
          .trim()
          .optional()
          .describe("Дата акта YYYY-MM-DD"),
        contractorName: z
          .string()
          .trim()
          .min(1)
          .describe("Виконавець / підрядник"),
        contractorEdrpou: z
          .string()
          .trim()
          .optional()
          .describe("ЄДРПОУ виконавця"),
        category: z
          .enum(SERVICE_ACT_CATEGORIES)
          .optional()
          .describe("Категорія витрат"),
        totalAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Сума з ПДВ"),
        vatAmount: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Сума ПДВ, якщо видно"),
        targetAssetHint: z
          .string()
          .trim()
          .optional()
          .describe(
            "Підказка техніки з тексту акта (напр. телескопічний навантажувач)"
          ),
        equipmentId: z
          .string()
          .trim()
          .uuid()
          .optional()
          .describe("UUID з equipment, якщо вже відомий"),
        services: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              quantity: z.number().positive().optional(),
              unit: z.string().trim().optional(),
              pricePerUnit: z.number().finite().nonnegative().optional(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1)
          .describe("Рядки робіт/послуг"),
      }),
      execute: async (input) => {
        console.log("[TOOL: previewServiceAct]", {
          contractor: input.contractorName,
          lines: input.services.length,
        });
        try {
          return await buildServiceActPreview(input);
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка попереднього перегляду акта",
          };
        }
      },
    }),

    executeServiceActSave: tool({
      description: "Записує акт послуг у бухгалтерію.",
      inputSchema: z.object({
        previewId: z.string().trim().uuid().optional(),
        actNumber: z.string().trim().optional(),
        actDate: z.string().trim().optional(),
        contractorName: z.string().trim().min(1),
        contractorEdrpou: z.string().trim().optional(),
        category: z.enum(SERVICE_ACT_CATEGORIES).optional(),
        totalAmount: z.number().finite().nonnegative().optional(),
        vatAmount: z.number().finite().nonnegative().optional(),
        targetAssetHint: z.string().trim().optional(),
        equipmentId: z.string().trim().uuid().optional(),
        linkEquipment: z
          .boolean()
          .default(true)
          .describe("Привʼязати суму до знайденої техніки (equipment_expenses)"),
        notes: z.string().trim().optional(),
        services: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              quantity: z.number().positive().optional(),
              unit: z.string().trim().optional(),
              pricePerUnit: z.number().finite().nonnegative().optional(),
              totalAmount: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1),
      }),
      execute: async (input) => {
        console.log("[TOOL: executeServiceActSave]", {
          contractor: input.contractorName,
          linkEquipment: input.linkEquipment !== false,
        });
        try {
          const result = await executeServiceActSave({
            ...input,
            linkEquipment: input.linkEquipment !== false,
          });
          if (result.success) {
            await attachDocumentsToEntity("accounting_act", result.actId);
          }
          return result;
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка збереження акта",
          };
        }
      },
    }),

    deleteServiceActs: tool({
      description:
        "Видаляє акти виконаних послуг з Бухгалтерії (потрібне confirmed).",
      inputSchema: z.object({
        actIds: z
          .array(z.string().trim().uuid())
          .optional()
          .describe("Масив ID конкретних актів для видалення"),
        count: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .default(1)
          .describe(
            "Кількість останніх створених актів для видалення, якщо ID не вказані"
          ),
        contractorHint: z
          .string()
          .trim()
          .optional()
          .describe(
            "Фільтр за назвою контрагента (напр. «Нова Пошта»), якщо ID невідомі"
          ),
        confirmed: z
          .boolean()
          .default(false)
          .describe("Чи підтвердив користувач безповоротне видалення"),
      }),
      execute: async (input) => {
        console.log("[TOOL: deleteServiceActs]", {
          actIds: input.actIds?.length ?? 0,
          count: input.count ?? 1,
          contractorHint: input.contractorHint,
          confirmed: input.confirmed === true,
        });
        try {
          return await deleteServiceActs({
            actIds: input.actIds,
            count: input.count ?? 1,
            contractorHint: input.contractorHint,
            confirmed: input.confirmed === true,
          });
        } catch (error) {
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Помилка видалення актів",
          };
        }
      },
    }),

    writeOffInventoryToField: tool({
      description: "Списує ТМЦ зі складу на поле (потрібне confirmed).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Назва або ID поля; якщо не вказано — activeFieldId з контексту"
          ),
        category: z
          .enum(["ЗЗР", "Добрива", "Насіння", "Запчастини"])
          .describe("Категорія матеріалу"),
        itemId: z
          .string()
          .trim()
          .min(1)
          .describe(
            "ID/ref позиції зі складу (bas_ref_key / ref з getWarehouseStock) або точна назва"
          ),
        quantity: z
          .number()
          .positive()
          .describe("Кількість для списання"),
        date: z
          .string()
          .trim()
          .optional()
          .describe("Дата списання YYYY-MM-DD (за замовчуванням сьогодні Київ)"),
        confirmed: z
          .boolean()
          .default(false)
          .describe(
            "true лише після кнопки «Підтвердити списання…» від користувача"
          ),
      }),
      execute: async ({
        fieldIdOrName,
        category,
        itemId,
        quantity,
        date,
        confirmed,
      }) => {
        const categoryMap = {
          ЗЗР: "zzr",
          Добрива: "fertilizer",
          Насіння: "seed",
          Запчастини: "parts",
        } as const;
        const categoryKey = categoryMap[category];
        const lookupField = (
          fieldIdOrName?.trim() ||
          defaultFieldId ||
          ""
        ).trim();
        const moveDate = (date?.trim() || todayKyivYmd()).slice(0, 10);
        const isConfirmed = confirmed === true;
        const qty = Number(quantity);

        console.log("[TOOL: writeOffInventoryToField]", {
          lookupField,
          category,
          itemId,
          qty,
          moveDate,
          confirmed: isConfirmed,
        });

        try {
          if (!Number.isFinite(qty) || qty <= 0) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи кількість більше нуля.",
            };
          }

          const stock = await loadAgentInventoryStock({
            categoryKey,
            includeZero: true,
            limit: 200,
          });
          if (stock.error) {
            return {
              success: false as const,
              status: "error" as const,
              error: stock.error,
            };
          }

          const needle = itemId.trim().toLowerCase();
          const byRef = stock.items.find(
            (item) => item.ref.toLowerCase() === needle
          );
          const byNameExact = stock.items.filter(
            (item) => item.name.toLocaleLowerCase("uk-UA") === needle
          );
          const byNameFuzzy = stock.items.filter((item) =>
            item.name.toLocaleLowerCase("uk-UA").includes(needle)
          );
          const item =
            byRef ??
            (byNameExact.length === 1
              ? byNameExact[0]
              : byNameFuzzy.length === 1
                ? byNameFuzzy[0]
                : null);

          if (!item) {
            if (byNameExact.length > 1 || byNameFuzzy.length > 1) {
              const candidates = (byNameExact.length > 1
                ? byNameExact
                : byNameFuzzy
              ).slice(0, 5);
              return {
                success: false as const,
                status: "ambiguous_item" as const,
                error: `Знайдено кілька позицій для «${itemId}». Уточни.`,
                candidates: candidates.map((row) => ({
                  itemId: row.ref,
                  name: row.name,
                  quantity: row.quantity,
                  unit: row.unit,
                })),
              };
            }
            return {
              success: false as const,
              status: "item_not_found" as const,
              error: `Позицію «${itemId}» у категорії ${category} не знайдено на складі.`,
            };
          }

          if (qty > item.quantity) {
            return {
              success: false as const,
              status: "insufficient_stock" as const,
              error: `Недостатньо на складі. Доступно: ${item.quantity} ${item.unit}`,
              itemName: item.name,
              available: item.quantity,
              unit: item.unit,
            };
          }

          const fieldRequired = categoryKey !== "parts";
          let fieldId: string | null = null;
          let fieldName: string | null = null;

          if (fieldRequired || lookupField) {
            if (!lookupField) {
              return {
                success: false as const,
                status: "needs_slots" as const,
                error: "Вкажи поле для списання (або відкрий його на карті).",
                missing: ["поле"],
              };
            }
            const resolved = await resolveAgentFieldByLookup(
              supabase,
              lookupField
            );
            if (!resolved.ok) {
              return {
                success: false as const,
                status: resolved.status,
                error: resolved.error,
                candidates: resolved.candidates,
              };
            }
            fieldId = resolved.field.id;
            fieldName = resolved.fieldName;
          }

          if (!isConfirmed) {
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId,
              fieldName: fieldName ?? "склад",
              itemId: item.ref,
              itemName: item.name,
              category,
              quantity: qty,
              unit: item.unit,
              date: moveDate,
              currentStock: item.quantity,
              projectedStock: round2(item.quantity - qty),
              confirmChoice: `Підтвердити списання ${qty} ${item.unit} на ${fieldName ?? "склад"}`,
              cancelChoice: "Скасувати",
              userHint: `Списати ${qty} ${item.unit} «${item.name}» → ${fieldName ?? "склад"} (${moveDate})?`,
            };
          }

          const result = await createLocalOutboundMove({
            itemRefKey: item.ref,
            fieldId,
            qty,
            season: DEFAULT_SEASON,
            date: moveDate,
          });

          if (!result.ok) {
            return {
              success: false as const,
              status: "error" as const,
              error: result.error,
            };
          }

          const refreshed = await loadAgentInventoryStock({
            categoryKey,
            includeZero: true,
            limit: 200,
          });
          const after = refreshed.items.find(
            (row) => row.ref.toLowerCase() === item.ref.toLowerCase()
          );
          const newStockBalance =
            after?.quantity ?? round2(item.quantity - qty);

          return {
            success: true as const,
            status: "written_off" as const,
            moveId: result.id,
            fieldId,
            fieldName: fieldName ?? "склад",
            itemId: item.ref,
            itemName: item.name,
            category,
            quantity: qty,
            unit: item.unit,
            date: moveDate,
            newStockBalance,
            message: `Списано ${qty} ${item.unit} «${item.name}» → ${fieldName ?? "склад"}. Залишок: ${newStockBalance} ${item.unit}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: writeOffInventoryToField] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка списання",
          };
        }
      },
    }),

    prepareWorkOrder: tool({
      description: "Готує чернетку наряду на польові роботи.",
      inputSchema: z.object({
        fieldId: z
          .string()
          .trim()
          .min(1)
          .describe("ID або назва поля"),
        operationType: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Посів, Оранка, Культивація, Дискування, Внесення ЗЗР, Внесення добрив, Збирання"
          ),
        date: z
          .string()
          .trim()
          .min(1)
          .describe(
            "Дата YYYY-MM-DD або відносна: сьогодні / завтра / післязавтра (за календарем Києва з системного контексту)"
          ),
        timeRange: z
          .object({
            start: z.string().trim().default("08:00"),
            end: z.string().trim().default("18:00"),
          })
          .optional()
          .describe("Інтервал робіт, за замовчуванням 08:00–18:00"),
        equipmentId: z
          .string()
          .trim()
          .min(1)
          .describe("Техніка / трактор (ID або назва)"),
        implementId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Знаряддя (причіпне/навісне обладнання), ID або назва"),
        driverName: z
          .string()
          .trim()
          .min(1)
          .describe("ПІБ механізатора"),
        warehouseItemId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "ID або назва насіння/ЗЗР/добрива зі складу, якщо операція потребує списання ТМЦ"
          ),
        ratePerHa: z
          .number()
          .finite()
          .nonnegative()
          .optional()
          .describe("Норма внесення або висіву на га / ставка ₴/га"),
      }),
      execute: async (params) => {
        const {
          fieldId: fieldIdInput,
          operationType: operationTypeRaw,
          date: dateRaw,
          timeRange,
          equipmentId: equipmentInput,
          implementId: implementInput,
          driverName,
          warehouseItemId: warehouseInput,
          ratePerHa,
        } = params;

        console.log("[TOOL: prepareWorkOrder] Preparing draft…", {
          fieldIdInput,
          operationTypeRaw,
          dateRaw,
          equipmentInput,
          driverName,
          warehouseInput,
        });

        try {
          const dateResolved = resolveWorkOrderDateInput(dateRaw);
          if ("error" in dateResolved) {
            return {
              status: "error" as const,
              error: dateResolved.error,
            };
          }
          const date = dateResolved.date;
          const today = todayKyivYmd();
          const daysFromToday = (() => {
            const [ty, tm, td] = today.split("-").map(Number);
            const [dy, dm, dd] = date.split("-").map(Number);
            const t = Date.UTC(ty!, tm! - 1, td!);
            const d = Date.UTC(dy!, dm! - 1, dd!);
            return Math.round((d - t) / 86_400_000);
          })();
          // Захист від галюцинацій дати (напр. «завтра» → випадковий квітень)
          if (
            !dateResolved.resolvedFrom &&
            (daysFromToday < -3 || daysFromToday > 45)
          ) {
            return {
              status: "date_out_of_range" as const,
              error: `Дата ${date} виглядає підозріло відносно сьогодні (${today}). Уточни YYYY-MM-DD або передай «сьогодні»/«завтра».`,
              today,
              tomorrow: shiftKyivYmd(today, 1),
              receivedDate: date,
            };
          }

          const normalizedType = normalizeWorkOrderType(operationTypeRaw);
          if (!normalizedType) {
            return {
              status: "error" as const,
              error: `Невідомий тип операції «${operationTypeRaw}». Обери: ${WORK_ORDER_TYPES.join(", ")}.`,
            };
          }

          const needsMaterial = operationRequiresMaterial(normalizedType);
          const missing: string[] = [];
          if (!fieldIdInput.trim() && !defaultFieldId) missing.push("поле");
          if (!date.trim()) missing.push("дата");
          if (!equipmentInput.trim()) missing.push("техніка");
          if (!driverName.trim()) missing.push("механізатор");
          if (needsMaterial && !warehouseInput?.trim()) {
            missing.push("позиція складу (насіння/ЗЗР/добриво)");
          }
          if (missing.length > 0) {
            return {
              status: "needs_slots" as const,
              error: `Бракує обовʼязкових даних: ${missing.join(", ")}. Уточни в діалозі, не вигадуй.`,
              missing,
              hint: needsMaterial
                ? "Яку позицію зі складу списуємо під цю операцію?"
                : undefined,
            };
          }

          const lookup = fieldIdInput.trim() || defaultFieldId || "";
          type FieldRow = {
            id: string;
            name: string | null;
            canonical_name: string | null;
            area_ha: number | null;
            crop: string | null;
            season: string | null;
          };

          let field: FieldRow | null = null;

          if (isUuid(lookup)) {
            const { data, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("id", lookup)
              .eq("is_field", true)
              .maybeSingle();
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося знайти поле: ${error.message}`,
              };
            }
            field = (data as FieldRow | null) ?? null;
          }

          if (!field) {
            const { data: byName } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .ilike("name", lookup)
              .limit(5);
            field = ((byName ?? [])[0] as FieldRow | undefined) ?? null;
          }

          if (!field) {
            const { data: byCanonical } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .ilike("canonical_name", lookup)
              .limit(5);
            field = ((byCanonical ?? [])[0] as FieldRow | undefined) ?? null;
          }

          if (!field) {
            const safe = lookup.replaceAll(",", " ");
            const { data: fuzzy, error: fuzzyError } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, area_ha, crop, season")
              .eq("is_field", true)
              .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
              .order("name")
              .limit(5);
            if (fuzzyError) {
              return {
                status: "error" as const,
                error: `Не вдалося шукати поле: ${fuzzyError.message}`,
              };
            }
            const matches = (fuzzy ?? []) as FieldRow[];
            if (matches.length === 0) {
              return {
                status: "field_not_found" as const,
                error: `Поле «${lookup}» не знайдено. Уточни назву.`,
              };
            }
            if (matches.length > 1) {
              return {
                status: "ambiguous_field" as const,
                error: `Знайдено кілька полів для «${lookup}». Уточни точніше.`,
                candidates: matches.map((item) => ({
                  id: item.id,
                  name:
                    (item.canonical_name && item.canonical_name.trim()) ||
                    item.name ||
                    "Поле",
                  areaHa: finiteNumber(item.area_ha),
                })),
              };
            }
            field = matches[0]!;
          }

          const areaHa = finiteNumber(field.area_ha);
          const fieldName =
            (field.canonical_name && field.canonical_name.trim()) ||
            field.name ||
            "Поле";
          const crop = (field.crop && String(field.crop).trim()) || "—";

          // Техніка
          let equipmentId: string | null = null;
          let equipmentName = equipmentInput.trim();
          let equipmentFound = false;
          if (isUuid(equipmentInput)) {
            const { data } = await supabase
              .from("equipment")
              .select("id, name")
              .eq("id", equipmentInput)
              .maybeSingle();
            if (data) {
              equipmentFound = true;
              equipmentId = String(data.id);
              equipmentName = String(data.name ?? equipmentName);
            }
          }
          if (!equipmentFound) {
            const { data: equipmentRows, error: equipmentError } =
              await supabase
                .from("equipment")
                .select("id, name")
                .ilike("name", `%${equipmentInput.trim()}%`)
                .order("name")
                .limit(8);
            if (equipmentError) {
              return {
                status: "error" as const,
                error: `Не вдалося перевірити техніку: ${equipmentError.message}`,
              };
            }
            const candidates = (equipmentRows ?? []).map((row) => ({
              id: String(row.id),
              name: String(row.name ?? ""),
            }));
            const exact = candidates.find(
              (row) =>
                row.name.toLocaleLowerCase("uk-UA") ===
                equipmentInput.trim().toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? candidates[0] ?? null;
            if (chosen) {
              equipmentFound = true;
              equipmentId = chosen.id;
              equipmentName = chosen.name;
            }
          }

          // Знаряддя
          let implementId: string | null = null;
          let implementName =
            implementInput?.trim() || IMPLEMENT_PRESETS[normalizedType] || "";
          let implementWidthM: number | null = null;
          if (implementInput?.trim()) {
            if (isUuid(implementInput)) {
              const { data } = await supabase
                .from("implements")
                .select("id, name, working_width_m")
                .eq("id", implementInput)
                .maybeSingle();
              if (data) {
                implementId = String(data.id);
                implementName = String(data.name ?? implementName);
                implementWidthM = finiteNumber(data.working_width_m) || null;
              }
            } else {
              const { data: implRows } = await supabase
                .from("implements")
                .select("id, name, working_width_m")
                .ilike("name", `%${implementInput.trim()}%`)
                .order("name")
                .limit(5);
              const chosen = (implRows ?? [])[0];
              if (chosen) {
                implementId = String(chosen.id);
                implementName = String(chosen.name ?? implementName);
                implementWidthM =
                  finiteNumber(chosen.working_width_m) || null;
              } else {
                implementName = implementInput.trim();
              }
            }
          }

          // Складська позиція
          let warehouseItemId: string | null = null;
          let warehouseItemName: string | null = null;
          let warehouseItemUnit = "од.";
          let warehouseItemCategory = "";
          let materialQty: number | null = null;
          let isNewWarehouseItem = false;

          if (needsMaterial) {
            const wh = warehouseInput!.trim();
            type ItemRow = {
              bas_ref_key: string;
              name: string | null;
              custom_name: string | null;
              category: string | null;
              unit: string | null;
              is_local?: boolean | null;
            };
            let item: ItemRow | null = null;

            const { data: byKey } = await supabase
              .from("inventory_items_cache")
              .select(
                "bas_ref_key, name, custom_name, category, unit, is_local"
              )
              .eq("bas_ref_key", wh)
              .maybeSingle();
            item = (byKey as ItemRow | null) ?? null;

            if (!item) {
              const safe = wh.replaceAll(",", " ");
              const { data: byName } = await supabase
                .from("inventory_items_cache")
                .select(
                  "bas_ref_key, name, custom_name, category, unit, is_local"
                )
                .or(
                  `name.ilike.%${safe}%,custom_name.ilike.%${safe}%`
                )
                .limit(8);

              const rows = (byName ?? []) as ItemRow[];
              const exact = rows.find((row) => {
                const a = (row.custom_name || row.name || "")
                  .trim()
                  .toLocaleLowerCase("uk-UA");
                return a === wh.toLocaleLowerCase("uk-UA");
              });
              item = exact ?? rows[0] ?? null;
            }

            if (!item) {
              const suggestedCategory =
                normalizedType === "Посів"
                  ? "Насіння"
                  : normalizedType === "Внесення добрив"
                    ? "Добрива"
                    : "ЗЗР";
              return {
                status: "warehouse_item_not_found" as const,
                error: `Позицію складу «${wh}» не знайдено.`,
                suggestedName: wh,
                suggestedCategory,
                offerRegister: true,
                userHint: `Позиції «${wh}» ще немає в обліку складу. Щоб оприбуткувати її коректно, вкажи кількість і ціну або завантаж фото накладної (скріпка в полі вводу).`,
                suggestedChoices: [
                  "📷 Прикріпити накладну",
                  "Ввести кількість вручну",
                ],
              };
            }

            warehouseItemId = String(item.bas_ref_key);
            warehouseItemName =
              (item.custom_name && item.custom_name.trim()) ||
              item.name ||
              "ТМЦ";
            warehouseItemUnit = String(item.unit ?? "").trim() || "од.";
            warehouseItemCategory = String(item.category ?? "").trim();
            isNewWarehouseItem = item.is_local === true;
            materialQty =
              typeof ratePerHa === "number" && Number.isFinite(ratePerHa)
                ? Math.round(ratePerHa * areaHa * 100) / 100
                : estimateMaterialQty(normalizedType, areaHa, crop);
          }

          // Новий механізатор?
          const driverTrimmed = driverName.trim();
          let isNewDriver = true;
          {
            const { data: mechanicRows } = await supabase
              .from("field_operations")
              .select("mechanic_name")
              .ilike("mechanic_name", driverTrimmed)
              .limit(5);
            const found = (mechanicRows ?? []).some(
              (row) =>
                String(row.mechanic_name ?? "")
                  .trim()
                  .toLocaleLowerCase("uk-UA") ===
                driverTrimmed.toLocaleLowerCase("uk-UA")
            );
            isNewDriver = !found;
          }

          const wageRate =
            typeof ratePerHa === "number" &&
            Number.isFinite(ratePerHa) &&
            !needsMaterial
              ? ratePerHa
              : WAGE_UAH_PER_HA;
          const calculatedFuel = estimatePlanFuelLiters(
            normalizedType,
            areaHa
          );
          const calculatedSalary =
            typeof ratePerHa === "number" &&
            Number.isFinite(ratePerHa) &&
            !needsMaterial
              ? Math.max(0, Math.round(areaHa * ratePerHa))
              : estimatePlanWageUah(areaHa);

          const start = timeRange?.start?.trim() || "08:00";
          const end = timeRange?.end?.trim() || "18:00";
          const draftId = crypto.randomUUID();

          const formData = {
            fieldId: String(field.id),
            fieldKey: `farm:${field.id}`,
            fieldName,
            areaHa,
            crop,
            season: field.season,
            operationType: normalizedType,
            date,
            timeRange: { start, end },
            equipmentId,
            equipmentName,
            equipmentFound,
            implementId,
            implementName,
            implementWidthM,
            driverName: driverTrimmed,
            isNewDriver,
            driverNote: isNewDriver
              ? `Зафіксував нового механізатора ${driverTrimmed}. Після збереження наряду він автоматично закріпиться в системі.`
              : null,
            warehouseItemId,
            warehouseItemName,
            warehouseItemUnit,
            warehouseItemCategory,
            isNewWarehouseItem,
            materialQty,
            ratePerHa:
              typeof ratePerHa === "number" && Number.isFinite(ratePerHa)
                ? ratePerHa
                : needsMaterial
                  ? null
                  : wageRate,
            calculatedFuel,
            calculatedSalary,
          };

          console.log("[TOOL: prepareWorkOrder] ready", {
            fieldId: formData.fieldId,
            operationType: formData.operationType,
            areaHa: formData.areaHa,
            isNewDriver,
            isNewWarehouseItem,
          });

          return {
            status: "ready" as const,
            success: true,
            workOrderId: draftId,
            draftId,
            formData,
            message:
              "Чернетку підготовано. Після підтвердження в картці наряд збережеться з цим workOrderId.",
            summary: `${normalizedType} на ${fieldName}`,
          };
        } catch (error) {
          console.error(
            "[TOOL: prepareWorkOrder] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка підготовки наряду",
          };
        }
      },
    }),

    confirmWorkOrder: tool({
      description: "Зберігає наряд у хронологію після згоди.",
      inputSchema: z.object({
        workOrderId: z
          .string()
          .trim()
          .min(1)
          .describe("UUID з prepareWorkOrder.workOrderId / draftId"),
        fieldId: z.string().trim().min(1).describe("ID поля"),
        operationType: z.string().trim().min(1),
        date: z.string().trim().min(1).describe("YYYY-MM-DD"),
        equipmentName: z.string().trim().min(1),
        driverName: z.string().trim().min(1),
        crop: z.string().trim().optional(),
        implementName: z.string().trim().optional(),
        equipmentId: z.string().trim().optional(),
        areaHa: z.number().finite().nonnegative().optional(),
        fuelPlan: z.number().finite().nonnegative().optional(),
        wagePlan: z.number().finite().nonnegative().optional(),
        timeStart: z.string().trim().optional(),
      }),
      execute: async (input) => {
        const workOrderId = input.workOrderId.trim();
        let fieldId = input.fieldId.trim();
        const operationType = input.operationType.trim();
        const date = input.date.trim();
        const hhmm =
          input.timeStart && /^\d{2}:\d{2}$/.test(input.timeStart)
            ? input.timeStart
            : "08:00";
        const seasonYear = Number(date.slice(0, 4)) || new Date().getFullYear();
        const areaHa = input.areaHa ?? 0;

        console.log("[TOOL: confirmWorkOrder]", { workOrderId, fieldId });

        try {
          // fieldId може прийти як назва — резолвимо в UUID
          if (!isUuid(fieldId)) {
            const safe = fieldId.replaceAll(",", " ");
            const { data: fields } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name")
              .eq("is_field", true)
              .or(`name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`)
              .limit(5);
            const rows = fields ?? [];
            const exact = rows.find(
              (row) =>
                String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                  safe.toLocaleLowerCase("uk-UA") ||
                String(row.canonical_name ?? "")
                  .toLocaleLowerCase("uk-UA") === safe.toLocaleLowerCase("uk-UA")
            );
            const chosen = exact ?? (rows.length === 1 ? rows[0] : null);
            if (!chosen) {
              return {
                success: false as const,
                error:
                  rows.length > 1
                    ? `Кілька полів для «${fieldId}». Передай точний fieldId з prepareWorkOrder.`
                    : `Поле «${fieldId}» не знайдено.`,
              };
            }
            fieldId = String(chosen.id);
          }

          const { data: field } = await supabase
            .from("farm_fields")
            .select("id, name, canonical_name")
            .eq("id", fieldId)
            .maybeSingle();
          if (!field) {
            return {
              success: false as const,
              error: `Поле з id ${fieldId} відсутнє в farm_fields.`,
            };
          }
          const fieldName =
            (field.canonical_name && String(field.canonical_name).trim()) ||
            (field.name && String(field.name).trim()) ||
            "Поле";
          // field_key — NOT NULL у field_operations (міграція 007)
          const fieldKey = `farm:${fieldId}`;

          const row: Record<string, unknown> = {
            client_key: workOrderId,
            field_key: fieldKey,
            field_id: fieldId,
            work_type: operationType,
            crop: input.crop?.trim() || "—",
            status: "planned",
            machinery: input.equipmentName.trim(),
            implement: input.implementName?.trim() || "",
            occurred_at: date,
            time_label: `${hhmm} – 18:00`,
            season_year: seasonYear,
            season: String(seasonYear),
            area_total: areaHa,
            area_plan: areaHa,
            area_fact: null,
            fuel_plan: input.fuelPlan ?? 0,
            fuel_fact: null,
            wage_plan: input.wagePlan ?? 0,
            wage_fact: null,
            mechanic_name: input.driverName.trim(),
            equipment_id:
              input.equipmentId && isUuid(input.equipmentId)
                ? input.equipmentId
                : null,
            export_status: "none",
            updated_at: new Date().toISOString(),
          };
          if (actorUserId) row.actor_id = actorUserId;
          if (actorName) row.actor_name = actorName;

          let { data, error } = await supabase
            .from("field_operations")
            .upsert(row, { onConflict: "client_key" })
            .select("id, client_key, work_type, field_key, field_id")
            .maybeSingle();

          if (
            error &&
            (error.message?.includes("actor_") ||
              error.message?.includes("season_year") ||
              error.message?.includes("export_status"))
          ) {
            const retryRow = { ...row };
            if (error.message.includes("actor_")) {
              delete retryRow.actor_id;
              delete retryRow.actor_name;
            }
            if (error.message.includes("season_year")) {
              delete retryRow.season_year;
            }
            if (error.message.includes("export_status")) {
              delete retryRow.export_status;
            }
            const retry = await supabase
              .from("field_operations")
              .upsert(retryRow, { onConflict: "client_key" })
              .select("id, client_key, work_type, field_key, field_id")
              .maybeSingle();
            data = retry.data;
            error = retry.error;
          }

          if (error) {
            console.error("[TOOL: confirmWorkOrder] upsert failed:", error.message);
            return {
              success: false as const,
              error: error.message,
              hint: "Перевір field_key/field_id. Не викликай logUnsupportedRequest — це технічна помилка збереження.",
            };
          }

          const savedId = String(data?.client_key ?? workOrderId);
          const summary = `${operationType} на ${fieldName}`;
          return {
            success: true as const,
            workOrderId: savedId,
            dbId: data?.id ? String(data.id) : null,
            fieldKey,
            fieldId,
            message: "Наряд успішно створено",
            summary,
            operationType,
            fieldName,
          };
        } catch (error) {
          return {
            success: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка збереження наряду",
          };
        }
      },
    }),

    deleteWorkOrder: tool({
      description: "Видаляє наряд (потрібне підтвердження).",
      inputSchema: z.object({
        workOrderId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "UUID наряду з історії (prepareWorkOrder/confirmWorkOrder) або з бази"
          ),
        fieldName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва поля, якщо ID невідомий"),
        reason: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Причина видалення (наприклад, тестовий запис)"),
        confirmed: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Підтвердження, коли ID не з історії а з пошуку по полю/останньому"
          ),
      }),
      execute: async ({ workOrderId, fieldName, reason, confirmed }) => {
        const isConfirmed = confirmed === true;
        const hasExplicitId = Boolean(workOrderId?.trim());
        console.log("[TOOL: deleteWorkOrder]", {
          workOrderId,
          fieldName,
          reason,
          isConfirmed,
          hasExplicitId,
        });

        const statusLabels: Record<string, string> = {
          planned: "Заплановано",
          in_progress: "В роботі",
          completed: "Завершено",
          cancelled: "Скасовано",
        };

        type OpRow = {
          id: string;
          client_key: string;
          field_id: string | null;
          work_type: string | null;
          crop: string | null;
          status: string | null;
          machinery: string | null;
          mechanic_name: string | null;
          occurred_at: string | null;
          created_at: string | null;
        };

        const opSelect =
          "id, client_key, field_id, work_type, crop, status, machinery, mechanic_name, occurred_at, created_at";

        const mapOp = async (op: OpRow) => {
          let fieldLabel = "Поле";
          if (op.field_id) {
            const { data: field } = await supabase
              .from("farm_fields")
              .select("name, canonical_name")
              .eq("id", op.field_id)
              .maybeSingle();
            fieldLabel =
              (field?.canonical_name && String(field.canonical_name).trim()) ||
              (field?.name && String(field.name).trim()) ||
              "Поле";
          }
          const date =
            String(op.occurred_at ?? "").slice(0, 10) ||
            String(op.created_at ?? "").slice(0, 10) ||
            "—";
          return {
            workOrderId: String(op.client_key || op.id),
            dbId: String(op.id),
            clientKey: String(op.client_key),
            fieldId: op.field_id,
            fieldName: fieldLabel,
            operationType: String(op.work_type ?? "Операція"),
            crop: String(op.crop ?? "—"),
            date,
            machinery: String(op.machinery ?? "").trim() || "—",
            mechanicName: String(op.mechanic_name ?? "").trim() || null,
            statusLabel:
              statusLabels[String(op.status ?? "planned")] ??
              String(op.status ?? ""),
            opStatus: String(op.status ?? "planned"),
          };
        };

        try {
          let op: OpRow | null = null;
          let resolvedVia: "id" | "field" | "actor" = "id";

          if (workOrderId?.trim()) {
            const key = workOrderId.trim();
            if (isUuid(key)) {
              const byId = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("id", key)
                .maybeSingle();
              op = (byId.data as OpRow | null) ?? null;
            }
            if (!op) {
              const byClient = await supabase
                .from("field_operations")
                .select(opSelect)
                .eq("client_key", key)
                .maybeSingle();
              op = (byClient.data as OpRow | null) ?? null;
            }
            if (!op) {
              return {
                success: false as const,
                status: "not_found" as const,
                error: `Наряд «${key}» не знайдено.`,
              };
            }
            resolvedVia = "id";
          } else if (fieldName?.trim() || defaultFieldId) {
            resolvedVia = "field";
            let fieldId = defaultFieldId;
            const lookup = fieldName?.trim();
            if (lookup) {
              if (isUuid(lookup)) fieldId = lookup;
              else {
                const safe = lookup.replaceAll(",", " ");
                const { data: fields } = await supabase
                  .from("farm_fields")
                  .select("id, name, canonical_name")
                  .eq("is_field", true)
                  .or(
                    `name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`
                  )
                  .limit(5);
                const rows = fields ?? [];
                if (rows.length === 0) {
                  return {
                    success: false as const,
                    status: "field_not_found" as const,
                    error: `Поле «${lookup}» не знайдено.`,
                  };
                }
                const exact = rows.find(
                  (row) =>
                    String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                      lookup.toLocaleLowerCase("uk-UA") ||
                    String(row.canonical_name ?? "")
                      .toLocaleLowerCase("uk-UA") ===
                      lookup.toLocaleLowerCase("uk-UA")
                );
                if (rows.length > 1 && !exact) {
                  return {
                    success: false as const,
                    status: "ambiguous_field" as const,
                    error: `Знайдено кілька полів для «${lookup}». Уточни.`,
                    candidates: rows.map((row) => ({
                      id: row.id,
                      name:
                        (row.canonical_name &&
                          String(row.canonical_name).trim()) ||
                        String(row.name ?? "Поле"),
                    })),
                  };
                }
                fieldId = String((exact ?? rows[0]!).id);
              }
            }
            if (!fieldId) {
              return {
                success: false as const,
                status: "needs_slots" as const,
                error: "Вкажи workOrderId або назву поля.",
              };
            }
            const { data: latest, error: latestError } = await supabase
              .from("field_operations")
              .select(opSelect)
              .eq("field_id", fieldId)
              .neq("status", "cancelled")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestError) {
              return {
                success: false as const,
                status: "error" as const,
                error: latestError.message,
              };
            }
            op = (latest as OpRow | null) ?? null;
          } else if (actorUserId) {
            resolvedVia = "actor";
            const { data: latest, error: latestError } = await supabase
              .from("field_operations")
              .select(opSelect)
              .eq("actor_id", actorUserId)
              .neq("status", "cancelled")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestError) {
              // колонки actor_id може не бути — fallback без фільтра
              const fallback = await supabase
                .from("field_operations")
                .select(opSelect)
                .neq("status", "cancelled")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              op = (fallback.data as OpRow | null) ?? null;
            } else {
              op = (latest as OpRow | null) ?? null;
            }
          } else {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error:
                "Немає workOrderId в історії. Уточни поле або ID наряду.",
            };
          }

          if (!op) {
            return {
              success: false as const,
              status: "not_found" as const,
              error: "Збережений наряд для видалення не знайдено.",
            };
          }

          const details = await mapOp(op);

          // Явний ID з історії — видаляємо одразу. Інакше — підтвердження.
          if (!hasExplicitId && !isConfirmed) {
            return {
              ...details,
              success: false as const,
              status: "requires_confirmation" as const,
              confirmChoice: "Так, видалити наряд назавжди",
              cancelChoice: "Ні, залишити як є",
              userHint: `Ви дійсно хочете видалити наряд ${details.operationType} від ${details.date} по полю ${details.fieldName}?`,
              resolvedVia,
            };
          }

          const { data: deleted, error: deleteError } = await supabase
            .from("field_operations")
            .delete()
            .eq("id", details.dbId)
            .select("id, client_key, work_type, field_id")
            .maybeSingle();

          if (deleteError) {
            const byClient = await supabase
              .from("field_operations")
              .delete()
              .eq("client_key", details.clientKey)
              .select("id, client_key, work_type, field_id")
              .maybeSingle();
            if (byClient.error) {
              return {
                success: false as const,
                status: "error" as const,
                error: byClient.error.message,
              };
            }
            return {
              success: true as const,
              status: "deleted" as const,
              workOrderId: details.workOrderId,
              deletedItem: byClient.data,
              operationType: details.operationType,
              fieldName: details.fieldName,
              reason: reason ?? null,
              message: `Видалив щойно створений наряд ${details.operationType} з бази Хронології ✓`,
            };
          }

          return {
            success: true as const,
            status: "deleted" as const,
            workOrderId: details.workOrderId,
            deletedItem: deleted,
            operationType: details.operationType,
            fieldName: details.fieldName,
            reason: reason ?? null,
            message: `Видалив щойно створений наряд ${details.operationType} з бази Хронології ✓`,
          };
        } catch (error) {
          console.error(
            "[TOOL: deleteWorkOrder] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка видалення наряду",
          };
        }
      },
    }),

    getFieldWeather: tool({
      description: "Читає погоду по полю.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Назва або ID поля; якщо порожньо — activeFieldId з контексту"),
      }),
      execute: async ({ fieldIdOrName }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: getFieldWeather]", { lookup });

        if (!lookup) {
          return {
            status: "needs_slots" as const,
            error: "Вкажи назву або ID поля.",
          };
        }

        try {
          type FieldRow = {
            id: string;
            name: string | null;
            canonical_name: string | null;
            crop: string | null;
            area_ha: number | null;
          };

          let field: FieldRow | null = null;

          if (isUuid(lookup)) {
            const { data, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, crop, area_ha")
              .eq("id", lookup)
              .eq("is_field", true)
              .maybeSingle();
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося знайти поле: ${error.message}`,
              };
            }
            field = (data as FieldRow | null) ?? null;
          }

          if (!field) {
            const safe = lookup.replaceAll(",", " ");
            const { data: matches, error } = await supabase
              .from("farm_fields")
              .select("id, name, canonical_name, crop, area_ha")
              .eq("is_field", true)
              .or(
                `name.ilike.%${safe}%,canonical_name.ilike.%${safe}%`
              )
              .order("name")
              .limit(5);
            if (error) {
              return {
                status: "error" as const,
                error: `Не вдалося шукати поле: ${error.message}`,
              };
            }
            const rows = (matches ?? []) as FieldRow[];
            if (rows.length === 0) {
              return {
                status: "field_not_found" as const,
                error: `Поле «${lookup}» не знайдено.`,
              };
            }
            const exact = rows.find(
              (row) =>
                String(row.name ?? "").toLocaleLowerCase("uk-UA") ===
                  lookup.toLocaleLowerCase("uk-UA") ||
                String(row.canonical_name ?? "")
                  .toLocaleLowerCase("uk-UA") ===
                  lookup.toLocaleLowerCase("uk-UA")
            );
            if (rows.length > 1 && !exact) {
              return {
                status: "ambiguous_field" as const,
                error: `Знайдено кілька полів для «${lookup}». Уточни.`,
                candidates: rows.map((row) => ({
                  id: row.id,
                  name:
                    (row.canonical_name && row.canonical_name.trim()) ||
                    row.name ||
                    "Поле",
                })),
              };
            }
            field = exact ?? rows[0]!;
          }

          const fieldName =
            (field.canonical_name && field.canonical_name.trim()) ||
            field.name ||
            "Поле";
          const crop = (field.crop && String(field.crop).trim()) || null;

          const coords = await resolveFieldCoordinates(supabase, field.id);
          if (!coords) {
            return {
              status: "no_geometry" as const,
              error: `У поля «${fieldName}» немає геометрії для погоди.`,
              fieldId: field.id,
              fieldName,
            };
          }

          const { current, hourly } = await fetchWeatherWithHourly(
            coords.latitude,
            coords.longitude
          );
          const advisory = evaluateFieldWeatherAdvisory(current, {
            crop: crop ?? undefined,
            hourly,
          });

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            crop,
            areaHa: finiteNumber(field.area_ha),
            atmosphere: {
              tempC: current.tempC,
              humidityPercent: current.humidityPercent,
              windMs: current.windMs,
              condition: current.condition,
            },
            soil: {
              tempC18cm: current.soilTempC,
              moisturePercent3to9cm: current.soilMoisturePercent,
            },
            advisory: {
              tone: advisory.tone,
              title: advisory.title,
              detail: advisory.detail ?? null,
            },
            hourly: hourly.slice(0, 4).map((hour) => ({
              time: hour.time,
              tempC: hour.tempC,
              precipMm: hour.precipitationMm,
              precipProb: hour.precipProbability,
            })),
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldWeather] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка отримання погоди",
          };
        }
      },
    }),

    getFieldOperationsHistory: tool({
      description: "Читає історію виконаних робіт по полю.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або ID поля"),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe("Початкова дата фільтрації (YYYY-MM-DD)"),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe("Кінцева дата фільтрації (YYYY-MM-DD)"),
        month: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe("Номер місяця (1–12), напр. 6 для червня"),
        operationType: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Фільтр за типом робіт"),
      }),
      execute: async ({
        fieldIdOrName,
        startDate,
        endDate,
        month,
        operationType,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        console.log("[TOOL: getFieldOperationsHistory]", {
          lookup,
          startDate,
          endDate,
          month,
          operationType,
        });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const range = resolveHistoryDateRange({
            startDate,
            endDate,
            month,
            year: Number(field.season) || Number(DEFAULT_SEASON) || undefined,
          });

          const fieldKey = `farm:${field.id}`;
          let query = supabase
            .from("field_operations")
            .select(
              `
              id,
              client_key,
              work_type,
              crop,
              status,
              occurred_at,
              machinery,
              implement,
              mechanic_name,
              area_fact,
              area_plan,
              fuel_fact,
              fuel_plan
            `
            )
            .eq("status", "completed")
            .or(`field_id.eq.${field.id},field_key.eq.${fieldKey}`)
            .order("occurred_at", { ascending: false })
            .limit(40);

          if (range.startDate) {
            query = query.gte("occurred_at", range.startDate);
          }
          if (range.endDate) {
            query = query.lte("occurred_at", range.endDate);
          }
          if (operationType?.trim()) {
            query = query.ilike("work_type", `%${operationType.trim()}%`);
          }

          const { data: ops, error: opsError } = await query;
          if (opsError) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати історію: ${opsError.message}`,
            };
          }

          const rows = ops ?? [];
          const clientKeys = rows
            .map((row) => String(row.client_key ?? "").trim())
            .filter(Boolean);

          const materialsByKey = new Map<
            string,
            {
              name: string;
              category: string | null;
              unit: string | null;
              qty: number;
            }[]
          >();

          if (clientKeys.length > 0) {
            const { data: materials } = await supabase
              .from("field_operation_materials")
              .select(
                "operation_client_key, item_name, category, unit, qty"
              )
              .in("operation_client_key", clientKeys);

            for (const mat of materials ?? []) {
              const key = String(mat.operation_client_key ?? "");
              if (!key) continue;
              const list = materialsByKey.get(key) ?? [];
              list.push({
                name: String(mat.item_name ?? "ТМЦ"),
                category:
                  typeof mat.category === "string" ? mat.category : null,
                unit: typeof mat.unit === "string" ? mat.unit : null,
                qty: finiteNumber(mat.qty),
              });
              materialsByKey.set(key, list);
            }
          }

          const operations = rows.map((row) => {
            const key = String(row.client_key ?? "");
            const mats = materialsByKey.get(key) ?? [];
            return {
              id: row.id,
              date: row.occurred_at,
              workType: row.work_type,
              machinery: row.machinery || null,
              implement: row.implement || null,
              mechanic: row.mechanic_name || null,
              areaHa:
                finiteNumber(row.area_fact) || finiteNumber(row.area_plan),
              fuelL:
                finiteNumber(row.fuel_fact) || finiteNumber(row.fuel_plan),
              materials: mats.map((m) => ({
                name: m.name,
                qty: m.qty,
                unit: m.unit,
              })),
            };
          });

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            dateRange: {
              start: range.startDate,
              end: range.endDate,
              label: range.label,
            },
            count: operations.length,
            operations,
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldOperationsHistory] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка історії поля",
          };
        }
      },
    }),

    getFieldCostAnalysis: tool({
      description: "Рахує собівартість поля за сезон.",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .describe("Назва або ID поля"),
        season: z
          .number()
          .int()
          .default(2026)
          .describe("Сезон робіт (рік), за замовчуванням 2026"),
      }),
      execute: async ({ fieldIdOrName, season }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const seasonId = normalizeSeason(season ?? 2026);
        console.log("[TOOL: getFieldCostAnalysis]", { lookup, seasonId });

        try {
          const resolved = await resolveAgentFieldByLookup(supabase, lookup);
          if (!resolved.ok) {
            return {
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const economics = await fetchLiveFieldEconomics(field.id, seasonId);

          const fuelUah = economics.fuelCostUah;
          const materialsUah = round2(
            economics.categoriesBreakdown.zzr.costUah +
              economics.categoriesBreakdown.fertilizer.costUah +
              economics.categoriesBreakdown.seed.costUah
          );
          const laborUah = economics.totalSalaryUah;
          const totalUah = economics.totalSpentUah;
          const areaHa = economics.areaHa || finiteNumber(field.area_ha);
          const costPerHa =
            areaHa > 0 ? round2(totalUah / areaHa) : null;

          return {
            status: "ok" as const,
            fieldId: field.id,
            fieldName,
            season: seasonId,
            areaHa,
            totalSpentUah: totalUah,
            costPerHaUah: costPerHa,
            breakdown: {
              fuelUah,
              materialsUah,
              laborUah,
              materials: {
                zzr: economics.categoriesBreakdown.zzr.costUah,
                fertilizer: economics.categoriesBreakdown.fertilizer.costUah,
                seed: economics.categoriesBreakdown.seed.costUah,
              },
            },
            budget: {
              plannedPerHa: economics.plannedBudgetPerHa,
              usedPercent: economics.budgetUsedPercentage,
            },
          };
        } catch (error) {
          console.error(
            "[TOOL: getFieldCostAnalysis] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка собівартості",
          };
        }
      },
    }),

    updateFieldDetails: tool({
      description: "Оновлює назву/площу/культуру поля (потрібне confirmed).",
      inputSchema: z.object({
        fieldIdOrName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "ID або назва поля. Якщо не вказано — activeFieldId з контексту"
          ),
        newName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Нова назва поля"),
        newCulture: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Нова сільськогосподарська культура"),
        newArea: z
          .number()
          .positive()
          .optional()
          .describe("Нова площа в гектарах"),
        notes: z
          .string()
          .trim()
          .optional()
          .describe("Примітки до паспорта поля"),
        confirmed: z
          .boolean()
          .default(false)
          .describe(
            "true ЛИШЕ після явного підтвердження користувачем (кнопка Так / «змінюй»)"
          ),
      }),
      execute: async ({
        fieldIdOrName,
        newName,
        newCulture,
        newArea,
        notes,
        confirmed,
      }) => {
        const lookup = (fieldIdOrName?.trim() || defaultFieldId || "").trim();
        const isConfirmed = confirmed === true;
        console.log("[TOOL: updateFieldDetails]", {
          lookup,
          newName,
          newCulture,
          newArea,
          notes: notes != null,
          confirmed: isConfirmed,
        });

        try {
          if (
            !newName?.trim() &&
            !newCulture?.trim() &&
            newArea == null &&
            (notes == null || notes === "")
          ) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error:
                "Вкажи що оновити: назву, культуру, площу (га) або примітки.",
            };
          }

          if (!lookup) {
            return {
              success: false as const,
              status: "needs_slots" as const,
              error: "Вкажи назву або ID поля (або відкрий поле на карті).",
            };
          }

          let resolved = await resolveAgentFieldByLookup(
            supabase,
            lookup,
            "id, name, canonical_name, crop, area_ha, season, notes"
          );
          if (
            !resolved.ok &&
            resolved.status === "error" &&
            (resolved.error.includes("notes") ||
              resolved.error.includes("42703"))
          ) {
            resolved = await resolveAgentFieldByLookup(supabase, lookup);
          }
          if (!resolved.ok) {
            return {
              success: false as const,
              status: resolved.status,
              error: resolved.error,
              candidates: resolved.candidates,
            };
          }

          const { field, fieldName } = resolved;
          const currentArea = finiteNumber(field.area_ha);
          const currentCrop = (field.crop && String(field.crop).trim()) || "";
          const currentName = fieldName;

          const nextArea =
            newArea != null && Number.isFinite(newArea) && newArea > 0
              ? round2(newArea)
              : undefined;
          const nextCulture = newCulture?.trim() || undefined;
          const nextName = newName?.trim() || undefined;

          const areaChanging =
            nextArea != null && Math.abs(nextArea - currentArea) > 0.0001;
          const cultureChanging =
            nextCulture != null &&
            nextCulture.toLocaleLowerCase("uk-UA") !==
              currentCrop.toLocaleLowerCase("uk-UA");
          const nameChanging =
            nextName != null &&
            nextName.toLocaleLowerCase("uk-UA") !==
              currentName.toLocaleLowerCase("uk-UA");

          // Назва / площа / культура — завжди через confirmation
          const needsConfirmation =
            nameChanging || areaChanging || cultureChanging;

          if (needsConfirmation && !isConfirmed) {
            const confirmTarget = nameChanging
              ? nextName!
              : areaChanging && nextArea != null
                ? `${nextArea} га`
                : (nextCulture ?? "");
            const userHint = nameChanging
              ? `Змінити назву поля з «${currentName}» на «${nextName}»?`
              : areaChanging
                ? `Поле ${currentName}: змінити площу з ${currentArea} га на ${nextArea} га`
                : `Поле ${currentName}: змінити культуру з «${currentCrop || "—"}» на «${nextCulture}»`;
            return {
              success: false as const,
              status: "requires_confirmation" as const,
              fieldId: field.id,
              fieldName: currentName,
              current: {
                name: currentName,
                areaHa: currentArea,
                culture: currentCrop || null,
              },
              changes: {
                name: nameChanging
                  ? { from: currentName, to: nextName! }
                  : null,
                area: areaChanging
                  ? { from: currentArea, to: nextArea! }
                  : null,
                culture: cultureChanging
                  ? { from: currentCrop || null, to: nextCulture! }
                  : null,
              },
              pending: {
                newName: nextName ?? null,
                newCulture: nextCulture ?? null,
                newArea: nextArea ?? null,
                notes: notes ?? null,
              },
              warning: areaChanging || cultureChanging
                ? "Зміна площі або культури вплине на розрахунки норм палива, списання ТМЦ та ставки ЗП!"
                : "Підтверди зміну назви перед записом у базу.",
              confirmChoice: nameChanging
                ? `Так, змінити назву на ${nextName}`
                : `Так, підтверджую зміну на ${confirmTarget}`,
              cancelChoice: "Скасувати",
              userHint,
            };
          }

          // notes-only без confirmation — ок; інакше сюди лише з confirmed=true
          return await applyFieldDetailsUpdate(supabase, resolved, {
            name: nextName,
            culture: nextCulture,
            area: nextArea,
            notes,
          });
        } catch (error) {
          console.error(
            "[TOOL: updateFieldDetails] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            success: false as const,
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка оновлення поля",
          };
        }
      },
    }),

    getOperationRates: tool({
      description: "Читає тарифи операцій ₴/га.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log("[TOOL: getOperationRates]");
        try {
          const catalog = [
            ...new Set<string>([
              ...OPERATION_TYPES,
              ...WORK_ORDER_TYPES,
            ]),
          ];

          const [{ data: rateRows, error: ratesError }, { data: opTypes }] =
            await Promise.all([
              supabase
                .from("work_type_wage_rates")
                .select("work_type, rate_uah_per_ha, updated_at")
                .order("work_type"),
              supabase
                .from("field_operations")
                .select("work_type")
                .neq("status", "cancelled")
                .limit(2_000),
            ]);

          if (ratesError) {
            if (
              ratesError.message?.includes("work_type_wage_rates") ||
              ratesError.code === "42P01" ||
              ratesError.code === "42703"
            ) {
              return {
                status: "error" as const,
                error:
                  "Таблиця ставок відсутня. Потрібна міграція 058_field_op_mechanic_wage_rate.sql",
                configured: [],
                missing: catalog.map((operationType) => operationType),
              };
            }
            return {
              status: "error" as const,
              error: ratesError.message,
              configured: [],
              missing: [],
            };
          }

          const rateByType = new Map<string, number>();
          for (const row of rateRows ?? []) {
            const key = normalizeWorkTypeKey(String(row.work_type ?? ""));
            if (!key) continue;
            const rate = Number(row.rate_uah_per_ha);
            if (!Number.isFinite(rate)) continue;
            rateByType.set(key, Math.round(rate * 100) / 100);
          }

          const fromOps = new Set<string>();
          for (const row of opTypes ?? []) {
            const key = normalizeWorkTypeKey(String(row.work_type ?? ""));
            if (key) fromOps.add(key);
          }

          const allTypes = [
            ...new Set([...catalog, ...fromOps, ...rateByType.keys()]),
          ].sort((a, b) => a.localeCompare(b, "uk"));

          const configured: Array<{
            operationType: string;
            ratePerHa: number;
          }> = [];
          const missing: string[] = [];

          for (const operationType of allTypes) {
            const rate = rateByType.get(operationType);
            if (typeof rate === "number" && rate > 0) {
              configured.push({
                operationType,
                ratePerHa: rate,
              });
            } else {
              missing.push(operationType);
            }
          }

          return {
            status: "ok" as const,
            unit: "₴/га",
            configuredCount: configured.length,
            missingCount: missing.length,
            configured,
            missing: missing.slice(0, 40),
          };
        } catch (error) {
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання тарифів",
            configured: [],
            missing: [],
          };
        }
      },
    }),

    setOperationRate: tool({
      description: "Записує тариф ₴/га для типу операції.",
      inputSchema: z.object({
        operationType: z
          .string()
          .trim()
          .min(1)
          .describe("Назва операції (наприклад: Дискування, Посів)"),
        ratePerHa: z
          .number()
          .finite()
          .nonnegative()
          .describe("Тарифна ставка в ₴ за гектар"),
      }),
      execute: async ({ operationType, ratePerHa }) => {
        const normalized =
          normalizeWorkOrderType(operationType) ??
          normalizeWorkTypeKey(operationType);
        if (!normalized) {
          return {
            success: false as const,
            error: "Некоректна назва операції",
          };
        }
        const rate = Math.round(ratePerHa * 100) / 100;
        console.log("[TOOL: setOperationRate]", { normalized, rate });

        try {
          const { error } = await supabase.from("work_type_wage_rates").upsert(
            {
              work_type: normalized,
              rate_uah_per_ha: rate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "work_type" }
          );

          if (error) {
            if (
              error.message?.includes("work_type_wage_rates") ||
              error.code === "42P01"
            ) {
              return {
                success: false as const,
                error:
                  "Потрібна міграція 058 (work_type_wage_rates). Не викликай logUnsupportedRequest.",
              };
            }
            return { success: false as const, error: error.message };
          }

          return {
            success: true as const,
            operationType: normalized,
            ratePerHa: rate,
            message: `Ставку для «${normalized}» оновлено: ${rate} ₴/га`,
          };
        } catch (error) {
          return {
            success: false as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка збереження ставки",
          };
        }
      },
    }),

    logUnsupportedRequest: tool({
      description: "Логує непідтримуваний запит у беклог.",
      inputSchema: z.object({
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(4000)
          .describe(
            "Повний текст запиту користувача, який не вдалося обробити"
          ),
        category: z
          .enum([
            "fields",
            "equipment",
            "fuel",
            "warehouse",
            "finance",
            "accounting",
            "other",
          ])
          .describe("Категорія запиту для беклогу"),
        reason: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .describe(
            "Чому агент не зміг це зробити (бракує інструменту, немає доступу до API тощо)"
          ),
      }),
      execute: async ({ prompt, category, reason }) => {
        console.log("[TOOL: logUnsupportedRequest]", {
          category,
          requestedBy: actorName,
        });
        try {
          const { data, error } = await supabase
            .from("ai_unhandled_requests")
            .insert({
              user_id: actorUserId,
              requested_by: actorName,
              prompt: prompt.trim(),
              category,
              reason: reason.trim(),
            })
            .select("id, created_at")
            .maybeSingle();

          if (error) {
            console.error(
              "[TOOL: logUnsupportedRequest] insert failed:",
              error.message
            );
            return {
              status: "error" as const,
              error: `Не вдалося записати в беклог: ${error.message}`,
              logged: false,
            };
          }

          return {
            status: "logged" as const,
            logged: true,
            id: data?.id ?? null,
            category,
            categoryLabel: unhandledCategoryLabels[category],
            requestedBy: actorName,
            createdAt: data?.created_at ?? null,
            userReplyHint:
              "Повна халепа, такого я ще не вмію робити, але Назар навчить скоро! Записав цей запит Назару в план прокачки.",
          };
        } catch (error) {
          console.error(
            "[TOOL: logUnsupportedRequest] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            logged: false,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка запису беклогу",
          };
        }
      },
    }),

    getUnhandledRequests: tool({
      description: "Читає беклог непідтримуваних запитів.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(10)
          .describe("Скільки останніх запитів повернути (за замовчуванням 10)"),
      }),
      execute: async ({ limit }) => {
        const take = limit ?? 10;
        console.log("[TOOL: getUnhandledRequests]", { limit: take });
        try {
          const { data, error } = await supabase
            .from("ai_unhandled_requests")
            .select("id, prompt, category, reason, requested_by, created_at")
            .order("created_at", { ascending: false })
            .limit(take);

          if (error) {
            return {
              status: "error" as const,
              error: `Не вдалося прочитати беклог: ${error.message}`,
              total: 0,
              recent: [],
            };
          }

          const rows = data ?? [];

          const { count: totalCount } = await supabase
            .from("ai_unhandled_requests")
            .select("id", { count: "exact", head: true });

          return {
            status: "ok" as const,
            total: totalCount ?? rows.length,
            recent: rows.map((row) => ({
              id: row.id,
              prompt: String(row.prompt ?? "").slice(0, 180),
              category: row.category,
              reason: String(row.reason ?? "").slice(0, 120),
              by: row.requested_by,
              at: row.created_at,
            })),
          };
        } catch (error) {
          console.error(
            "[TOOL: getUnhandledRequests] Unexpected error:",
            error instanceof Error ? error.message : error
          );
          return {
            status: "error" as const,
            error:
              error instanceof Error
                ? error.message
                : "Невідома помилка читання беклогу",
            total: 0,
            recent: [],
          };
        }
      },
    }),
  };
}

export async function POST(request: Request) {
  let rawRequest: unknown = null;
  let userId: string | null = null;

  try {
    const authSupabase = await createAuthServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Потрібна авторизація" },
        { status: 401 }
      );
    }
    userId = user.id;

    const actor = await getCurrentActor();
    if (!canAccessLevadius(actor)) {
      return NextResponse.json(
        { ok: false, error: "LEVADIUS поки доступний лише адміністратору" },
        { status: 403 }
      );
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "Не налаштовано GOOGLE_GENERATIVE_AI_API_KEY",
        },
        { status: 500 }
      );
    }

    rawRequest = await request.json();
    const parsed = requestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Некоректний запит",
          details: z.treeifyError(parsed.error),
        },
        { status: 400 }
      );
    }

    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    const uiMessages = (parsed.data.messages ?? [
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text", text: parsed.data.prompt as string }],
      },
    ]) as unknown as UIMessage[];

    const llmMessages = sanitizeUiMessagesForLlm(uiMessages);
    const modelMessages = await convertToModelMessages(llmMessages);
    const promptText = extractPromptText(uiMessages as unknown[]);
    const hasInvoiceAttachment = uiMessagesHaveFileAttachment(
      llmMessages as unknown[]
    );
    const modelCandidates = resolveModelCandidates();
    let activeModelIndex = 0;

    console.log(
      `[LEVADIUS] client=${parsed.data.userContext?.client ?? "?"} models=${modelCandidates.join(" → ")} (start: ${modelCandidates[0]}) attachment=${hasInvoiceAttachment} history=${uiMessages.length}→${llmMessages.length}`
    );

    // AI SDK 7: кілька tool-кроків для наряду (склад → флот → водії → draft)
    const result = streamText({
      model: google(modelCandidates[0]!),
      system: buildSystemPrompt(parsed.data.userContext, {
        hasInvoiceAttachment,
      }),
      messages: modelMessages,
      tools: createAgentTools({
        activeFieldId: parsed.data.userContext?.activeFieldId,
        userId,
        userName: parsed.data.userContext?.userName,
        documentAttachments: extractLastUserFileAttachments(
          uiMessages as unknown[]
        ),
      }),
      providerOptions: {
        google: GOOGLE_NO_THINKING,
      },
      stopWhen: stepCountIs(8),
      maxRetries: 1,
      streamRetries: Math.max(modelCandidates.length - 1, 0),
      prepareStep: () => ({
        model: google(modelCandidates[activeModelIndex]!),
        providerOptions: {
          google: GOOGLE_NO_THINKING,
        },
      }),
      onError: ({ error }) => {
        console.error(
          `[LEVADIUS] streamText error (${modelCandidates[activeModelIndex]}):`,
          errorText(error)
        );

        if (
          isRetriableModelError(error) &&
          activeModelIndex < modelCandidates.length - 1
        ) {
          activeModelIndex += 1;
          console.warn(
            `[LEVADIUS] model retry → fallback ${modelCandidates[activeModelIndex]}`
          );
          return { retry: true };
        }
      },
      onFinish: async ({ text, steps, finishReason }) => {
        try {
          if (!userId) return;
          await writeAgentLog({
            userId,
            request: rawRequest,
            prompt: promptText,
            response: text,
            toolCalls: serializeToolCalls(steps),
            finishReason,
            status: "completed",
            model: modelCandidates[activeModelIndex]!,
          });
        } catch (logError) {
          console.error(
            "Помилка збереження логу LEVADIUS:",
            logError instanceof Error ? logError.message : logError
          );
        }
      },
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      onError: humanizeAgentError,
    });
  } catch (error) {
    const message = humanizeAgentError(error);

    if (userId) {
      try {
        const fallbackPrompt =
          extractPromptText(
            Array.isArray((rawRequest as { messages?: unknown })?.messages)
              ? ((rawRequest as { messages: unknown[] }).messages as unknown[])
              : []
          ) || "Запит без тексту";

        await writeAgentLog({
          userId,
          request: rawRequest,
          prompt: fallbackPrompt,
          response: null,
          toolCalls: [],
          finishReason: null,
          status: "failed",
          model: resolveModelCandidates()[0]!,
          error: message,
        });
      } catch (logError) {
        console.error(
          "Помилка збереження логу LEVADIUS:",
          logError instanceof Error ? logError.message : logError
        );
      }
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
