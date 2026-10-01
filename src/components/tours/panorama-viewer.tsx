import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin, type MarkerConfig } from "@photo-sphere-viewer/markers-plugin";
import { VirtualTourPlugin, type VirtualTourNode } from "@photo-sphere-viewer/virtual-tour-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import { Button } from "@/components/ui/button";
import { readMaxTextureSize } from "@/lib/tours/texture-size";
import {
  buildVirtualTourNodes,
  viewerNodesKey,
  type TourNodeSpec,
  type ViewerHotspot,
  type ViewerScene,
} from "@/lib/tours/viewer-model";

const LOAD_TIMEOUT_MS = 60_000;

type InfoSelection = {
  id: string;
  label: string | null;
  content: string | null;
  yaw: number;
  pitch: number;
};

/**
 * Photo Sphere Viewer and the database both store yaw and pitch in radians.
 * Do not convert.
 */
export function PanoramaViewer({
  slug,
  scenes,
  currentSceneId,
  onSceneChange,
}: {
  slug: string;
  scenes: ViewerScene[];
  currentSceneId: string;
  onSceneChange: (sceneId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const tourRef = useRef<VirtualTourPlugin | null>(null);
  const markersRef = useRef<MarkersPlugin | null>(null);
  const bootedRef = useRef(false);
  const loadingRef = useRef(false);
  const nodesKeyRef = useRef<string | null>(null);
  const scenesRef = useRef(scenes);
  const sceneIdRef = useRef(currentSceneId);
  const onSceneChangeRef = useRef(onSceneChange);

  const [retry, setRetry] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoSelection | null>(null);
  const [infoPoint, setInfoPoint] = useState<{ x: number; y: number } | null>(null);
  const sourceKey = JSON.stringify(scenes);

  useEffect(() => {
    scenesRef.current = scenes;
    sceneIdRef.current = currentSceneId;
    onSceneChangeRef.current = onSceneChange;
  }, [scenes, currentSceneId, onSceneChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    bootedRef.current = false;
    loadingRef.current = false;
    nodesKeyRef.current = null;
    setRevealed(false);
    setError(null);
    setInfo(null);

    const viewer = new Viewer({
      container,
      navbar: false,
      loadingTxt: "",
      plugins: [
        MarkersPlugin.withConfig({ markers: [] }),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
          renderMode: "3d",
        }),
      ],
    });
    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    viewerRef.current = viewer;
    tourRef.current = tour;
    markersRef.current = markers;

    const timer = window.setTimeout(() => {
      loadingRef.current = false;
      setRevealed(false);
      setError("This panorama took too long to load.");
    }, LOAD_TIMEOUT_MS);

    const reveal = () => {
      const sceneId = tour.getCurrentNode()?.id;
      const scene = scenesRef.current.find((item) => item.id === sceneId);
      if (scene?.hasInitialView) {
        viewer.rotate({ yaw: scene.initialYaw, pitch: scene.initialPitch });
      }
      loadingRef.current = false;
      bootedRef.current = true;
      window.clearTimeout(timer);
      setError(null);
      setRevealed(true);
    };

    viewer.addEventListener("panorama-loaded", reveal);
    viewer.addEventListener("panorama-error", () => {
      window.clearTimeout(timer);
      loadingRef.current = false;
      setRevealed(false);
      setError("This panorama could not be loaded.");
    });
    tour.addEventListener("node-changed", (event) => {
      const nodeId = event.node.id;
      onSceneChangeRef.current(nodeId);
      setInfo(null);
      window.requestAnimationFrame(() => {
        const plugin = markersRef.current;
        const scene = scenesRef.current.find((item) => item.id === nodeId);
        if (plugin && scene) syncInfoMarkers(plugin, scene);
      });
    });
    markers.addEventListener("select-marker", (event) => {
      const data = event.marker.data as { kind?: string } | undefined;
      if (data?.kind !== "info") return;
      const hotspot = findInfoHotspot(scenesRef.current, event.marker.id);
      if (!hotspot) return;
      setInfo({
        id: hotspot.id,
        label: hotspot.label,
        content: hotspot.content,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
      });
    });

    return () => {
      window.clearTimeout(timer);
      bootedRef.current = false;
      loadingRef.current = false;
      nodesKeyRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
      tourRef.current = null;
      markersRef.current = null;
    };
  }, [slug, retry]);

  useEffect(() => {
    const tour = tourRef.current;
    if (!tour) return;
    const nodes = toPluginNodes(
      buildVirtualTourNodes({
        slug,
        scenes: scenesRef.current,
        maxTextureSize: readMaxTextureSize(),
      }),
    );
    const key = viewerNodesKey(
      buildVirtualTourNodes({
        slug,
        scenes: scenesRef.current,
        maxTextureSize: readMaxTextureSize(),
      }),
    );
    if (key === nodesKeyRef.current) return;
    const first = nodesKeyRef.current === null;
    nodesKeyRef.current = key;
    const startId = scenesRef.current.some((scene) => scene.id === sceneIdRef.current)
      ? sceneIdRef.current
      : nodes[0]?.id;
    if (!startId) return;
    loadingRef.current = true;
    tour.setNodes(nodes, first ? startId : (tour.getCurrentNode()?.id ?? startId));
  }, [sourceKey, slug, retry]);

  useEffect(() => {
    const tour = tourRef.current;
    if (!tour || !bootedRef.current || loadingRef.current) return;
    const current = tour.getCurrentNode()?.id;
    if (!current || current === currentSceneId) return;
    loadingRef.current = true;
    void tour.setCurrentNode(currentSceneId).finally(() => {
      loadingRef.current = false;
    });
  }, [currentSceneId]);

  useEffect(() => {
    if (!info) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const viewer = viewerRef.current;
      const container = containerRef.current;
      if (!viewer || !container) return;
      if (!viewer.dataHelper.isPointVisible({ yaw: info.yaw, pitch: info.pitch })) {
        setInfoPoint(null);
        return;
      }
      const point = viewer.dataHelper.sphericalCoordsToViewerCoords({
        yaw: info.yaw,
        pitch: info.pitch,
      });
      const width = container.clientWidth;
      const height = container.clientHeight;
      const boxWidth = 240;
      const boxHeight = 120;
      const x = Math.min(Math.max(point.x - boxWidth / 2, 8), Math.max(8, width - boxWidth - 8));
      const y = Math.min(
        Math.max(point.y - boxHeight - 12, 8),
        Math.max(8, height - boxHeight - 8),
      );
      setInfoPoint({ x, y });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(place);
    };
    const viewer = viewerRef.current;
    viewer?.addEventListener("position-updated", schedule);
    viewer?.addEventListener("zoom-updated", schedule);
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewer?.removeEventListener("position-updated", schedule);
      viewer?.removeEventListener("zoom-updated", schedule);
    };
  }, [info]);

  return (
    <div className="relative h-full min-h-[240px] w-full bg-[var(--acton-navy)]">
      <style>{`.tour-viewer .psv-loader,.tour-viewer .psv-navbar{display:none !important}`}</style>
      {!revealed && !error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="sr-only">Loading panorama</span>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-semibold text-white" role="alert">
            {error}
          </p>
          <Button type="button" variant="accent" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={`tour-viewer h-full w-full transition-opacity duration-300 ${revealed && !error ? "opacity-100" : "opacity-0"}`}
      />
      {info && infoPoint ? (
        <div
          className="absolute z-20 w-60 rounded-md border border-[var(--acton-border)] bg-white p-3 text-[var(--acton-navy)] shadow-lg"
          style={{ left: infoPoint.x, top: infoPoint.y }}
        >
          {info.label ? <p className="text-sm font-semibold">{info.label}</p> : null}
          {info.content ? (
            <p className="mt-1 text-sm text-[var(--acton-muted)]">{info.content}</p>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-[var(--acton-navy)] underline"
            onClick={() => setInfo(null)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function findInfoHotspot(scenes: ViewerScene[], markerId: string): ViewerHotspot | null {
  const id = markerId.replace(/^info:/, "");
  for (const scene of scenes) {
    const hotspot = scene.hotspots.find((item) => item.id === id && item.type === "info");
    if (hotspot) return hotspot;
  }
  return null;
}

function syncInfoMarkers(markers: MarkersPlugin, scene: ViewerScene): void {
  const desired = scene.hotspots.filter((hotspot) => hotspot.type === "info").map(infoMarker);
  const desiredIds = new Set(desired.map((marker) => marker.id));
  for (const marker of markers.getMarkers()) {
    if (marker.id.startsWith("info:") && !desiredIds.has(marker.id)) {
      markers.removeMarker(marker.id);
    }
  }
  const existing = new Set(markers.getMarkers().map((marker) => marker.id));
  for (const marker of desired) {
    if (existing.has(marker.id)) markers.updateMarker(marker);
    else markers.addMarker(marker);
  }
}

function infoMarker(hotspot: ViewerHotspot): MarkerConfig {
  const size = hotspot.styleSize;
  const color = /^#[0-9A-Fa-f]{6}$/.test(hotspot.styleColor) ? hotspot.styleColor : "#FFFFFF";
  return {
    id: `info:${hotspot.id}`,
    position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
    html: `<span style="display:grid;place-items:center;width:100%;height:100%;border-radius:999px;background:${color};color:#0b1f3a;font-weight:700;font-size:14px">i</span>`,
    size: { width: size, height: size },
    anchor: "center center",
    hideList: true,
    data: { kind: "info" },
  };
}

function toPluginNodes(nodes: TourNodeSpec[]): VirtualTourNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    panorama: node.panorama,
    links: node.links.map((link) => ({
      nodeId: link.nodeId,
      position: link.position,
      arrowStyle: { size: link.arrowStyle.size },
      data: link.data,
    })),
  }));
}
