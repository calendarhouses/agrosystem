import { NextResponse } from "next/server";

import { requestFuelBasDraftSync } from "@/lib/fuel-bas-sync";

export const runtime = "nodejs";

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

type Body = {
  transactionId?: string;
  equipmentHint?: string | null;
};

/**
 * POST /api/fuel/transactions/send-1c
 * Готує чернетку BAS (Posted: false). Жива відправка вимкнена (bas-readonly).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const transactionId = body.transactionId?.trim();
    if (!transactionId) {
      return NextResponse.json(
        { ok: false, error: "Немає id транзакції" },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    const result = await requestFuelBasDraftSync(transactionId, {
      equipmentHint: body.equipmentHint ?? null,
    });

    return NextResponse.json(
      {
        ok: true,
        status: result.status,
        sentToBas: result.sentToBas,
        message: result.message,
        draft: result.draft,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося підготувати чернетку 1С",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}
