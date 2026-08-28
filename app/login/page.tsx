import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginInstallRedirect } from "@/components/pwa/install-prompt";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Вхід",
};

export default function LoginPage() {
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-[#F4F1EA] px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(39,103,73,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(192,86,33,0.08),_transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23276749' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
        aria-hidden
      />
      <Suspense fallback={null}>
        <LoginInstallRedirect />
      </Suspense>
      <Suspense
        fallback={
          <div className="h-80 w-full max-w-md animate-pulse rounded-xl bg-white/60" />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
