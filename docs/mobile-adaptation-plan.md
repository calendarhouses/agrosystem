# Мобільна адаптація AgroSystem — архітектура і план робіт

> Статус: **Фаза 0 (фундамент)** — у процесі. Розділи адаптуються ітеративно.
> Агро-Радар (`/calendar`) виключено з цього плану — вже зроблений під mobile-first.

## Мета

Перетворити AgroSystem на **PWA-додаток** з преміальним мобільним UX (iOS + Android):
- повноекранний режим без «браузерного» відчуття;
- нижня навігація замість лівого сайдбару;
- touch-first панелі, sheet-и, жести;
- стабільна робота на екранах 360–430px.

---

## Фаза 0 — Фундамент (shell + PWA)

### Що вже зроблено

| Компонент | Файли | Опис |
|-----------|-------|------|
| PWA manifest | `public/manifest.webmanifest`, `app/icon.tsx`, `public/icons/*` | `standalone`, іконки 192/512 |
| Viewport / meta | `app/layout.tsx` | `viewport-fit: cover`, `theme-color`, Apple Web App |
| Єдина навігація | `lib/navigation.ts` | Sidebar + Bottom Nav з одного джерела |
| Bottom Nav | `components/layout/bottom-nav.tsx` | 4 основні + «Ще» (sheet) |
| Sidebar desktop | `components/layout/sidebar.tsx` | `hidden md:flex` — на мобільному прихований |
| App Shell | `components/layout/app-shell.tsx` | `pb` під bottom nav, без `pl-16` на mobile |
| Install onboarding | `/install`, `components/pwa/install-prompt.tsx` | Перший візит → інструкція PWA |
| PWA utils | `lib/pwa.ts` | standalone detection, localStorage flags |

### Що ще в Фазі 0

- [ ] Service Worker (offline shell, cache static) — `@serwist/next` або мінімальний SW
- [ ] Push notifications (опційно, пізніше)
- [ ] Глобальні mobile tokens: `--mobile-nav-height`, safe-area helpers
- [ ] Toaster позиція над bottom nav на mobile
- [ ] `useIsMobile()` хук у `lib/use-mobile.ts` (замість дублювання `useMediaQuery`)
- [ ] QA чеклист: iPhone Safari, Chrome Android, PWA standalone

### Архітектура shell

```
┌─────────────────────────────────────┐
│  TopBar (season/search) — desktop   │  ← прихований на command center
├─────────────────────────────────────┤
│                                     │
│           Content Area              │
│     (scroll / map / sheets)         │
│                                     │
├─────────────────────────────────────┤
│  BottomNav (md:hidden)              │  ← Поля · Техніка · Паливо · Склад · Ще
└─────────────────────────────────────┘

Desktop (md+): Sidebar зліва замість BottomNav
```

**Правило для всіх розділів:** контент не повинен ховатися під bottom nav. Використовувати `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` або utility `safe-bottom-nav`.

**Правило для Sheet/Dialog:** на mobile — `side="bottom"` або full-screen; на desktop — `side="right"`.

---

## 1. Поля (`/` — FieldsView)

**Файли:** `fields-view.tsx`, `fields-glass-panel.tsx`, `fields-map.tsx`, `field-detail-sheet.tsx`

### Поточний стан
- Карта full-bleed, ліва glass-панель — `hidden md:flex`
- Mobile: bottom drawer зі списком полів (`mobileExpanded`)
- Права панель деталей — sheet на mobile

### Відомі проблеми
- Кнопки малювання на карті можуть перекривати bottom nav
- Field detail sheet — дуже довгий, таби не оптимізовані під thumb zone
- Draw controls Mapbox — дрібні touch targets
- `pl-16` прибрано з shell, але floating chrome може конфліктувати з nav

### План робіт
1. **Map chrome** — підняти FAB/controls на `bottom-[calc(4.5rem+safe-area)]`
2. **Field list drawer** — snap points (peek / half / full), swipe-to-close
3. **Field detail** — mobile tabs → горизонтальний scroll або accordion
4. **Passport form** — sticky footer «Зберегти», inputs `text-base` (no iOS zoom)
5. **Draw mode** — великі touch кнопки (мін. 44×44px)
6. **Performance** — lazy load finance tab, throttle map resize on keyboard

