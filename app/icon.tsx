import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** Той самий Lucide Sprout, що на /install */
function SproutMark() {
  return (
    <svg
      width="280"
      height="280"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22v-8" />
      <path d="M7 12c2.5-3.5 5.5-3.5 5 0s2.5 3.5 5 0" />
      <path d="M12 14c-1.5-4.5-.5-8.5 3.5-10.5" />
    </svg>
  );
}

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
          background: "linear-gradient(135deg, #276749 0%, #1f5239 100%)",
          borderRadius: 112,
        }}
      >
        <SproutMark />
      </div>
    ),
    { ...size }
  );
}
