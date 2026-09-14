import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveActiveChatThread,
  deriveChatTitle,
  getActiveChatThread,
  saveActiveChatThread,
  slimMessagesForStorage,
} from "@/lib/agent-chat-history";
import { getCurrentActor } from "@/lib/app-actor";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

const putSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).max(120),
});

async function requireLevadiusUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const authSupabase = await createAuthServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await authSupabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Потрібна авторизація" },
        { status: 401, headers: JSON_UTF8 }
      ),
    };
  }

  const actor = await getCurrentActor();
  if (!canAccessLevadius(actor)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Немає доступу до LEVADIUS" },
        { status: 403, headers: JSON_UTF8 }
      ),
    };
  }

  return { ok: true, userId: user.id };
}

/** GET — активна історія цього акаунта */
export async function GET() {
  try {
    const auth = await requireLevadiusUser();
    if (!auth.ok) return auth.response;

    const thread = await getActiveChatThread(auth.userId);
    return NextResponse.json(
      {
        ok: true,
        conversationId: thread.conversationId,
        messages: thread.messages,
        updatedAt: thread.updatedAt,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    console.error(
      "[api/agent/chat GET]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося завантажити історію чату",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

/** PUT — зберегти messages активного діалогу */
export async function PUT(request: Request) {
  try {
    const auth = await requireLevadiusUser();
    if (!auth.ok) return auth.response;

    const raw = await request.json();
    const parsed = putSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Некоректний запит" },
        { status: 400, headers: JSON_UTF8 }
      );
    }

    const slim = slimMessagesForStorage(parsed.data.messages);
    const title = deriveChatTitle(slim);
    const saved = await saveActiveChatThread(auth.userId, slim, title);

    return NextResponse.json(
      {
        ok: true,
        conversationId: saved.conversationId,
        messageCount: saved.messageCount,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    console.error(
      "[api/agent/chat PUT]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося зберегти історію чату",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

/** DELETE — очистити: архів + новий порожній тред */
export async function DELETE() {
  try {
    const auth = await requireLevadiusUser();
    if (!auth.ok) return auth.response;

    const result = await archiveActiveChatThread(auth.userId);
    return NextResponse.json(
      {
        ok: true,
        archivedId: result.archivedId,
        conversationId: result.conversationId,
      },
      { headers: JSON_UTF8 }
    );
  } catch (error) {
    console.error(
      "[api/agent/chat DELETE]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося очистити історію чату",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}
