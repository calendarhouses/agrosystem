/**
 * Telegram Bot API (sendMessage) для проактивних сповіщень LEVADIUS.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN — токен бота
 *   TELEGRAM_CHAT_ID — основний чат керівника (опційно, якщо немає в profiles)
 */

import { createServiceSupabase } from "@/lib/supabase/server";

const TELEGRAM_API = "https://api.telegram.org";

export type TelegramSendResult = {
  ok: boolean;
  chatId: string;
  messageId?: number;
  error?: string;
};

function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Чат з env (один або кілька через кому). */
function envChatIds(): string[] {
  const raw =
    process.env.TELEGRAM_CHAT_ID?.trim() ||
    process.env.TELEGRAM_MANAGER_CHAT_ID?.trim() ||
    "";
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Отримувачі: env + profiles.telegram_chat_id (admin/owner).
 */
export async function resolveTelegramChatIds(): Promise<string[]> {
  const ids = new Set<string>(envChatIds());

  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("profiles")
      .select("telegram_chat_id, role")
      .not("telegram_chat_id", "is", null)
      .in("role", ["admin", "owner"])
      .limit(50);

    for (const row of data ?? []) {
      const chat = String(row.telegram_chat_id ?? "").trim();
      if (chat) ids.add(chat);
    }
  } catch (err) {
    console.warn(
      "[telegram] profiles.telegram_chat_id:",
      err instanceof Error ? err.message : err
    );
  }

  return Array.from(ids);
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: { disableNotification?: boolean }
): Promise<TelegramSendResult> {
  const token = botToken();
  if (!token) {
    return { ok: false, chatId, error: "TELEGRAM_BOT_TOKEN не задано" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, chatId, error: "Порожній текст" };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: trimmed.slice(0, 4000),
        disable_notification: options?.disableNotification === true,
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    } | null;

    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        chatId,
        error: body?.description || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      chatId,
      messageId: body.result?.message_id,
    };
  } catch (err) {
    return {
      ok: false,
      chatId,
      error: err instanceof Error ? err.message : "Telegram network error",
    };
  }
}

/** Надіслати всім відомим чатам керівництва. */
export async function broadcastTelegram(
  text: string,
  options?: { disableNotification?: boolean }
): Promise<{
  ok: boolean;
  sent: number;
  results: TelegramSendResult[];
  error?: string;
}> {
  if (!botToken()) {
    return {
      ok: false,
      sent: 0,
      results: [],
      error: "TELEGRAM_BOT_TOKEN не задано",
    };
  }
  const chats = await resolveTelegramChatIds();
  if (chats.length === 0) {
    return {
      ok: false,
      sent: 0,
      results: [],
      error:
        "Немає telegram_chat_id (задайте TELEGRAM_CHAT_ID або profiles.telegram_chat_id)",
    };
  }

  const results: TelegramSendResult[] = [];
  for (const chatId of chats) {
    results.push(await sendTelegramMessage(chatId, text, options));
  }
  const sent = results.filter((r) => r.ok).length;
  return { ok: sent > 0, sent, results };
}
