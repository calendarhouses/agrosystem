import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";

import { getCurrentActor } from "@/lib/app-actor";
import { canAccessLevadius } from "@/lib/levadius-access";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/aac",
  "audio/m4a",
  "video/webm", // деякі браузери так мітять MediaRecorder
]);

function resolveModelId(): string {
  return (
    process.env.GOOGLE_GENERATIVE_AI_MODEL?.trim() || "gemini-3.7-flash"
  );
}

function normalizeMime(raw: string | null | undefined, fileName: string): string {
  const mime = (raw || "").trim().toLowerCase().split(";")[0] || "";
  if (mime && ALLOWED_MIME.has(mime)) return mime === "video/webm" ? "audio/webm" : mime;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "audio/webm";
}

export async function POST(request: Request) {
  try {
    const authSupabase = await createAuthServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Потрібна авторизація" },
        { status: 401 }
      );
    }

    const actor = await getCurrentActor();
    if (!canAccessLevadius(actor)) {
      return NextResponse.json(
        { ok: false, error: "LEVADIUS поки доступний лише адміністратору" },
        { status: 403 }
      );
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Не налаштовано GOOGLE_GENERATIVE_AI_API_KEY" },
        { status: 500 }
      );
    }

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "Немає аудіофайлу" },
        { status: 400 }
      );
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Аудіо занадто велике (макс. 8 МБ)" },
        { status: 400 }
      );
    }

    const mediaType = normalizeMime(audio.type, audio.name || "voice.webm");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    const modelId = resolveModelId();

    const result = await generateText({
      model: google(modelId),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
            includeThoughts: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Транскрибуй українською мовою голосове повідомлення диспетчера.",
                "Поверни лише чистий текст команди без лапок, преамбул і пояснень.",
                "Якщо мови майже немає — поверни порожній рядок.",
              ].join(" "),
            },
            {
              type: "file",
              data: bytes,
              mediaType,
            },
          ],
        },
      ],
    });

    const text = (result.text || "").trim();
    return NextResponse.json({ ok: true, text, model: modelId });
  } catch (error) {
    console.error(
      "[LEVADIUS:transcribe]",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося розпізнати голос",
      },
      { status: 500 }
    );
  }
}
