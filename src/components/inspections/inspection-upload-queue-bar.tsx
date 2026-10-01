"use client";

/**
 * Compact site-inspection upload indicator.
 * Collapsed to one line so the checklist stays usable; tap to expand.
 */

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInspectionMediaFailure } from "@/lib/inspections/media-limits";
import type { MediaQueueItemSnapshot } from "@/lib/inspections/media-queue";
import { cn } from "@/lib/utils";

const DONE_FLASH_MS = 2800;

function isActiveStatus(status: MediaQueueItemSnapshot["status"]): boolean {
  return (
    status === "queued" || status === "uploading" || status === "finalizing" || status === "failed"
  );
}

function overallPercent(items: MediaQueueItemSnapshot[]): number {
  const active = items.filter((item) => item.status !== "failed");
  if (!active.length) return 0;
  let bytes = 0;
  let done = 0;
  for (const item of active) {
    const size = Math.max(item.byteSize, 1);
    const ratio =
      item.status === "finalizing" || item.status === "uploaded"
        ? 1
        : Math.min(1, Math.max(0, item.progress));
    bytes += size;
    done += size * ratio;
  }
  return Math.round((done / bytes) * 100);
}

function summaryText(items: MediaQueueItemSnapshot[]): string {
  const stalled = items.filter((item) => item.isStalled).length;
  const uploading = items.filter((item) => item.status === "uploading" && !item.isStalled).length;
  const finalizing = items.filter((item) => item.status === "finalizing" && !item.isStalled).length;
  const queued = items.filter((item) => item.status === "queued" && !item.isStalled).length;
  const failed = items.filter((item) => item.status === "failed").length;
  const parts: string[] = [];
  if (stalled) parts.push(`${stalled} stalled`);
  if (uploading) parts.push(`${uploading} uploading`);
  if (finalizing) parts.push(`${finalizing} finalizing`);
  if (queued) parts.push(`${queued} queued`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

export function InspectionUploadQueueBar({
  items,
  labelFor,
  retryAllBusy,
  saveQueuedBusy,
  retryAllLabel,
  saveLabel,
  onRetryAll,
  onSaveToDevice,
  onCancel,
  onRetry,
  onDiscard,
}: {
  items: MediaQueueItemSnapshot[];
  labelFor: (item: MediaQueueItemSnapshot) => string;
  retryAllBusy: boolean;
  saveQueuedBusy: boolean;
  retryAllLabel: string;
  saveLabel: string;
  onRetryAll: () => void;
  onSaveToDevice: () => void;
  onCancel: (item: MediaQueueItemSnapshot) => void;
  onRetry: (clientMediaId: string) => void;
  onDiscard: (clientMediaId: string) => void;
}) {
  const visible = items.filter((item) => isActiveStatus(item.status));
  const queueActive = visible.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [prevActive, setPrevActive] = useState(queueActive);

  if (queueActive !== prevActive) {
    setPrevActive(queueActive);
    if (queueActive) {
      setShowDone(false);
    } else {
      setExpanded(false);
      setShowDone(true);
    }
  }

  useEffect(() => {
    if (!showDone) return;
    const timer = window.setTimeout(() => setShowDone(false), DONE_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [showDone]);

  if (!queueActive && !showDone) return null;

  if (!queueActive && showDone) {
    return (
      <p
        data-testid="upload-queue-done"
        className="min-h-11 text-sm font-medium text-emerald-800 transition-opacity duration-500"
      >
        Uploads finished
      </p>
    );
  }

  const stalled = visible.some((item) => item.isStalled);
  const moving = visible.some((item) => !item.isStalled && item.status !== "failed");
  const failedCount = visible.filter((item) => item.status === "failed").length;
  const needsAttention = (stalled && !moving) || (failedCount > 0 && !moving);
  const percent = overallPercent(visible);
  const canRetry = visible.some(
    (item) =>
      item.status === "queued" ||
      item.status === "uploading" ||
      item.status === "finalizing" ||
      item.status === "failed",
  );
  const activeItems = visible.filter(
    (item) =>
      item.status === "queued" || item.status === "uploading" || item.status === "finalizing",
  );
  const failedItems = visible.filter((item) => item.status === "failed");

  return (
    <div data-testid="upload-queue-bar" className="space-y-1">
      <div className="flex flex-nowrap items-stretch gap-1">
        <button
          type="button"
          data-testid="upload-queue-summary"
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm",
            needsAttention ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950",
          )}
          aria-expanded={expanded}
          aria-controls="upload-queue-list"
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate font-medium">{summaryText(visible)}</span>
          <span className="shrink-0 tabular-nums">{percent}%</span>
        </button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 min-h-11 shrink-0 px-3 text-xs"
          disabled={retryAllBusy || !canRetry}
          onClick={() => onRetryAll()}
        >
          {retryAllLabel}
        </Button>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-amber-100" aria-hidden>
        <div
          className={cn("h-full", needsAttention ? "bg-red-600" : "bg-[var(--acton-navy)]")}
          style={{ width: `${percent}%` }}
        />
      </div>
      {expanded ? (
        <div
          id="upload-queue-list"
          data-testid="upload-queue-list"
          className="max-h-36 space-y-2 overflow-y-auto rounded-md border border-amber-200 bg-amber-50/90 px-2 py-2 text-xs text-amber-950"
        >
          {stalled ? (
            <p className="font-semibold text-red-800">
              No progress for several minutes. Retry all, or save copies to your device.
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="h-11 min-h-11 px-3 text-xs"
            disabled={saveQueuedBusy || !canRetry}
            onClick={() => onSaveToDevice()}
          >
            {saveLabel}
          </Button>
          {activeItems.map((item) => (
            <div
              key={item.clientMediaId}
              data-testid="upload-queue-entry"
              className="flex items-start gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--acton-navy)]">{labelFor(item)}</p>
                <p className={item.isStalled ? "font-medium text-red-800" : ""}>
                  {item.statusReason}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-11 min-h-11 shrink-0 px-2 text-xs text-red-800"
                onClick={() => onCancel(item)}
              >
                Cancel
              </Button>
            </div>
          ))}
          {failedItems.map((item) => {
            const label = labelFor(item);
            return (
              <div
                key={item.clientMediaId}
                data-testid="upload-queue-entry"
                className="space-y-1 text-red-900"
              >
                <p>
                  {formatInspectionMediaFailure(
                    label,
                    item.statusReason || item.lastError || "Upload failed",
                  )}
                </p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 min-h-11 px-3 text-xs"
                    onClick={() => onRetry(item.clientMediaId)}
                  >
                    Retry
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 min-h-11 px-3 text-xs text-red-800"
                    onClick={() => onDiscard(item.clientMediaId)}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
