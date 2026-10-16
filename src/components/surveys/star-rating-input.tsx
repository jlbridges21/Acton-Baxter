"use client";

import { useRef } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const VALUES = [1, 2, 3, 4, 5] as const;

/** Radio-group star rating: click or use arrow keys; each star is labelled for screen readers. */
export function StarRatingInput({
  value,
  onChange,
  labelledBy,
  invalid,
}: {
  value: number | null;
  onChange: (value: number) => void;
  labelledBy: string;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusIndex = value ? value - 1 : 0;

  function move(next: number) {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-invalid={invalid || undefined}
      className="flex gap-1"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          move((value ?? 0) + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          move((value ?? 2) - 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          move(1);
        } else if (e.key === "End") {
          e.preventDefault();
          move(5);
        }
      }}
    >
      {VALUES.map((v, index) => {
        const filled = value !== null && v <= value;
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} star${v === 1 ? "" : "s"}`}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(v)}
            className="rounded-md p-1 focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
          >
            <Star
              aria-hidden
              className={cn(
                "h-9 w-9 transition-colors",
                filled
                  ? "fill-[var(--acton-yellow)] text-[var(--acton-yellow)]"
                  : "text-[var(--acton-border)]",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
