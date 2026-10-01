import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin, type MarkerConfig } from "@photo-sphere-viewer/markers-plugin";
import { VirtualTourPlugin, type VirtualTourNode } from "@photo-sphere-viewer/virtual-tour-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/tours/info-popover";
import { HotspotDragSession } from "@/lib/tours/hotspot-drag";
import {
  hotspotMarkerSpecs,
  planMarkerSync,
  type HotspotMarkerSpec,
} from "@/lib/tours/hotspot-markers";
import { FLOOR_MARKER_PITCH, hotspotRollRadians } from "@/lib/tours/hotspot-shapes";
import { placeInfoPopover } from "@/lib/tours/info-popover";
import { readMaxTextureSize } from "@/lib/tours/texture-size";
import {
  buildVirtualTourNodes,
  viewerNodesKey,
  type TourNodeSpec,
  type ViewerHotspot,
  type ViewerScene,
} from "@/lib/tours/viewer-model";

const LOAD_TIMEOUT_MS = 60_000;
const INFO_BOX_WIDTH = 240;
const INFO_BOX_HEIGHT = 120;

type ViewReader = () => { yaw: number; pitch: number } | null;

/**
 * Photo Sphere Viewer and the database both store yaw and pitch in radians.
 * Do not convert.
 */
export function PanoramaViewer({
  slug,
  scenes,
  currentSceneId,
  onSceneChange,
  editMode = false,
  placing = false,
  selectedHotspotId = null,
  onPlace,
  onSelectHotspot,
  onMoveHotspot,
  onBindView,
}: {
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
  onBindView?: (read: ViewReader) => void;
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
  const editModeRef = useRef(editMode);
  const placingRef = useRef(placing);
  const selectedIdRef = useRef(selectedHotspotId);
  const onPlaceRef = useRef(onPlace);
  const onSelectRef = useRef(onSelectHotspot);
  const onMoveRef = useRef(onMoveHotspot);
  const onBindViewRef = useRef(onBindView);
  const dragRef = useRef<HotspotDragSession | null>(null);
  const dragElementRef = useRef<HTMLElement | null>(null);
  const markerSignatures = useRef(
    new Map<string, { signature: string; placement: HotspotMarkerSpec["placement"] }>(),
  );
  const syncMarkersRef = useRef<() => void>(() => undefined);

  const [retry, setRetry] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [infoPoint, setInfoPoint] = useState<{ x: number; y: number } | null>(null);
  const sourceKey = JSON.stringify(scenes);
  const infoHotspot =
    scenes
      .flatMap((scene) => scene.hotspots)
      .find((hotspot) => hotspot.id === infoId && hotspot.type === "info") ?? null;

  useEffect(() => {
    scenesRef.current = scenes;
    sceneIdRef.current = currentSceneId;
    onSceneChangeRef.current = onSceneChange;
    editModeRef.current = editMode;
    placingRef.current = placing;
    selectedIdRef.current = selectedHotspotId;
    onPlaceRef.current = onPlace;
    onSelectRef.current = onSelectHotspot;
    onMoveRef.current = onMoveHotspot;
    onBindViewRef.current = onBindView;
    syncMarkersRef.current = () => {
      const markers = markersRef.current;
      if (!markers || dragRef.current?.isDragging) return;
      const scene = scenesRef.current.find((item) => item.id === sceneIdRef.current);
      if (!scene) return;
      const specs = hotspotMarkerSpecs({
        hotspots: scene.hotspots,
        sceneIds: new Set(scenesRef.current.map((item) => item.id)),
        editMode: editModeRef.current,
        selectedId: selectedIdRef.current,
      });
      applyHotspotMarkers(
        markers,
        specs,
        markerSignatures.current,
        editModeRef.current ? "hotspot:" : "info:",
        (element, hotspotId) => {
          if (!editModeRef.current || element.dataset.dragBound === "1") return;
          element.dataset.dragBound = "1";
          element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            const session = dragRef.current;
            if (!session || !editModeRef.current) return;
            dragElementRef.current = element;
            session.pointerDown(hotspotId, event);
            const move = (pointerEvent: PointerEvent) => session.pointerMove(pointerEvent);
            const up = (pointerEvent: PointerEvent) => {
              session.pointerUp(pointerEvent);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", cancel);
            };
            const cancel = () => {
              session.cancel();
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", cancel);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", cancel);
          });
        },
      );
    };
  }, [
    scenes,
    currentSceneId,
    onSceneChange,
    editMode,
    placing,
    selectedHotspotId,
    onPlace,
    onSelectHotspot,
    onMoveHotspot,
    onBindView,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    bootedRef.current = false;
    loadingRef.current = false;
    nodesKeyRef.current = null;
    setRevealed(false);
    setError(null);
    setInfoId(null);
    markerSignatures.current.clear();

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
    dragRef.current = new HotspotDragSession({
      setMousemove: (enabled) => viewer.setOption("mousemove", enabled),
      capture: (pointerId) => dragElementRef.current?.setPointerCapture(pointerId),
      releaseCapture: (pointerId) => {
        const element = dragElementRef.current;
        if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      },
      viewerPoint: (event) => {
        const rect = container.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      },
      toSpherical: (point) => viewer.dataHelper.viewerCoordsToSphericalCoords(point),
      updateMarker: (id, yaw, pitch) => {
        markers.updateMarker({ id: `hotspot:${id}`, position: { yaw, pitch } }, true);
      },
      commit: (id, yaw, pitch) => onMoveRef.current?.({ id, yaw, pitch }),
    });
    onBindViewRef.current?.(() => {
      const position = viewer.getPosition();
      return { yaw: position.yaw, pitch: position.pitch };
    });

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
      setInfoId(null);
      window.requestAnimationFrame(() => syncMarkersRef.current());
    });
    viewer.addEventListener("click", (event) => {
      if (!editModeRef.current || !placingRef.current) return;
      if (event.data.rightclick || event.data.marker) return;
      onPlaceRef.current?.({ yaw: event.data.yaw, pitch: event.data.pitch });
    });
    markers.addEventListener("select-marker", (event) => {
      if (event.rightClick) return;
      const data = event.marker.data as
        { kind?: string; hotspotId?: string; targetSceneId?: string | null } | undefined;
      if (editModeRef.current && data?.hotspotId) {
        onSelectRef.current?.(data.hotspotId);
        const hotspot = findHotspot(scenesRef.current, data.hotspotId);
        setInfoId(hotspot?.type === "info" ? hotspot.id : null);
        return;
      }
      if (data?.kind === "info" && data.hotspotId) {
        setInfoId(data.hotspotId);
        return;
      }
      if (data?.kind === "link" && data.targetSceneId) onSceneChangeRef.current(data.targetSceneId);
    });

    return () => {
      window.clearTimeout(timer);
      bootedRef.current = false;
      loadingRef.current = false;
      nodesKeyRef.current = null;
      dragRef.current?.cancel();
      dragRef.current = null;
      onBindViewRef.current?.(() => null);
      viewer.destroy();
      viewerRef.current = null;
      tourRef.current = null;
      markersRef.current = null;
    };
  }, [slug, retry]);

  useEffect(() => {
    const tour = tourRef.current;
    if (!tour) return;
    const built = buildVirtualTourNodes({
      slug,
      scenes: scenesRef.current,
      maxTextureSize: readMaxTextureSize(),
      includeLinks: !editModeRef.current,
    });
    const nodes = toPluginNodes(built);
    const key = viewerNodesKey(built);
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
    if (!revealed) return;
    syncMarkersRef.current();
  }, [sourceKey, currentSceneId, revealed, editMode, selectedHotspotId]);

  useEffect(() => {
    if (!infoHotspot) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const viewer = viewerRef.current;
      const container = containerRef.current;
      if (!viewer || !container) return;
      const visible = viewer.dataHelper.isPointVisible({
        yaw: infoHotspot.yaw,
        pitch: infoHotspot.pitch,
      });
      const raw = visible
        ? viewer.dataHelper.sphericalCoordsToViewerCoords({
            yaw: infoHotspot.yaw,
            pitch: infoHotspot.pitch,
          })
        : null;
      setInfoPoint(
        placeInfoPopover({
          visible,
          point: raw,
          viewerWidth: container.clientWidth,
          viewerHeight: container.clientHeight,
          boxWidth: INFO_BOX_WIDTH,
          boxHeight: INFO_BOX_HEIGHT,
        }),
      );
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
  }, [infoHotspot]);

  return (
    <div
      className={`relative h-full min-h-[240px] w-full bg-[var(--acton-navy)] ${placing ? "cursor-crosshair" : ""}`}
    >
      <style>{`.tour-viewer .psv-loader,.tour-viewer .psv-navbar{display:none !important}.tour-hotspot-pulse{transform-origin:50% 50%;animation:tour-hotspot-pulse 1.4s ease-out infinite}@keyframes tour-hotspot-pulse{0%{transform:scale(.7);opacity:.65}100%{transform:scale(1.7);opacity:0}}`}</style>
      {placing ? (
        <p className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md bg-[var(--acton-yellow)] px-3 py-1 text-xs font-semibold text-[var(--acton-navy)]">
          Click the panorama to place a hotspot. Escape cancels.
        </p>
      ) : null}
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
      {infoHotspot && infoPoint ? (
        <InfoPopover
          label={infoHotspot.label}
          content={infoHotspot.content}
          x={infoPoint.x}
          y={infoPoint.y}
          onClose={() => setInfoId(null)}
        />
      ) : null}
    </div>
  );
}

