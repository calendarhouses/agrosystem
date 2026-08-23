import { NextResponse } from "next/server";

import { getBasDocumentLines } from "@/lib/bas-api";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const refKey = searchParams.get("refKey")?.trim() ?? "";

  if (type !== "receipt" && type !== "sale") {
    return NextResponse.json(
      { lines: [], error: "type має бути receipt або sale" },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(refKey)) {
    return NextResponse.json(
      { lines: [], error: "Некоректний refKey" },
      { status: 400 }
    );
  }

  try {
    const lines = await getBasDocumentLines(type, refKey);
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json(
      {
        lines: [],
        error: err instanceof Error ? err.message : "Помилка завантаження",
      },
      { status: 500 }
    );
  }
}
