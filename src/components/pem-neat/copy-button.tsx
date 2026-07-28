"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

export function CopyButton({
  getText,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "secondary",
  size = "sm",
  className,
}: {
  getText: () => string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    const text = getText();
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [getText]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onCopy}
      disabled={!getText()}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}
