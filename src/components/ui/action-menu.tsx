"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionMenuItem = {
  id: string;
  label: string;
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
};

type Position = { top: number; left: number; openUp: boolean };

/**
 * Portal-based action menu that escapes overflow:hidden ancestors.
 * Renders into document.body with fixed positioning and flips near viewport edges.
 */
export function ActionMenu({
  items,
  label = "More actions",
  align = "end",
  triggerClassName,
  menuClassName,
}: {
  items: ActionMenuItem[];
  label?: string;
  align?: "start" | "end";
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 176;
    const estimatedHeight = Math.max(items.length, 1) * 40 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedHeight + 8 && rect.top > spaceBelow;
    const top = openUp ? rect.top - 4 : rect.bottom + 4;
    let left = align === "end" ? rect.right - menuWidth : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - menuWidth - 8);
    setPosition({ top, left, openUp });
  }, [align, items.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(e: MouseEvent | PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onReposition() {
      updatePosition();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
          triggerClassName,
        )}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className={cn(
                "fixed z-[100] w-44 rounded-md border border-[var(--acton-border)] bg-white py-1 shadow-lg",
                menuClassName,
              )}
              style={{
                top: position.openUp ? undefined : position.top,
                bottom: position.openUp ? window.innerHeight - position.top : undefined,
                left: position.left,
              }}
            >
              {items.map((item) =>
                item.href && !item.disabled ? (
                  <a
                    key={item.id}
                    role="menuitem"
                    href={item.href}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-[var(--acton-gray-50)]",
                      item.destructive ? "text-red-700 hover:bg-red-50" : "text-[var(--acton-navy)]",
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-[var(--acton-gray-50)] disabled:opacity-50",
                      item.destructive ? "text-red-700 hover:bg-red-50" : "text-[var(--acton-navy)]",
                    )}
                    onClick={() => {
                      if (item.disabled) return;
                      setOpen(false);
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ActionMenuIconTrigger({ children }: { children?: ReactNode }) {
  return children ?? <MoreHorizontal className="h-4 w-4" />;
}
