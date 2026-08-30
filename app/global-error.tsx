"use client";

/**
 * Останній рівень: замінює дефолтний Next «This page couldn’t load».
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="uk">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Сторінка не завантажилась
          </h1>
          <p style={{ fontSize: 14, color: "#a1a1aa", margin: "0 0 20px" }}>
            Тимчасова помилка навігації. Оновіть сторінку або поверніться
            назад.
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                border: 0,
                borderRadius: 12,
                padding: "10px 16px",
                background: "#C05621",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Спробувати знову
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                border: "1px solid #3f3f46",
                borderRadius: 12,
                padding: "10px 16px",
                background: "#18181b",
                color: "#e4e4e7",
                fontWeight: 500,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              На головну
            </button>
          </div>
          {error.digest ? (
            <p
              style={{
                marginTop: 16,
                fontSize: 10,
                letterSpacing: "0.04em",
                color: "#52525b",
              }}
            >
              ERROR {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
