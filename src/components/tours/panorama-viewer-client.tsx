"use client";

import dynamic from "next/dynamic";
import type { ViewerScene } from "@/lib/tours/viewer-model";

const PanoramaViewer = dynamic(
  () => import("@/components/tours/panorama-viewer").then((mod) => mod.PanoramaViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center bg-[var(--acton-navy)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <span className="sr-only">Loading panorama</span>
      </div>
    ),
  },
);

export function PanoramaViewerClient(props: {
  slug: string;
  scenes: ViewerScene[];
  currentSceneId: string;
  onSceneChange: (sceneId: string) => void;
  editMode?: boolean;
  placing?: boolean;
  selectedHotspotId?: string | null;
  onPlace?: (position: { yaw: number; pitch: number }) => void;
  onSelectHotspot?: (hotspotId: string) => void;
  onMoveHotspot?: (move: { id: string; yaw: number; pitch: number }) => void;
  onBindView?: (read: () => { yaw: number; pitch: number } | null) => void;
  resolution?: "adaptive" | "edit";
  warmOtherScenes?: boolean;
  pauseWarm?: boolean;
}) {
  return <PanoramaViewer {...props} />;
}