**Пріоритет:** 🔴 Високий (головний екран)

---

## 2. Техніка (`/equipment` — EquipmentView)

**Файли:** `equipment-view.tsx`, `equipment-fleet-glass-panel.tsx`, `equipment-command-map.tsx`, `equipment-vehicle-360-dashboard.tsx`

### Поточний стан
- Аналогічна архітектура Command Center як у полів
- `useMediaQuery("(min-width: 768px)")` для desktop map layout
- Mobile fleet drawer внизу

### Відомі проблеми
- Vehicle 360 dashboard — горизонтальні графіки не вміщаються
- Track playback panel — перекриває карту
- Day journal export — кнопки в header overflow
- Popover calendar — погано на малих екранах

### План робіт
1. **Fleet drawer** — той самий snap pattern що й поля
2. **Vehicle detail** — full-screen sheet на mobile, спрощений KPI (3 метрики)
3. **Track playback** — bottom sheet з timeline slider (thumb-friendly)
4. **Day picker** — замінити Popover на bottom sheet calendar
5. **Alerts center** — collapsible banner замість fixed overlay
6. **Export actions** — в «⋯» menu на mobile

**Пріоритет:** 🔴 Високий

---

## 3. Паливо (`/fuel` — FuelView)

**Файли:** `fuel-view.tsx`, `fuel-action-dialogs.tsx`, `fuel-detail-sheet.tsx`, `fuel-dashboard-header.tsx`

### Поточний стан
- Картки сховищ з декоративною «рідиною» справа
- Журнал транзакцій — табличний layout
- Багато Dialog для дій (заправка, списання, переміщення)

### Відомі проблеми
- Storage cards — `pr-[5.25rem]` обрізає контент на вузьких екранах
- Journal rows — довгі тексти, overflow
- Period tabs — не поміщаються в один ряд
- Dialog forms — не full-screen, кнопки внизу за межами viewport

### План робіт
1. **Storage grid** — 1 col mobile, спрощена картка без бокової смуги
2. **Journal** — card-list замість table; swipe actions (edit/delete)
3. **Period filter** — horizontal scroll chips або bottom sheet
4. **Action dialogs** → **bottom sheets** на mobile (`useIsMobile`)
5. **Fuel detail sheet** — full height, sticky CTA
6. **Header stats** — 2×2 grid замість 4 в ряд

**Пріоритет:** 🟠 Середній-високий

---

## 4. Склад (`/inventory` — InventoryView)

**Файли:** `inventory-view.tsx`, `inventory-*-sheet.tsx`, `quick-issue-sheet.tsx`

### Поточний стан
- Категорії ЗЗР/врожай/добрива — grid карток
- Item detail — правий Sheet
- Багато операцій: inbound, sale, issue, local moves

### Відомі проблеми
- `grid-cols-3` KPI — дрібний текст
- Item cards — кнопки `MoreHorizontal` важко влучити
- Search + filters — wrap ламає layout
- Category sheets — довгі форми без progress

### План робіт
1. **KPI row** — 2 cols mobile, truncate + tooltip
2. **Item cards** — full-width, action bar внизу картки (48px targets)
3. **Filters** — sticky top bar, collapsible «Фільтри»
4. **All sheets** — `side="bottom"` + `h-[92dvh]` на mobile
5. **Sale/Issue flows** — step wizard (товар → кількість → підтвердження)
6. **History** — infinite scroll замість великої таблиці

**Пріоритет:** 🟠 Середній-високий

---

## 5. Фінанси (`/finance` — FinanceView)

**Файли:** `finance-view.tsx`, `finance-drill-sheet.tsx`, `field-detail-sheet.tsx` (drill)

### Поточний стан
- KPI cards, burn rate по полях, charts (recharts)
- Season selector у header
- Drill-down sheets

### Відомі проблеми
- `grid-cols-5` summary — ламається на 320px
- Charts — legends обрізані
- Burn rate list — desktop table mindset
- Sticky headers конфліктують з tabs

### План робіт
1. **Hero KPI** — vertical stack, один головний показник
2. **Charts** — simplified mobile variants (sparklines)
3. **Field burn list** — cards з progress bar
4. **Drill sheet** — full screen, back gesture
5. **Season picker** — в header row або bottom sheet
6. **Horizontal scroll** для category breakdown — `no-scrollbar` + fade edge

