import { NextRequest, NextResponse } from "next/server";

import { deleteOperationAttachment } from "@/lib/operation-attachments";

export const runtime = "nodejs";

/** DELETE /api/attachments/[id] */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const res = await deleteOperationAttachment(id);
  if (!res.ok) {
    return NextResponse.json(res, { status: 400 });
  }
  return NextResponse.json(res);
}
