"use client";

export function AgroplanSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-3 w-44 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      </div>
      <div className="h-11 animate-pulse border-b border-border/40 bg-muted/30" />
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 space-y-2 border-r border-border/60 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-muted/60"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
        <div className="relative flex-1 overflow-hidden bg-background">
          <div className="absolute left-[20%] top-24 h-12 w-32 animate-pulse rounded-lg bg-primary/10" />
          <div className="absolute left-[45%] top-40 h-12 w-24 animate-pulse rounded-lg bg-[#D69E2E]/10" />
        </div>
      </div>
    </div>
  );
}
