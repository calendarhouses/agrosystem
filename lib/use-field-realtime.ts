"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { toast } from "sonner";

import { createBrowserSupabase } from "@/lib/supabase/client";
import {
  isFarmFieldsRealtimeToastSuppressed,
  isInventoryMovesRealtimeToastSuppressed,
} from "@/lib/realtime-toast-guard";

export type FieldOperationsRealtimePayload = {
  fieldId: string | null;
  fieldKey: string | null;
  workType: string | null;
};

export type FieldRealtimeHandlers = {
  onFarmFieldsChange?: () => void;
  onFieldOperationsChange?: (payload: FieldOperationsRealtimePayload) => void;
  onInventoryMovesChange?: () => void;
  /** Кастомний текст тоста для нарядів (напр. «Оновлено дані по Полю №4») */
  formatFieldOperationMessage?: (
    payload: FieldOperationsRealtimePayload
  ) => string | undefined;
};

const REALTIME_DEBOUNCE_MS = 2200;
const CHANNEL_NAME = "agrosystem-field-sync";

function rowFromPayload(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>
): Record<string, unknown> | null {
  const row = payload.new ?? payload.old;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

type DebouncedBucket = {
  message: string;
  flush: () => void;
};

function createDebouncedRealtimeNotifier(debounceMs: number) {
  const pending = new Map<string, DebouncedBucket>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    schedule(key: string, message: string, flush: () => void) {
      pending.set(key, { message, flush });
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          const item = pending.get(key);
          if (item) {
            item.flush();
            if (item.message.trim()) {
              toast.message(item.message);
            }
            pending.delete(key);
          }
          timers.delete(key);
        }, debounceMs)
      );
    },
    clearAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
    },
  };
}

/** Підписка Supabase Realtime на field_operations, inventory_local_moves, farm_fields */
export function useFieldRealtime(handlers: FieldRealtimeHandlers) {
  const [connected, setConnected] = useState(false);
  const [pulse, setPulse] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const notifier = createDebouncedRealtimeNotifier(REALTIME_DEBOUNCE_MS);

    let supabase: ReturnType<typeof createBrowserSupabase>;
    try {
      supabase = createBrowserSupabase();
    } catch {
      return;
    }

    const pulseOnce = () => {
      if (cancelled) return;
      setPulse(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => {
        if (!cancelled) setPulse(false);
      }, 2600);
    };

    channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "farm_fields" },
        () => {
          if (isFarmFieldsRealtimeToastSuppressed()) {
            handlersRef.current.onFarmFieldsChange?.();
            return;
          }
          // Тихий refresh без «Оновлено дані полів»
          notifier.schedule("farm_fields", "", () => {
            handlersRef.current.onFarmFieldsChange?.();
            pulseOnce();
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "field_operations" },
        (change) => {
          const row = rowFromPayload(change);
          const fieldId =
            typeof row?.field_id === "string" ? row.field_id : null;
          const fieldKey =
            typeof row?.field_key === "string" ? row.field_key : null;
          const workType =
            typeof row?.work_type === "string" ? row.work_type : null;

          const opPayload: FieldOperationsRealtimePayload = {
            fieldId,
            fieldKey,
            workType,
          };

          // Без тоста: локальні дії вже показують success («Наряд додано…»).
          // Realtime лише тихо оновлює UI.
          notifier.schedule("field_operations", "", () => {
            handlersRef.current.onFieldOperationsChange?.(opPayload);
            pulseOnce();
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_local_moves" },
        () => {
          if (isInventoryMovesRealtimeToastSuppressed()) {
            handlersRef.current.onInventoryMovesChange?.();
            return;
          }
          notifier.schedule("inventory_moves", "", () => {
            handlersRef.current.onInventoryMovesChange?.();
            pulseOnce();
          });
        }
      )
      .subscribe((status) => {
        if (!cancelled) setConnected(status === "SUBSCRIBED");
      });

    return () => {
      cancelled = true;
      notifier.clearAll();
      if (pulseTimerRef.current) {
        clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, []);

  return { connected, pulse };
}
