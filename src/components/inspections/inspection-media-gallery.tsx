"use client";

/**
 * Full-screen media gallery for one checklist item.
 * Batch-refreshes signed URLs; supports arrows, keyboard, swipe, and delete.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Trash2, X } from "lucide-react";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SiteInspectionDetail, SiteInspectionMedia } from "@/lib/inspections/record-types";

const URL_REFRESH_MARGIN_MS = 90_000;

export type InspectionMediaGalleryProps = {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  snapshotItemId: string;
  itemTitle: string;
  media: SiteInspectionMedia[];
  initialIndex: number;
  onRequestDelete?: (media: SiteInspectionMedia) => void;
  onInspectionUpdate?: (inspection: SiteInspectionDetail) => void;
};

export function InspectionMediaGallery({
  open,
  onClose,
  inspectionId,
  snapshotItemId,
  itemTitle,
  media,
  initialIndex,
  onRequestDelete,
  onInspectionUpdate,
}: InspectionMediaGalleryProps) {
  const [index, setIndex] = useState(initialIndex);
  const [urlById, setUrlById] = useState<Record<string, string>>({});
  const [expiresAtMs, setExpiresAtMs] = useState(0);
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const refreshing = useRef(false);

  const viewable = media.filter((m) => m.localPreviewUrl || m.signedUrl || m.storagePath);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, viewable.length - 1));
  const current = viewable[safeIndex] ?? null;

  const refreshUrls = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoadingUrls(true);
    setUrlError(null);
    try {
      const res = await fetch(
        `/api/inspections/${inspectionId}/media/signed-urls?snapshotItemId=${encodeURIComponent(snapshotItemId)}`,
      );
      const json = (await res.json()) as {
        urls?: Record<string, string>;
        expiresAt?: string;
        error?: { message?: string };
      };
      if (!res.ok || !json.urls) {
        throw new Error(json.error?.message ?? "Could not refresh media URLs");
      }
      setUrlById(json.urls);
      setExpiresAtMs(json.expiresAt ? Date.parse(json.expiresAt) : Date.now() + 600_000);
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : "Could not refresh media URLs");
    } finally {
      setLoadingUrls(false);
      refreshing.current = false;
    }
  }, [inspectionId, snapshotItemId]);

  useEffect(() => {
    if (!open) return;
    // Defer so URL fetch setState is not synchronous inside the effect body.
    const timer = window.setTimeout(() => {
      void refreshUrls();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, refreshUrls]);

  useEffect(() => {
    if (!open || !expiresAtMs) return;
    const delay = Math.max(5_000, expiresAtMs - Date.now() - URL_REFRESH_MARGIN_MS);
    const timer = window.setTimeout(() => void refreshUrls(), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAtMs, open, refreshUrls]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setMediaLoading(true);
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setMediaLoading(true);
        setIndex((i) => Math.min(viewable.length - 1, i + 1));
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, viewable.length]);

  function srcFor(m: SiteInspectionMedia): string | null {
    if (m.localPreviewUrl) return m.localPreviewUrl;
    const fromBatch = urlById[m.id] ?? (m.clientMediaId ? urlById[m.clientMediaId] : undefined);
    return fromBatch ?? m.signedUrl ?? null;
  }

  const src = current ? srcFor(current) : null;

  function go(delta: number) {
    setMediaLoading(true);
    setRotateError(null);
    setIndex((i) => Math.min(viewable.length - 1, Math.max(0, i + delta)));
  }

  async function rotateCurrent() {
    if (!current || current.mediaType !== "photo" || current.uploadStatus !== "ready") return;
    setRotateBusy(true);
    setRotateError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/media/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: current.id }),
      });
      const json = (await res.json()) as {
        inspection?: SiteInspectionDetail;
        error?: { message?: string };
      };
      if (!res.ok || !json.inspection) {
        throw new Error(json.error?.message ?? "Could not rotate photo");
      }
      onInspectionUpdate?.(json.inspection);
      setMediaLoading(true);
      await refreshUrls();
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : "Could not rotate photo");
    } finally {
      setRotateBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="h-[100dvh] max-h-[100dvh] rounded-none sm:h-[min(92vh,880px)] sm:max-h-[min(92vh,880px)] sm:max-w-4xl sm:rounded-xl"
    >
      <DialogHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate">{itemTitle}</DialogTitle>
          <DialogDescription>
            {viewable.length ? `${safeIndex + 1} of ${viewable.length}` : "No media to display"}
            {loadingUrls ? " · Refreshing links…" : null}
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {current && current.mediaType === "photo" && current.uploadStatus === "ready" ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11 px-2"
              aria-label="Rotate 90 degrees counter-clockwise"
              disabled={rotateBusy}
              onClick={() => void rotateCurrent()}
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
          ) : null}
          {current && onRequestDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 min-w-11 px-2 text-red-700"
              aria-label="Delete media"
              onClick={() => onRequestDelete(current)}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11 px-2"
            aria-label="Close gallery"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </DialogHeader>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center bg-black/90 px-2 py-3"
        onTouchStart={(e) => {
          touchStartX.current = e.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start == null) return;
          const end = e.changedTouches[0]?.clientX ?? start;
          const delta = end - start;
          if (Math.abs(delta) < 50) return;
          if (delta > 0) go(-1);
          else go(1);
        }}
      >
        {viewable.length > 1 ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className="absolute top-1/2 left-2 z-10 min-h-11 min-w-11 -translate-y-1/2 px-2"
              aria-label="Previous media"
              disabled={safeIndex <= 0}
              onClick={() => go(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="absolute top-1/2 right-2 z-10 min-h-11 min-w-11 -translate-y-1/2 px-2"
              aria-label="Next media"
              disabled={safeIndex >= viewable.length - 1}
              onClick={() => go(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        ) : null}

        <div className="relative flex h-full w-full max-w-full items-center justify-center">
          {urlError ? (
            <div className="space-y-2 px-4 text-center text-sm text-white">
              <p>{urlError}</p>
              <Button type="button" variant="secondary" onClick={() => void refreshUrls()}>
                Retry
              </Button>
            </div>
          ) : !current ? (
            <p className="text-sm text-white/80">No media</p>
          ) : !src ? (
            <p className="text-sm text-white/80">
              {loadingUrls ? "Loading…" : "Media not available yet"}
            </p>
          ) : current.mediaType === "video" ? (
            <>
              {mediaLoading ? (
                <p className="absolute text-sm text-white/70" aria-live="polite">
                  Loading…
                </p>
              ) : null}
              <video
                key={`${current.id}-${src}`}
                src={src}
                controls
                playsInline
                className="max-h-full max-w-full object-contain"
                onLoadedData={() => setMediaLoading(false)}
                onError={() => {
                  setMediaLoading(false);
                  void refreshUrls();
                }}
              />
            </>
          ) : (
            <>
              {mediaLoading ? (
                <p className="absolute text-sm text-white/70" aria-live="polite">
                  Loading…
                </p>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={`${current.id}-${src}`}
                src={src}
                alt=""
                className={`max-h-full max-w-full object-contain transition-opacity ${
                  mediaLoading ? "opacity-0" : "opacity-100"
                }`}
                onLoad={() => setMediaLoading(false)}
                onError={() => {
                  setMediaLoading(false);
                  void refreshUrls();
                }}
              />
            </>
          )}
        </div>
      </div>
      {rotateError ? (
        <p className="px-4 pb-3 text-center text-sm text-red-600" role="alert">
          {rotateError}
        </p>
      ) : null}
    </Dialog>
  );
}
