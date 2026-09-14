import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";

/** Скільки UI-повідомлень тримаємо в БД на активного користувача */
export const AI_CHAT_STORED_MESSAGE_LIMIT = 60;

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown[];
};

function isStoredChatMessage(value: unknown): value is StoredChatMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.role === "user" || row.role === "assistant" || row.role === "system") &&
    Array.isArray(row.parts)
  );
}

/** Прибираємо важкі file/data URL з історії (фото вже відпрацьовані). */
export function slimMessagesForStorage(
  messages: unknown[],
  limit = AI_CHAT_STORED_MESSAGE_LIMIT
): StoredChatMessage[] {
  const sliced = messages.slice(-limit);
  const out: StoredChatMessage[] = [];

  for (const raw of sliced) {
    if (!isStoredChatMessage(raw)) continue;
    const parts: unknown[] = [];
    let strippedFiles = 0;

    for (const part of raw.parts) {
      if (!part || typeof part !== "object") {
        parts.push(part);
        continue;
      }
      const row = part as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type : "";
      if (
        type === "file" ||
        type === "image" ||
        type === "file-url" ||
        (typeof row.url === "string" && row.url.startsWith("data:"))
      ) {
        strippedFiles += 1;
        continue;
      }
      parts.push(part);
    }

    if (strippedFiles > 0 && raw.role === "user") {
      parts.unshift({
        type: "text",
        text: `[Раніше прикріплено файл(и): ${strippedFiles}]`,
      });
    }

    if (parts.length === 0 && raw.role === "assistant") {
      parts.push({ type: "text", text: "[Відповідь]" });
    }

    out.push({
      id: raw.id,
      role: raw.role,
      parts,
    });
  }

  return out;
}

export async function getActiveChatThread(userId: string): Promise<{
  conversationId: string | null;
  messages: StoredChatMessage[];
  updatedAt: string | null;
}> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_chat_threads")
    .select("id, messages, updated_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return { conversationId: null, messages: [], updatedAt: null };
  }

  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages = slimMessagesForStorage(rawMessages);

  return {
    conversationId: String(data.id),
    messages,
    updatedAt:
      data.updated_at != null ? String(data.updated_at) : null,
  };
}

export async function saveActiveChatThread(
  userId: string,
  messages: unknown[],
  title?: string | null
): Promise<{ conversationId: string; messageCount: number }> {
  const supabase = createServiceSupabase();
  const slim = slimMessagesForStorage(messages);
  const now = new Date().toISOString();

  const { data: existing, error: findError } = await supabase
    .from("ai_chat_threads")
    .select("id")
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();

  if (findError) throw new Error(findError.message);

  if (existing?.id) {
    const { error } = await supabase
      .from("ai_chat_threads")
      .update({
        messages: slim,
        updated_at: now,
        ...(title != null && title.trim()
          ? { title: title.trim().slice(0, 120) }
          : {}),
      })
      .eq("id", existing.id)
      .eq("user_id", userId);

    if (error) throw new Error(error.message);
    return { conversationId: String(existing.id), messageCount: slim.length };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ai_chat_threads")
    .insert({
      user_id: userId,
      messages: slim,
      title: title?.trim()?.slice(0, 120) || null,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);
  return {
    conversationId: String(inserted.id),
    messageCount: slim.length,
  };
}

/** «Очистити діалог» — архівуємо активний тред і створюємо порожній. */
export async function archiveActiveChatThread(userId: string): Promise<{
  archivedId: string | null;
  conversationId: string;
}> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("ai_chat_threads")
    .select("id")
    .eq("user_id", userId)
    .is("archived_at", null)
    .maybeSingle();

  let archivedId: string | null = null;
  if (existing?.id) {
    const { error } = await supabase
      .from("ai_chat_threads")
      .update({ archived_at: now, updated_at: now })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    archivedId = String(existing.id);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ai_chat_threads")
    .insert({
      user_id: userId,
      messages: [],
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message);
  return { archivedId, conversationId: String(inserted.id) };
}

export function deriveChatTitle(messages: StoredChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;
  const text = firstUser.parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const row = part as { type?: string; text?: string };
      return row.type === "text" && typeof row.text === "string" ? row.text : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
