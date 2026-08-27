import { NextRequest, NextResponse } from "next/server";

import {
  listOperationAttachments,
  uploadOperationAttachment,
  type AttachmentEntityType,
} from "@/lib/operation-attachments";

export const runtime = "nodejs";

const ENTITY_TYPES = new Set<AttachmentEntityType>([
  "inventory_move",
  "fuel_transaction",
]);

function parseEntityType(raw: string | null): AttachmentEntityType | null {
  if (!raw) return null;
  return ENTITY_TYPES.has(raw as AttachmentEntityType)
    ? (raw as AttachmentEntityType)
    : null;
}

/** GET /api/attachments?entityType=&entityId= */
export async function GET(request: NextRequest) {
  const entityType = parseEntityType(
    request.nextUrl.searchParams.get("entityType")
  );
  const entityId = request.nextUrl.searchParams.get("entityId")?.trim() || "";
  if (!entityType || !entityId) {
    return NextResponse.json(
      { ok: false, error: "Потрібні entityType та entityId" },
      { status: 400 }
    );
  }

  const res = await listOperationAttachments(entityType, entityId, true);
  if (!res.ok) {
    return NextResponse.json(res, { status: 500 });
  }
  return NextResponse.json(res);
}

/** POST /api/attachments — multipart: entityType, entityId, file */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const entityType = parseEntityType(String(form.get("entityType") ?? ""));
    const entityId = String(form.get("entityId") ?? "").trim();
    const file = form.get("file");

    if (!entityType || !entityId) {
      return NextResponse.json(
        { ok: false, error: "Потрібні entityType та entityId" },
        { status: 400 }
      );
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Додайте файл" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const res = await uploadOperationAttachment({
      entityType,
      entityId,
      fileName: file.name || "document",
      mimeType: file.type || "application/octet-stream",
      bytes,
    });

    if (!res.ok) {
      return NextResponse.json(res, { status: 400 });
    }

    const listed = await listOperationAttachments(entityType, entityId, true);
    const withUrl =
      listed.ok
        ? listed.attachments.find((a) => a.id === res.attachment.id)
        : res.attachment;

    return NextResponse.json({ ok: true, attachment: withUrl ?? res.attachment });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Не вдалося завантажити файл",
      },
      { status: 500 }
    );
  }
}
