"use client";

/**
 * Ловить помилки сегмента. На React #412 / Connection closed —
 * один раз hard reload (єдиний надійний recovery для Next soft-nav).
 */

import { useEffect } from "react";

function isSoftNavCrash(error: Error): boolean {
  const msg = `${error.message} ${error.name} ${(error as Error & { digest?: string }).digest ?? ""}`;
  return /connection closed|#412|\b412\b|failed to fetch rsc|fetchserverresponse/i.test(
    msg
  );
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error.message, error.digest, error);
    if (!isSoftNavCrash(error)) return;
    const key = "levada-softnav-reload";
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
      window.location.reload();
    } catch {
      /* ignore */
    }
  }, [error]);

  return (
    <div className="flex h-full min-h-[50dvh] flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-100">
      <h1 className="text-lg font-semibold tracking-tight">
        Розділ не завантажився
      </h1>
      <p className="max-w-sm text-sm text-zinc-400">
        {error.message || "Спробуйте ще раз або оновіть сторінку."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem("levada-softnav-reload");
            } catch {
              /* ignore */
            }
            window.location.reload();
          }}
          className="rounded-xl bg-[#C05621] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Оновити сторінку
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200"
        >
          Спробувати знову
        </button>
      </div>
      {error.digest ? (
        <p className="text-[10px] tracking-wide text-zinc-600">
          ERROR {error.digest}
        </p>
      ) : null}
    </div>
  );
}
