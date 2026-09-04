"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureLevadiusMicPermission } from "@/lib/levadius-mic-permission";
import { cn } from "@/lib/utils";

const LANG = "uk-UA";
const SILENCE_MS = 1500;
const MAX_FALLBACK_MS = 45_000;
const SILENCE_RMS = 0.018;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export type VoiceInputButtonProps = {
  disabled?: boolean;
  /** Поточний текст інпута — щоб дописувати після вже набраного */
  value?: string;
  onTranscript: (text: string) => void;
  /** Hands-free: після тиші 1.5с або Стоп — відправити */
  onAutoSend: (text: string) => void;
  className?: string;
};

type Mode = "idle" | "speech" | "fallback" | "transcribing";

export function VoiceInputButton({
  disabled = false,
  value = "",
  onTranscript,
  onAutoSend,
  className,
}: VoiceInputButtonProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const baselineRef = useRef("");
  const finalChunkRef = useRef("");
  const interimRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const sentRef = useRef(false);
  const heardSpeechRef = useRef(false);
  const modeRef = useRef<Mode>("idle");

  const onTranscriptRef = useRef(onTranscript);
  const onAutoSendRef = useRef(onAutoSend);
  onTranscriptRef.current = onTranscript;
  onAutoSendRef.current = onAutoSend;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const hasSpeech = Boolean(getSpeechRecognitionCtor());
    const hasMedia =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";
    setSupported(hasSpeech || hasMedia);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const composeText = useCallback((finalPart: string, interimPart = "") => {
    const base = baselineRef.current.trimEnd();
    const spoken = `${finalPart}${interimPart}`.replace(/\s+/g, " ").trim();
    if (!spoken) return base;
    if (!base) return spoken;
    return `${base} ${spoken}`;
  }, []);

  const pushTranscript = useCallback(
    (finalPart: string, interimPart = "") => {
      onTranscriptRef.current(composeText(finalPart, interimPart));
    },
    [composeText]
  );

  const stopAudioGraph = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    silenceSinceRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const cleanupAll = useCallback(() => {
    clearSilenceTimer();
    clearMaxTimer();
    stopAudioGraph();
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
    stopMediaTracks();
    audioChunksRef.current = [];
    finishingRef.current = false;
    sentRef.current = false;
    heardSpeechRef.current = false;
  }, [clearMaxTimer, clearSilenceTimer, stopAudioGraph, stopMediaTracks]);

  useEffect(() => () => cleanupAll(), [cleanupAll]);

  const finishWithText = useCallback(
    (text: string) => {
      if (sentRef.current || finishingRef.current) return;
      finishingRef.current = true;
      sentRef.current = true;
      clearSilenceTimer();
      clearMaxTimer();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      const trimmed = text.trim();
      setMode("idle");
      modeRef.current = "idle";
      if (trimmed) {
        onTranscriptRef.current(trimmed);
        onAutoSendRef.current(trimmed);
      }
      finishingRef.current = false;
    },
    [clearMaxTimer, clearSilenceTimer]
  );

  const scheduleSilenceSend = useCallback(
    (getText: () => string) => {
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        const text = getText().trim();
        if (modeRef.current === "fallback") {
          try {
            mediaRecorderRef.current?.stop();
          } catch {
            /* ignore */
          }
          return; // onstop → transcribe → auto-send
        }
        finishWithText(text);
      }, SILENCE_MS);
    },
    [clearSilenceTimer, finishWithText]
  );

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      setMode("transcribing");
      modeRef.current = "transcribing";
      try {
        const mime = blob.type || pickRecorderMime() || "audio/webm";
        const ext = mime.includes("mp4") ? "mp4" : "webm";
        const form = new FormData();
        form.append("audio", blob, `voice.${ext}`);
        const res = await fetch("/api/agent/transcribe", {
          method: "POST",
          body: form,
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          text?: string;
          error?: string;
        } | null;
        if (!res.ok || !body?.ok) {
          throw new Error(body?.error || "Транскрипція не вдалася");
        }
        const spoken = (body.text || "").trim();
        const full = composeText(spoken);
        finishWithText(full);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не вдалося розпізнати голос"
        );
        setMode("idle");
        modeRef.current = "idle";
      } finally {
        stopMediaTracks();
        stopAudioGraph();
      }
    },
    [composeText, finishWithText, stopAudioGraph, stopMediaTracks]
  );

  const startFallbackRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Мікрофон недоступний у цьому браузері");
      return;
    }
    setError(null);
    baselineRef.current = value;
    finalChunkRef.current = "";
    interimRef.current = "";
    audioChunksRef.current = [];
    finishingRef.current = false;
    sentRef.current = false;
    heardSpeechRef.current = false;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    mediaStreamRef.current = stream;

    const mime = pickRecorderMime();
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      stopAudioGraph();
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mime || "audio/webm",
      });
      mediaRecorderRef.current = null;
      if (blob.size < 256) {
        setError("Запис порожній — спробуй ще раз");
        setMode("idle");
        modeRef.current = "idle";
        stopMediaTracks();
        return;
      }
      void transcribeBlob(blob);
    };

    // Тиша через AnalyserNode → авто-стоп через 1.5с
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      silenceSinceRef.current = null;

      const tick = () => {
        if (modeRef.current !== "fallback") return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = data[i] ?? 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        if (rms >= SILENCE_RMS) {
          heardSpeechRef.current = true;
          silenceSinceRef.current = null;
        } else if (heardSpeechRef.current) {
          if (silenceSinceRef.current == null) silenceSinceRef.current = now;
          else if (now - silenceSinceRef.current >= SILENCE_MS) {
            try {
              recorder.stop();
            } catch {
              /* ignore */
            }
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* без аналізатора — лише ручний Стоп */
    }

    recorder.start(250);
    setMode("fallback");
    modeRef.current = "fallback";
    clearMaxTimer();
    maxTimerRef.current = setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }, MAX_FALLBACK_MS);
  }, [clearMaxTimer, stopAudioGraph, stopMediaTracks, transcribeBlob, value]);

  const startSpeechRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;

    setError(null);
    baselineRef.current = value;
    finalChunkRef.current = "";
    interimRef.current = "";
    finishingRef.current = false;
    sentRef.current = false;
    heardSpeechRef.current = false;

    const recognition = new Ctor();
    recognition.lang = LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let interim = "";
      let finalPart = finalChunkRef.current;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const row = event.results[i];
        if (!row) continue;
        const piece = row[0]?.transcript ?? "";
        if (row.isFinal) finalPart += piece;
        else interim += piece;
      }
      finalChunkRef.current = finalPart;
      interimRef.current = interim;
      if (finalPart.trim() || interim.trim()) {
        heardSpeechRef.current = true;
      }
      pushTranscript(finalPart, interim);
      if (heardSpeechRef.current) {
        scheduleSilenceSend(() => composeText(finalChunkRef.current));
      }
    };

    recognition.onerror = (event) => {
      const code = event.error || "";
      if (code === "aborted" || code === "no-speech") return;
      // Немає дозволу / не підтримується в PWA → fallback
      if (
        code === "not-allowed" ||
        code === "service-not-allowed" ||
        code === "network"
      ) {
        cleanupAll();
        void startFallbackRecording().catch((err) => {
          setError(
            err instanceof Error ? err.message : "Немає доступу до мікрофона"
          );
          setMode("idle");
        });
        return;
      }
      setError("Помилка розпізнавання — спробуй ще");
      setMode("idle");
      modeRef.current = "idle";
    };

    recognition.onend = () => {
      if (modeRef.current !== "speech" || sentRef.current) return;
      // Chrome часто рве сесію між фразами — перезапускаємо, поки ще слухаємо
      if (silenceTimerRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through */
        }
      }
      finishWithText(composeText(finalChunkRef.current));
    };

    try {
      recognition.start();
      setMode("speech");
      modeRef.current = "speech";
      return true;
    } catch {
      return false;
    }
  }, [
    cleanupAll,
    composeText,
    finishWithText,
    pushTranscript,
    scheduleSilenceSend,
    startFallbackRecording,
    value,
  ]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    clearMaxTimer();
    if (modeRef.current === "speech") {
      const text = composeText(finalChunkRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      finishWithText(text);
      return;
    }
    if (modeRef.current === "fallback") {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        setMode("idle");
        modeRef.current = "idle";
        stopMediaTracks();
        stopAudioGraph();
      }
    }
  }, [
    clearMaxTimer,
    clearSilenceTimer,
    composeText,
    finishWithText,
    stopAudioGraph,
    stopMediaTracks,
  ]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (mode === "transcribing") return;
    if (mode === "speech" || mode === "fallback") {
      stopListening();
      return;
    }

    void (async () => {
      const perm = await ensureLevadiusMicPermission();
      if (perm === "denied") {
        setError("Немає доступу до мікрофона");
        return;
      }
      if (perm === "unavailable") {
        setError("Мікрофон недоступний у цьому браузері");
        return;
      }

      const started = startSpeechRecognition();
      if (!started) {
        void startFallbackRecording().catch((err) => {
          setError(
            err instanceof Error ? err.message : "Немає доступу до мікрофона"
          );
          setMode("idle");
        });
      }
    })();
  }, [
    disabled,
    mode,
    startFallbackRecording,
    startSpeechRecognition,
    stopListening,
  ]);

  if (!supported) return null;

  const listening = mode === "speech" || mode === "fallback";
  const busy = mode === "transcribing";

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || busy}
        aria-label={
          busy
            ? "Транскрибую…"
            : listening
              ? "Стоп і надіслати"
              : "Голосовий ввід"
        }
        title={
          busy
            ? "Транскрибую голос…"
            : listening
              ? "Стоп · hands-free відправка"
              : "Диктуй українською (hands-free)"
        }
        className={cn(
          "relative inline-flex size-11 items-center justify-center rounded-2xl border transition-colors disabled:pointer-events-none disabled:opacity-40",
          listening
            ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-300"
            : "border-white/10 bg-white/[0.05] text-zinc-400 hover:border-emerald-400/35 hover:bg-emerald-400/10 hover:text-emerald-400"
        )}
      >
        {listening ? (
          <>
            <span
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-emerald-400/25 animate-ping"
            />
            <span
              aria-hidden
              className="absolute inset-1 rounded-xl bg-emerald-400/10 animate-pulse"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -top-1 left-1/2 flex -translate-x-1/2 items-end gap-0.5"
            >
              <span className="h-1.5 w-0.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
              <span className="h-2.5 w-0.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:120ms]" />
              <span className="h-2 w-0.5 animate-bounce rounded-full bg-emerald-400 [animation-delay:240ms]" />
            </span>
          </>
        ) : null}
        {busy ? (
          <Loader2 className="relative size-4 animate-spin" strokeWidth={2.2} />
        ) : listening ? (
          <Square className="relative size-3.5 fill-current" strokeWidth={2.2} />
        ) : (
          <Mic className="relative size-4" strokeWidth={2.1} />
        )}
      </button>
      {error ? (
        <p className="absolute bottom-[calc(100%+0.35rem)] left-1/2 z-20 w-44 -translate-x-1/2 rounded-lg border border-red-400/30 bg-zinc-950/95 px-2 py-1 text-center text-[10px] leading-snug text-red-300 shadow-lg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
