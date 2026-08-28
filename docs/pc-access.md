# ПК-доступ (реліз v1)

## Політика ролей

На першому ПК-релізі ролі (`admin` | `owner` | `agronomist` | `accountant`) —
**підписи в UI та в аудиті**, а не обмеження доступу.

Усі залогінені користувачі мають **повний доступ** до операційних екранів
і бухгалтерії (`/accounting`, мапінг, звірка, Excel). Окремого RBAC по
сторінках / API ще немає.

Коли знадобиться жорсткий розподіл прав — додати гейти окремо (напр.
бухгалтерія лише `accountant|admin`, `/admin/*` лише `admin`).

## Безпека даних

- Anon key більше не має write/read на операційних таблицях (міграція `044`).
- Користувач не може сам змінити `profiles.role` (тригер).
- Без `NEXT_PUBLIC_SUPABASE_*` у production middleware fail-closed → `/login`.

## Seed команди

Паролі **не** зберігаються в репозиторії. Перед `npm run seed:team` задайте
в `.env.local`:

```
TEAM_OWNER_PASSWORD=...
TEAM_AGRONOMIST_PASSWORD=...
TEAM_ACCOUNTANT_PASSWORD=...
```

Після релізу змініть паролі в Supabase Dashboard.
