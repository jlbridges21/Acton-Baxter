"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Share2 } from "lucide-react";
import { PanoramaViewerClient } from "@/components/tours/panorama-viewer-client";
import type { EmbedChrome } from "@/lib/tours/embed-chrome";
import type { ViewerTour } from "@/lib/tours/viewer-model";

export function TourStage({
  tour,
  chrome,
  preview = false,
  layout = "screen",
  sceneId: controlledSceneId,
  onSceneChange,
  resolution = "adaptive",
  warmOtherScenes = false,
  pauseWarm = false,
  editing,
}: {
  tour: ViewerTour;
  chrome: EmbedChrome;
  preview?: boolean;
  /** `frame` fills a sized parent. Public and embed pages use the full viewport. */
  layout?: "screen" | "frame";
  sceneId?: string;
  onSceneChange?: (sceneId: string) => void;
  resolution?: "adaptive" | "edit";
  warmOtherScenes?: boolean;
  pauseWarm?: boolean;
  editing?: {
    placing: boolean;
    selectedHotspotId: string | null;
    onPlace: (position: { yaw: number; pitch: number }) => void;
    onSelectHotspot: (hotspotId: string) => void;
    onMoveHotspot: (move: { id: string; yaw: number; pitch: number }) => void;
    onBindView: (read: () => { yaw: number; pitch: number } | null) => void;
  };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);
  const [uncontrolledSceneId, setUncontrolledSceneId] = useState(tour.scenes[0]?.id ?? "");
  const sceneId = controlledSceneId ?? uncontrolledSceneId;
  const [shareLabel, setShareLabel] = useState("Share");
  const showThumbs = layout === "screen" && chrome.showThumbs && tour.scenes.length > 1;
  const framed = layout === "frame";

  function setSceneId(id: string) {
    onSceneChange?.(id);
    if (controlledSceneId === undefined) setUncontrolledSceneId(id);
  }

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [sceneId, showThumbs]);

  async function onShare() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: tour.title, url });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setShareLabel("Copied");
      window.setTimeout(() => setShareLabel("Share"), 1500);
    } catch {
      setShareLabel("Share");
    }
  }

  async function onFullscreen() {
    const node = rootRef.current;
    if (!node) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen();
  }

  return (
    <div
      ref={rootRef}
      className={
        framed
          ? "relative h-full min-h-[320px] overflow-hidden bg-[var(--acton-navy)] text-white"
          : "flex h-dvh flex-col bg-[var(--acton-navy)] text-white"
      }
    >
      {preview && !framed ? (
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[var(--acton-yellow)] px-4 py-2 text-sm font-semibold text-[var(--acton-navy)]">
          <span>Preview — not public</span>
          <Link href={`/tours/${tour.id}`} className="underline">
            Back to editor
          </Link>
        </div>
      ) : null}
      <div className={framed ? "absolute inset-0 min-h-[320px]" : "relative min-h-0 flex-1"}>
        {tour.scenes.length === 0 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center">
            <p className="text-sm font-semibold">This tour has no scenes yet.</p>
          </div>
        ) : (
          <PanoramaViewerClient
            slug={tour.slug}
            scenes={tour.scenes}
            currentSceneId={sceneId}
            onSceneChange={setSceneId}
            editMode={Boolean(editing)}
            placing={editing?.placing}
            selectedHotspotId={editing?.selectedHotspotId}
            onPlace={editing?.onPlace}
            onSelectHotspot={editing?.onSelectHotspot}
            onMoveHotspot={editing?.onMoveHotspot}
            onBindView={editing?.onBindView}
            resolution={resolution}
            warmOtherScenes={warmOtherScenes}
            pauseWarm={pauseWarm}
          />
        )}

        {layout === "screen" && (chrome.showTitle || chrome.showShare || chrome.showFullscreen) ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-[var(--acton-navy)]/80 to-transparent p-4">
            <div className="flex items-start justify-between gap-3">
              {chrome.showTitle ? (
                <h1 className="pointer-events-auto max-w-[70%] text-lg font-semibold drop-shadow">
                  {tour.title}
                </h1>
              ) : (
                <span />
              )}
              <div className="pointer-events-auto flex gap-2">
                {chrome.showShare ? (
                  <button
                    type="button"
                    onClick={() => void onShare()}
                    className="inline-flex h-9 items-center gap-1 rounded-md bg-white/90 px-3 text-xs font-semibold text-[var(--acton-navy)]"
                  >
                    <Share2 className="h-4 w-4" />
                    {shareLabel}
                  </button>
                ) : null}
                {chrome.showFullscreen ? (
                  <button
                    type="button"
                    onClick={() => void onFullscreen()}
                    className="inline-flex h-9 items-center gap-1 rounded-md bg-white/90 px-3 text-xs font-semibold text-[var(--acton-navy)]"
                  >
                    <Maximize2 className="h-4 w-4" />
                    Fullscreen
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {showThumbs ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--acton-navy)]/80 to-transparent">
            <div className="pointer-events-auto flex gap-2 overflow-x-auto px-4 pt-8 pb-4">
              {tour.scenes.map((scene) => {
                const active = scene.id === sceneId;
                return (
                  <button
                    key={scene.id}
                    ref={active ? activeThumbRef : undefined}
                    type="button"
                    onClick={() => setSceneId(scene.id)}
                    className={`w-28 shrink-0 overflow-hidden rounded-md border-2 text-left ${active ? "border-[var(--acton-yellow)]" : "border-transparent"}`}
                  >
                    {scene.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={scene.thumbUrl} alt="" className="h-14 w-full object-cover" />
                    ) : (
                      <div className="flex h-14 items-center justify-center bg-white/10 text-[10px]">
                        No thumbnail
                      </div>
                    )}
                    <span className="block truncate bg-black/40 px-1 py-0.5 text-[10px]">
                      {scene.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