function findHotspot(scenes: ViewerScene[], hotspotId: string): ViewerHotspot | null {
  for (const scene of scenes) {
    const hotspot = scene.hotspots.find((item) => item.id === hotspotId);
    if (hotspot) return hotspot;
  }
  return null;
}

function applyHotspotMarkers(
  markers: MarkersPlugin,
  specs: HotspotMarkerSpec[],
  signatures: Map<string, { signature: string; placement: HotspotMarkerSpec["placement"] }>,
  managedPrefix: string,
  bind: (element: HTMLElement, hotspotId: string) => void,
): void {
  const existing = markers.getMarkers().map((marker) => ({
    id: marker.id,
    signature: signatures.get(marker.id)?.signature ?? "",
    placement: signatures.get(marker.id)?.placement,
  }));
  const plan = planMarkerSync({ existing, desired: specs, managedPrefix });
  for (const id of plan.remove) {
    markers.removeMarker(id);
    signatures.delete(id);
  }
  for (const marker of plan.update) {
    markers.updateMarker(markerConfig(marker), true);
    signatures.set(marker.id, { signature: marker.signature, placement: marker.placement });
    const element = markers.getMarker(marker.id).domElement;
    if (element instanceof HTMLElement) bind(element, marker.hotspotId);
  }
  for (const marker of plan.add) {
    markers.addMarker(markerConfig(marker), true);
    signatures.set(marker.id, { signature: marker.signature, placement: marker.placement });
    const element = markers.getMarker(marker.id).domElement;
    if (element instanceof HTMLElement) bind(element, marker.hotspotId);
  }
}

function markerConfig(marker: HotspotMarkerSpec): MarkerConfig {
  const data = {
    kind: marker.markerKind,
    hotspotId: marker.hotspotId,
    targetSceneId: marker.targetSceneId,
    placement: marker.placement,
  };
  if (marker.placement === "floor") {
    const element = document.createElement("div");
    element.innerHTML = marker.html;
    element.style.width = `${marker.width}px`;
    element.style.height = `${marker.height}px`;
    return {
      id: marker.id,
      elementLayer: element,
      position: { yaw: marker.yaw, pitch: marker.pitch },
      rotation: { yaw: 0, pitch: FLOOR_MARKER_PITCH, roll: hotspotRollRadians(marker.rotation) },
      anchor: "center center",
      hideList: true,
      data,
    };
  }
  return {
    id: marker.id,
    position: { yaw: marker.yaw, pitch: marker.pitch },
    html: marker.html,
    size: { width: marker.width, height: marker.height },
    rotation: marker.rotation ? `${marker.rotation}deg` : 0,
    anchor: "center center",
    hideList: true,
    data,
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
