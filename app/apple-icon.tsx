import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 128,
            height: 128,
            borderRadius: 32,
            background: "rgba(255,255,255,0.12)",
            border: "3px solid rgba(255,255,255,0.35)",
            color: "white",
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          LS
        </div>
      </div>
    ),
    { ...size }
  );
}
