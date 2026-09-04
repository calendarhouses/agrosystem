import { createServiceSupabase } from "@/lib/supabase/server";

export const OPERATION_DOCS_BUCKET = "operation-docs";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ENTITY = 5;

export const ALLOWED_ATTACHMENT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type AttachmentEntityType =
  | "inventory_move"
  | "fuel_transaction"
  | "accounting_act";

export type OperationAttachment = {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  signedUrl?: string | null;
};

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.\-а-яА-ЯіІїЇєЄґҐ\s]/gu, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

export function validateAttachmentFile(input: {
  mimeType: string;
  sizeBytes: number;
}): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_ATTACHMENT_MIME.has(input.mimeType)) {
    return {
      ok: false,
      error: "Дозволені лише PDF та зображення (JPEG, PNG, WebP)",
    };
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Файл має бути до 10 МБ" };
  }
  return { ok: true };
}

export async function countAttachments(
  entityType: AttachmentEntityType,
  entityId: string
): Promise<number> {
  const supabase = createServiceSupabase();
  const { count, error } = await supabase
    .from("operation_attachments")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (error) return 0;
  return count ?? 0;
}

/** Підрахунок вкладень для списку entity (журнал палива / історія ТМЦ). */
export async function countAttachmentsByEntityIds(
  entityType: AttachmentEntityType,
  entityIds: string[]
): Promise<Record<string, number>> {
  const ids = [...new Set(entityIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("operation_attachments")
      .select("entity_id")
      .eq("entity_type", entityType)
      .in("entity_id", ids);
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data) {
      const id = String(row.entity_id);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

export async function uploadOperationAttachment(input: {
  entityType: AttachmentEntityType;
  entityId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
}): Promise<
  | { ok: true; attachment: OperationAttachment }
  | { ok: false; error: string }
> {
  const entityId = input.entityId.trim();
  if (!entityId) return { ok: false, error: "Невірний id операції" };

  const sizeBytes =
    input.bytes instanceof ArrayBuffer
      ? input.bytes.byteLength
      : input.bytes.byteLength;
  const check = validateAttachmentFile({
    mimeType: input.mimeType,
    sizeBytes,
  });
  if (!check.ok) return check;

  const existing = await countAttachments(input.entityType, entityId);
  if (existing >= MAX_ATTACHMENTS_PER_ENTITY) {
    return {
      ok: false,
      error: `Максимум ${MAX_ATTACHMENTS_PER_ENTITY} файлів на операцію`,
    };
  }

  const supabase = createServiceSupabase();
  const safeName = sanitizeFileName(input.fileName || "document");
  const storagePath = `${input.entityType}/${entityId}/${crypto.randomUUID()}_${safeName}`;

  const body =
    input.bytes instanceof Buffer
      ? input.bytes
      : Buffer.from(input.bytes as ArrayBuffer);

  const { error: upErr } = await supabase.storage
    .from(OPERATION_DOCS_BUCKET)
    .upload(storagePath, body, {
      contentType: input.mimeType,
      upsert: false,
    });

  if (upErr) {
    return {
      ok: false,
      error:
        upErr.message.includes("Bucket not found") ||
        upErr.message.includes("not found")
          ? "Bucket operation-docs не створено. Виконай міграцію 039 у Supabase."
          : upErr.message,
    };
  }

  const { data, error } = await supabase
    .from("operation_attachments")
    .insert({
      entity_type: input.entityType,
      entity_id: entityId,
      storage_path: storagePath,
      file_name: safeName,
      mime_type: input.mimeType,
      size_bytes: sizeBytes,
    })
    .select(
      "id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, created_at"
    )
    .single();

  if (error) {
    await supabase.storage.from(OPERATION_DOCS_BUCKET).remove([storagePath]);
    return {
      ok: false,
      error:
        error.message.includes("operation_attachments") ||
        error.code === "42P01" ||
        error.code === "PGRST205"
          ? "Потрібна міграція 039 (накладні). Виконай SQL у Supabase."
          : error.message,
    };
  }

  return {
    ok: true,
    attachment: {
      id: String(data.id),
      entityType: data.entity_type as AttachmentEntityType,
      entityId: String(data.entity_id),
      storagePath: String(data.storage_path),
      fileName: String(data.file_name),
      mimeType: String(data.mime_type),
      sizeBytes: Number(data.size_bytes) || 0,
      createdAt: String(data.created_at),
    },
  };
}

export async function listOperationAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
  withSignedUrls = true
): Promise<
  | { ok: true; attachments: OperationAttachment[] }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("operation_attachments")
      .select(
        "id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, created_at"
      )
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: true });

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        return { ok: true, attachments: [] };
      }
      return { ok: false, error: error.message };
    }

    const attachments: OperationAttachment[] = [];
    for (const row of data ?? []) {
      let signedUrl: string | null = null;
      if (withSignedUrls) {
        const { data: signed } = await supabase.storage
          .from(OPERATION_DOCS_BUCKET)
          .createSignedUrl(String(row.storage_path), 60 * 30);
        signedUrl = signed?.signedUrl ?? null;
      }
      attachments.push({
        id: String(row.id),
        entityType: row.entity_type as AttachmentEntityType,
        entityId: String(row.entity_id),
        storagePath: String(row.storage_path),
        fileName: String(row.file_name),
        mimeType: String(row.mime_type),
        sizeBytes: Number(row.size_bytes) || 0,
        createdAt: String(row.created_at),
        signedUrl,
      });
    }
    return { ok: true, attachments };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити файли",
    };
  }
}

export async function deleteOperationAttachment(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const attachmentId = id?.trim();
  if (!attachmentId) return { ok: false, error: "Невірний id" };

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("operation_attachments")
      .select("id, storage_path")
      .eq("id", attachmentId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Файл не знайдено" };

    await supabase.storage
      .from(OPERATION_DOCS_BUCKET)
      .remove([String(data.storage_path)]);

    const { error: delErr } = await supabase
      .from("operation_attachments")
      .delete()
      .eq("id", attachmentId);
    if (delErr) return { ok: false, error: delErr.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Не вдалося видалити файл",
    };
  }
}

/** Видалити всі вкладення сутності (storage + рядки). Помилки не валять delete операції. */
export async function deleteAttachmentsForEntity(
  entityType: AttachmentEntityType,
  entityId: string
): Promise<void> {
  const id = entityId?.trim();
  if (!id) return;
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("operation_attachments")
      .select("id, storage_path")
      .eq("entity_type", entityType)
      .eq("entity_id", id);
    if (error || !data?.length) return;

    const paths = data
      .map((row) => String(row.storage_path || "").trim())
      .filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from(OPERATION_DOCS_BUCKET).remove(paths);
    }
    await supabase
      .from("operation_attachments")
      .delete()
      .eq("entity_type", entityType)
      .eq("entity_id", id);
  } catch {
    /* best-effort */
  }
}
