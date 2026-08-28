import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #276749 0%, #1f5239 55%, #C05621 100%)",
          borderRadius: 112,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 360,
            height: 360,
            borderRadius: 88,
            background: "rgba(255,255,255,0.12)",
            border: "4px solid rgba(255,255,255,0.35)",
            color: "white",
            fontSize: 148,
            fontWeight: 800,
            letterSpacing: -4,
          }}
        >
          LS
        </div>
      </div>
    ),
    { ...size }
  );
}
