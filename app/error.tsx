"use client";

/**
 * Ловить помилки сегмента (включно з падінням soft-navigation),
 * щоб не вилітати одразу в terminal global-error.
 */

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[50dvh] flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-100">
      <h1 className="text-lg font-semibold tracking-tight">
        Розділ не завантажився
      </h1>
      <p className="max-w-sm text-sm text-zinc-400">
        Спробуйте ще раз. Якщо повторюється — оновіть сторінку.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-[#C05621] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Спробувати знову
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/";
          }}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200"
        >
          На головну
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
