"use client";

import { Bot, Users, Wifi } from "lucide-react";

import { TELEGRAM_BOT_STATUS } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

/** Індикатор живої інтеграції з Telegram */
export function TelegramBotStatusCard({ className }: { className?: string }) {
  const status = TELEGRAM_BOT_STATUS;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="mb-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5DFD3] bg-zinc-100 text-zinc-900">
            <Bot className="h-5 w-5" />
            <span className="absolute -right-0.5 -bottom-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#276749] opacity-40" />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#F4F1EA] bg-[#276749]" />
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">
              Telegram Bot Status
            </p>
            <p className="text-xs text-zinc-500/80">Інтеграція з месенджером</p>
          </div>
        </div>
      </div>

      <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[#276749]/30 bg-[#276749]/10 px-3 py-1.5 text-xs font-semibold text-[#276749]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#276749]" />
        Online
      </div>

      <ul className="mt-auto flex flex-col gap-3">
        <li className="flex items-center gap-3 rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E5DFD3]/40 text-zinc-500">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">Підключено працівників</p>
            <p className="text-sm font-semibold text-zinc-900">
              {status.connectedWorkers}
            </p>
          </div>
        </li>
        <li className="flex items-center gap-3 rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#276749]/10 text-[#276749]">
            <Wifi className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">Останній пінг</p>
            <p className="text-sm font-semibold text-zinc-900">
              {status.lastPingLabel}
            </p>
          </div>
        </li>
      </ul>
    </div>
  );
}
