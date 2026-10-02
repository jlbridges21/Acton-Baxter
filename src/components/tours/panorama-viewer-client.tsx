"use client";

import dynamic from "next/dynamic";
import type { ViewerScene } from "@/lib/tours/viewer-model";

const PanoramaViewer = dynamic(
  () => import("@/components/tours/panorama-viewer").then((mod) => mod.PanoramaViewer),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[240px] w-full bg-[var(--acton-navy)]" />,
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
  warmOtherScenes?: boolean;
  pauseWarm?: boolean;
}) {
  return <PanoramaViewer {...props} />;
}
