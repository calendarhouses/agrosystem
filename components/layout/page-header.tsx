import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Єдина глиняна панель для шапки розділу */
export function HeaderPanel({
  children,
  className,
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  /** Ліва акцентна риска (для блоку заголовка) */
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] shadow-sm",
        accent && "border-l-4 border-l-[#C05621]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Преміум-шапка розділу */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  panels,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Дії всередині картки заголовка (праворуч) */
  actions?: ReactNode;
  /** Додаткові панелі тієї ж висоти (ШІ, погода тощо) */
  panels?: ReactNode[];
}) {
  const hasPanels = Boolean(panels?.length);

  const titleBlock = (
    <HeaderPanel
      accent
      className={cn(
        "flex h-full items-center gap-4 px-4 py-4 sm:px-5",
        hasPanels ? "min-h-[7.5rem]" : "min-h-[4.75rem]"
      )}
    >
      {Icon ? (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#C05621]/25 bg-[#C05621]/10 text-[#C05621] shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 truncate text-sm text-zinc-500">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
          {actions}
        </div>
      ) : null}
    </HeaderPanel>
  );

  if (!hasPanels) {
    return <div className="mb-4 shrink-0">{titleBlock}</div>;
  }

  return (
    <div className="mb-4 grid shrink-0 grid-cols-1 gap-3 xl:grid-cols-3 xl:items-stretch">
      {titleBlock}
      {panels!.map((panel, index) => (
        <div key={index} className="min-h-[7.5rem] xl:h-auto xl:min-h-0">
          {panel}
        </div>
      ))}
    </div>
  );
}
