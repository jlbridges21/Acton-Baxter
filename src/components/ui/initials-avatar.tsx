"use client";

import { getInitials } from "@/lib/ui/initials";

export function InitialsAvatar({
  name,
  size = 40,
  className = "",
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const initials = getInitials(name);
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--acton-gray-100)] font-semibold text-[var(--acton-navy)] ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.32)) }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
