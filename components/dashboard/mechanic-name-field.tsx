"use client";

import { useEffect, useId, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import { suggestMechanics } from "@/app/fields/operation-wage-actions";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  labelClassName?: string;
  inputClassName?: string;
  disabled?: boolean;
};

/** Вільний текст + підказки з раніше збережених механізаторів */
export function MechanicNameField({
  value,
  onChange,
  labelClassName,
  inputClassName,
  disabled,
}: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      void suggestMechanics(q).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        setSuggestions(
          res.names.filter(
            (name) => name.toLowerCase() !== q.toLowerCase()
          )
        );
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  return (
    <div className="relative w-full min-w-0 space-y-2">
      <label className={labelClassName}>Механізатор</label>
      <div className="relative">
        <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={value}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Прізвище та імʼя"
          className={cn(inputClassName, "pl-9")}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
        />
      </div>
      {open && (suggestions.length > 0 || loading) ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-[#E5DFD3] bg-white py-1 shadow-lg"
        >
          {loading && suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-400">Пошук…</li>
          ) : (
            suggestions.map((name) => (
              <li key={name} role="option">
                <button
                  type="button"
                  className="flex w-full px-3 py-2.5 text-left text-sm font-medium text-zinc-900 hover:bg-[#276749]/8"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  {name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
