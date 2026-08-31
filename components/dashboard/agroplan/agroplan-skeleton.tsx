"use client";

export function AgroplanSkeleton() {
  return (
    <div className="flex h-full flex-col bg-[#07080b]">
      <div className="border-b border-white/[0.06] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-white/[0.06]" />
          <div className="space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-44 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      </div>
      <div className="h-11 animate-pulse border-b border-white/[0.04] bg-white/[0.02]" />
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 border-r border-white/[0.06] p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-white/[0.04]"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
        <div className="relative flex-1 overflow-hidden">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div className="absolute left-[20%] top-24 h-12 w-32 animate-pulse rounded-lg bg-emerald-400/10" />
          <div className="absolute left-[45%] top-40 h-12 w-24 animate-pulse rounded-lg bg-amber-400/10" />
        </div>
      </div>
    </div>
  );
}