**Пріоритет:** 🟡 Середній

---

## 6. Бухгалтерія (`/accounting` — AccountingHub)

**Файли:** `accounting-hub.tsx`, `accountant-hub-view.tsx`, `reconciliation-studio.tsx`, `mapping-studio.tsx`

### Поточний стан
- 4 вкладки: Експорт, Звірка, Мапінг, Журнал
- Reconciliation — split view (desktop-oriented)
- Mapping — combobox tables

### Відомі проблеми
- TabsList wrap — 4 таби на 360px тісно
- Reconciliation — дві колонки не читаються
- Mapping studio — широкі таблиці, horizontal scroll без hint
- Export tab — fixed bottom bar може конфліктувати з nav

### План робіт
1. **Tabs** — scrollable pill bar або 2+2 grid icons
2. **Reconciliation** — stack layout: «наш запис» → «BAS» → дія
3. **Mapping** — wizard: каталог → пошук → звʼязати (по одному рядку)
4. **Export** — bottom CTA над nav
5. **Activity journal** — timeline cards (вже близько до mobile)
6. **Admin links** — тільки в «Ще» або desktop

**Пріоритет:** 🟡 Середній (частіше desktop у бухгалтерів)

---

## 7. Admin (`/admin/*`)

**Файли:** `app/admin/**`, `components/admin/**`

### Рішення
**Mobile-lite:** базовий перегляд + критичні дії. Повний CRUD — desktop-first.

### План
1. Redirect banner «Краще на компʼютері» на складних сторінках (mapping, bas-request)
2. Field registry — список ok, редагування через sheet
3. Приховати з bottom nav (доступ через deep links / accounting)

**Пріоритет:** 🟢 Низький

---

## 8. Login / Auth

**Файли:** `app/login/*`, `install-prompt.tsx`

### Зроблено
- `/install` onboarding перед логіном
- Redirect з `/login` при першому візиті

### Залишилось
- Перевірити `next` param після install → login → target
- Keyboard overlap на iOS (input scroll into view)
- Face ID / saved passwords — нативна поведінка PWA

**Пріоритет:** 🟠 Середній (частково готово)

---

## Технічні конвенції (для всіх PR)

### Breakpoints
- **Mobile:** `< 768px` (`md`)
- **Tablet:** `768–1024px` — sidebar + адаптивні grid
- **Desktop:** `> 1024px` — поточний дизайн

### Touch targets
- Мінімум **44×44px** для кнопок і nav items
- `text-base` (16px) для inputs — уникнення zoom на iOS

### Sheets vs Dialogs
```tsx
const isMobile = useIsMobile();
<SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "h-[92dvh] rounded-t-3xl" : ""} />
```

### Map sections
- Floating UI: `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`
- Map resize on `visualViewport` resize (iOS keyboard)

### Тестування
- [ ] iPhone 14/15 Safari + PWA standalone
- [ ] Android Chrome + «Додати на головний екран»
- [ ] Landscape mode (maps)
- [ ] 320px width (iPhone SE)
- [ ] Safe area (notch, home indicator)

---

## Порядок імплементації (рекомендований)

| Спринт | Розділ | Оцінка |
|--------|--------|--------|
| ✅ 0 | PWA + Shell + Bottom Nav | 1–2 дні |
| 1 | Поля | 2–3 дні |
| 2 | Техніка | 2–3 дні |
| 3 | Паливо | 1–2 дні |
| 4 | Склад | 2–3 дні |
| 5 | Фінанси | 1–2 дні |
| 6 | Бухгалтерія | 2 дні |
| 7 | Admin polish | 1 день |

---

## Bottom Nav — склад

| Слот | Розділ | Решта в «Ще» |
|------|--------|--------------|
| 1 | Поля | |
| 2 | Техніка | |
| 3 | Паливо | |
| 4 | Склад | |
| 5 | Ще | Агро-Радар, Фінанси, Бухгалтерія, Профіль, Вийти |

Агро-Радар у «Ще» — компроміс (5 слотів max). Можна поміняти Паливо ↔ Радар за пріоритетом користувачів.
