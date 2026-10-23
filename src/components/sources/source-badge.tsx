"use client";

/**
 * Reusable source attribution. Driven by structured provenance (never by model text):
 *   <SourceBadge provider="bamboohr" recordType="Employee profile" freshness="live" retrievedAt="…" />
 * Quiet by default (one small chip); `detailed` adds record type and freshness.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PROVIDER_LABELS,
  type Freshness,
  type Provenance,
  type SourceProvider,
} from "@/lib/bamboohr/provenance";
import { cn } from "@/lib/utils";

const MARK: Record<SourceProvider, string> = {
  bamboohr: "bg-[#73c41d]", // BambooHR's brand green, used only as a small mark
  jobtread: "bg-sky-600",
  google_drive: "bg-amber-500",
  baxter: "bg-[var(--acton-navy)]",
};

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

function useNow(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

export function freshnessText(
  freshness: Freshness | null | undefined,
  retrievedAt: string | null | undefined,
  now: number,
): string {
  if (freshness === "unavailable") return "Currently unavailable";
  const when = now ? ago(retrievedAt, now) : "";
  if (freshness === "cached") return when ? `Cached · ${when}` : "Cached";
  return when ? `Retrieved live · ${when}` : "Retrieved live";
}

export function SourceBadge({
  provider,
  recordType,
  freshness,
  retrievedAt,
  href,
  detailed = false,
  className,
}: {
  provider: SourceProvider;
  recordType?: string | null;
  freshness?: Freshness | null;
  retrievedAt?: string | null;
  href?: string | null;
  detailed?: boolean;
  className?: string;
}) {
  const now = useNow();
  const label = PROVIDER_LABELS[provider];
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[var(--acton-border)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--acton-navy)]",
        freshness === "unavailable" && "border-amber-300 bg-amber-50",
        className,
      )}
      title={[`Source: ${label}`, recordType, freshnessText(freshness, retrievedAt, now)]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", MARK[provider])} aria-hidden />
      <span>
        <span className="sr-only">Source: </span>
        {label}
        {detailed && recordType ? (
          <span className="text-[var(--acton-muted)]"> · {recordType}</span>
        ) : null}
        {detailed ? (
          <span className="text-[var(--acton-muted)]">
            {" "}
            · {freshnessText(freshness, retrievedAt, now)}
          </span>
        ) : null}
      </span>
    </span>
  );
  return href ? (
    <Link
      href={href}
      className="inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/** Section footer: "Source: BambooHR — Employee profile · Retrieved live · 2 min ago". */
export function SourceFootnote({
  source,
  className,
}: {
  source: Pick<
    Provenance,
    "provider" | "entityType" | "freshness" | "retrievedAt" | "lastConfirmedAt"
  >;
  className?: string;
}) {
  const now = useNow();
  return (
    <p
      className={cn(
        "mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--acton-muted)]",
        className,
      )}
    >
      <SourceBadge provider={source.provider} />
      <span>
        {source.entityType} · {freshnessText(source.freshness, source.retrievedAt, now)}
        {source.lastConfirmedAt && now
          ? ` · connection last confirmed ${ago(source.lastConfirmedAt, now)}`
          : ""}
      </span>
    </p>
  );
}
