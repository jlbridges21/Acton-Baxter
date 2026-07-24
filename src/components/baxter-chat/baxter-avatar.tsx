"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const AVATAR_SRC = "/baxter/avatar.png";

export function BaxterAvatar({ size = 40, className }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-[var(--acton-navy)] text-sm font-bold text-[var(--acton-yellow)]",
          className,
        )}
        style={{ width: size, height: size }}
        aria-label="Baxter assistant"
      >
        B
      </span>
    );
  }

  return (
    <Image
      src={AVATAR_SRC}
      alt="Baxter assistant"
      width={size}
      height={size}
      className={cn("rounded-full object-cover", className)}
      onError={() => setFailed(true)}
      priority={false}
    />
  );
}
