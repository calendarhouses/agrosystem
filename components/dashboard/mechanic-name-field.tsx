"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type MenuBox = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placeAbove: boolean;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
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
          res.names.filter((name) => name.toLowerCase() !== q.toLowerCase())
        );
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const showMenu = open && (suggestions.length > 0 || loading);

  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuBox(null);
      return;
    }

    function updatePosition() {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
      const spaceAbove = rect.top - gap - 12;
      const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        120,
        Math.min(240, placeAbove ? spaceAbove : spaceBelow)
      );
      setMenuBox({
        top: placeAbove ? rect.top - gap : rect.bottom + gap,
        left: rect.left,
        width: rect.width,
        maxHeight,
        placeAbove,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showMenu, suggestions.length, loading]);

  useEffect(() => {
    if (!showMenu) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (inputRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [showMenu]);

  const menu =
    showMenu && menuBox && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              left: menuBox.left,
              width: menuBox.width,
              maxHeight: menuBox.maxHeight,
              ...(menuBox.placeAbove
                ? { bottom: window.innerHeight - menuBox.top, top: "auto" }
                : { top: menuBox.top }),
            }}
            className={cn(
              "desktop-scrollbar z-[200] overflow-y-scroll rounded-xl border border-[#E5DFD3] bg-white py-1",
              "shadow-[0_18px_40px_-16px_rgba(39,33,24,0.35)]"
            )}
            data-force-scrollbar="true"
            data-desktop-scroll="true"
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
          </ul>,
          document.body
        )
      : null;

  return (
    <div className="relative w-full min-w-0 space-y-2">
      <label className={labelClassName}>Механізатор</label>
      <div className="relative">
        <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showMenu}
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
      {menu}
    </div>
  );
}
