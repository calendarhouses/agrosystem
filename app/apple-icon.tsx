import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

function SproutMark({ scale = 1 }: { scale?: number }) {
  const s = scale;
  return (
    <svg
      width={120 * s}
      height={120 * s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22v-8" />
      <path d="M7 12c2.5-3.5 5.5-3.5 5 0s2.5 3.5 5 0" />
      <path d="M12 14c-1.5-4.5-.5-8.5 3.5-10.5" />
    </svg>
  );
}

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
          background: "linear-gradient(180deg, #276749 0%, #1f5239 100%)",
        }}
      >
        <SproutMark scale={1.15} />
      </div>
    ),
    { ...size }
  );
}
