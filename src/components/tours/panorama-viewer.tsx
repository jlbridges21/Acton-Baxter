import { useEffect, useRef, useState } from "react";
import { Viewer } from "@photo-sphere-viewer/core";
import { AutorotatePlugin } from "@photo-sphere-viewer/autorotate-plugin";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";
import { MarkersPlugin, type MarkerConfig } from "@photo-sphere-viewer/markers-plugin";
import {
  VirtualTourPlugin,
  type VirtualTourLink,
  type VirtualTourNode,
} from "@photo-sphere-viewer/virtual-tour-plugin";
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
import { sceneTransitionOptions } from "@/lib/tours/scene-transition";
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
const DRAG_HINT_KEY = "baxter.tours.drag-hint";
const AUTOROTATE_IDLE_MS = 4000;

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
  warmOtherScenes = false,
  pauseWarm = false,
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
  /** After the open scene loads, fetch the other scenes one at a time. */
  warmOtherScenes?: boolean;
  pauseWarm?: boolean;
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
  const openHotspotRef = useRef<(hotspotId: string) => void>(() => undefined);
  const autorotateRef = useRef<AutorotatePlugin | null>(null);
  const gyroscopeRef = useRef<GyroscopePlugin | null>(null);
  const markerSignatures = useRef(
    new Map<string, { signature: string; placement: HotspotMarkerSpec["placement"] }>(),
  );
  const syncMarkersRef = useRef<() => void>(() => undefined);

  const [retry, setRetry] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [infoPoint, setInfoPoint] = useState<{ x: number; y: number } | null>(null);
  const [cover, setCover] = useState<{ thumbUrl: string | null; fading: boolean } | null>(null);
  const [arrival, setArrival] = useState<{ name: string; token: number } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [gyroReady, setGyroReady] = useState(false);
  const [panoramaBusy, setPanoramaBusy] = useState(false);
  const [settledSceneId, setSettledSceneId] = useState<string | null>(null);
  const sourceKey = JSON.stringify(scenes);
  const sceneWarmKey = scenes.map((scene) => scene.id).join("\n");
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
    openHotspotRef.current = (hotspotId: string) => {
      const hotspot = findHotspot(scenesRef.current, hotspotId);
      if (!hotspot) return;
      if (editModeRef.current) {
        onSelectRef.current?.(hotspotId);
        setInfoId(hotspot.type === "info" ? hotspot.id : null);
        return;
      }
      if (hotspot.type === "info") {
        setInfoId(hotspot.id);
        return;
      }
      if (hotspot.type !== "link" || !hotspot.targetSceneId) return;
      const tour = tourRef.current;
      if (!tour || loadingRef.current) return;
      loadingRef.current = true;
      void tour
        .setCurrentNode(hotspot.targetSceneId, undefined, {
          nodeId: hotspot.targetSceneId,
          position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
        })
        .finally(() => {
          loadingRef.current = false;
        });
    };
    syncMarkersRef.current = () => {
      const markers = markersRef.current;
      if (!markers || dragRef.current?.isDragging) return;
      const scene = scenesRef.current.find((item) => item.id === sceneIdRef.current);
      if (!scene) return;
      const specs = hotspotMarkerSpecs({
        hotspots: scene.hotspots,
        sceneIds: new Set(scenesRef.current.map((item) => item.id)),
        sceneNames: new Map(scenesRef.current.map((item) => [item.id, item.name])),
        editMode: editModeRef.current,
        selectedId: selectedIdRef.current,
      });
      applyHotspotMarkers(
        markers,
        specs,
        markerSignatures.current,
        editModeRef.current ? "hotspot:" : "info:",
        (element, hotspotId) => {
          if (element.dataset.keyBound !== "1") {
            element.dataset.keyBound = "1";
            element.tabIndex = 0;
            if (!element.getAttribute("role")) element.setAttribute("role", "button");
            element.addEventListener("keydown", (event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              openHotspotRef.current(hotspotId);
            });
          }
          const hotspot = findHotspot(scenesRef.current, hotspotId);
          const targetName =
            hotspot?.type === "link" && hotspot.targetSceneId
              ? scenesRef.current.find((item) => item.id === hotspot.targetSceneId)?.name
              : null;
          if (targetName) element.setAttribute("aria-label", targetName);
          else element.removeAttribute("aria-label");
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
    setCover(null);
    setArrival(null);
    setShowHint(false);
    setGyroReady(false);
    setPanoramaBusy(false);
    setSettledSceneId(null);
    markerSignatures.current.clear();

    const published = !editModeRef.current;
    const viewer = new Viewer({
      container,
      navbar: false,
      keyboard: "always",
      loadingTxt: "",
      plugins: [
        MarkersPlugin.withConfig({
          markers: [],
          defaultHoverScale: { amount: 1.12, duration: 160, easing: "ease-out" },
        }),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
          renderMode: "3d",
          transitionOptions: (toNode, _fromNode, fromLink) => {
            const scene = scenesRef.current.find((item) => item.id === toNode.id);
            return sceneTransitionOptions({
              editMode: editModeRef.current,
              fromLink: Boolean(fromLink),
              zoomLevel: viewerRef.current?.getZoomLevel() ?? 50,
              openingView: scene?.hasInitialView
                ? { yaw: scene.initialYaw, pitch: scene.initialPitch }
                : null,
            });
          },
        }),
        ...(published
          ? [
              AutorotatePlugin.withConfig({
                autostartDelay: AUTOROTATE_IDLE_MS,
                autostartOnIdle: true,
                autorotateSpeed: "0.8rpm",
              }),
              GyroscopePlugin.withConfig({ moveMode: "smooth" }),
            ]
          : []),
      ],
    });
    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    viewerRef.current = viewer;
    tourRef.current = tour;
    markersRef.current = markers;
    const autorotate = published ? viewer.getPlugin<AutorotatePlugin>(AutorotatePlugin) : null;
    const gyroscope = published ? viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin) : null;
    autorotateRef.current = autorotate;
    gyroscopeRef.current = gyroscope;
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

    let captionTimer = 0;
    let hintTimer = 0;
    let coverTimer = 0;
    let coverToken = 0;
    let alive = true;

    const timer = window.setTimeout(() => {
      loadingRef.current = false;
      setCover(null);
      setPanoramaBusy(false);
      setRevealed(false);
      setError("This panorama took too long to load.");
    }, LOAD_TIMEOUT_MS);

    const reveal = () => {
      const sceneId = tour.getCurrentNode()?.id;
      const scene = scenesRef.current.find((item) => item.id === sceneId);
      const firstReveal = !bootedRef.current;
      if (firstReveal && scene?.hasInitialView) {
        viewer.rotate({ yaw: scene.initialYaw, pitch: scene.initialPitch });
      }
      loadingRef.current = false;
      bootedRef.current = true;
      window.clearTimeout(timer);
      setError(null);
      setPanoramaBusy(false);
      setSettledSceneId(tour.getCurrentNode()?.id ?? null);
      setRevealed(true);
      const token = ++coverToken;
      setCover((current) => (current ? { ...current, fading: true } : null));
      window.clearTimeout(coverTimer);
      coverTimer = window.setTimeout(() => {
        if (token === coverToken) setCover(null);
      }, 700);
      if (firstReveal && !editModeRef.current && !dragHintSeen()) {
        markDragHintSeen();
        setShowHint(true);
        hintTimer = window.setTimeout(() => setShowHint(false), 3200);
      }
    };

    viewer.addEventListener("panorama-load", (event) => {
      const scene = sceneForPanorama(scenesRef.current, event.panorama);
      coverToken += 1;
      window.clearTimeout(coverTimer);
      setCover({ thumbUrl: scene?.thumbUrl ?? null, fading: false });
      setPanoramaBusy(true);
      setSettledSceneId(null);
    });
    viewer.addEventListener("panorama-loaded", reveal);
    viewer.addEventListener("panorama-error", () => {
      window.clearTimeout(timer);
      loadingRef.current = false;
      setCover(null);
      setPanoramaBusy(false);
      setRevealed(false);
      setError("This panorama could not be loaded.");
    });
    tour.addEventListener("node-changed", (event) => {
      const nodeId = event.node.id;
      onSceneChangeRef.current(nodeId);
      setInfoId(null);
      if (!editModeRef.current && event.node.name) {
        setArrival({ name: event.node.name, token: Date.now() });
        window.clearTimeout(captionTimer);
        captionTimer = window.setTimeout(() => setArrival(null), 2400);
      }
      window.requestAnimationFrame(() => syncMarkersRef.current());
    });
    const pauseDrift = () => {
      autorotate?.stop();
      markViewerActive(viewer);
    };
    viewer.addEventListener("click", (event) => {
      pauseDrift();
      if (!editModeRef.current || !placingRef.current) return;
      if (event.data.rightclick || event.data.marker) return;
      onPlaceRef.current?.({ yaw: event.data.yaw, pitch: event.data.pitch });
    });
    viewer.addEventListener("zoom-updated", pauseDrift);
    viewer.addEventListener("key-press", (event) => {
      const active = document.activeElement;
      if (tourKeysShouldYield(active, container)) event.preventDefault();
    });
    container.addEventListener("pointerdown", pauseDrift);
    container.addEventListener("wheel", pauseDrift, { passive: true });
    const onEnterLink = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || editModeRef.current) return;
      const link = linkFromArrow(event.target);
      if (!link || loadingRef.current) return;
      event.preventDefault();
      loadingRef.current = true;
      void tour.setCurrentNode(link.nodeId, undefined, link).finally(() => {
        loadingRef.current = false;
      });
    };
    container.addEventListener("keydown", onEnterLink);
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
      if (data?.kind === "link" && data.hotspotId) openHotspotRef.current(data.hotspotId);
    });
    gyroscope?.addEventListener("gyroscope-updated", (event) => {
      if (!autorotate) return;
      if (event.gyroscopeEnabled) {
        autorotate.stop();
        autorotate.setOption("autostartOnIdle", false);
        return;
      }
      autorotate.setOption("autostartOnIdle", true);
    });
    if (gyroscope) {
      void gyroscope.isSupported().then((supported) => {
        if (alive && supported) setGyroReady(true);
      });
    }

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(captionTimer);
      window.clearTimeout(hintTimer);
      window.clearTimeout(coverTimer);
      container.removeEventListener("pointerdown", pauseDrift);
      container.removeEventListener("wheel", pauseDrift);
      container.removeEventListener("keydown", onEnterLink);
      bootedRef.current = false;
      loadingRef.current = false;
      nodesKeyRef.current = null;
      dragRef.current?.cancel();
      dragRef.current = null;
      autorotateRef.current = null;
      gyroscopeRef.current = null;
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
    if (!warmOtherScenes || pauseWarm || !revealed || panoramaBusy) return;
    if (settledSceneId !== currentSceneId) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    const urls = buildVirtualTourNodes({
      slug,
      scenes: scenesRef.current,
      maxTextureSize: readMaxTextureSize(),
      includeLinks: false,
    })
      .filter((node) => node.id !== currentSceneId)
      .map((node) => node.panorama);
    void (async () => {
      for (const url of urls) {
        if (cancelled) return;
        await waitToWarm();
        if (cancelled) return;
        try {
          await viewer.textureLoader.preloadPanorama(url);
        } catch {
          // This scene still loads when the author opens it.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    warmOtherScenes,
    pauseWarm,
    revealed,
    panoramaBusy,
    settledSceneId,
    currentSceneId,
    sceneWarmKey,
    slug,
    retry,
  ]);

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
      <style>{VIEWER_STYLE}</style>
      {placing ? (
        <p className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md bg-[var(--acton-yellow)] px-3 py-1 text-xs font-semibold text-[var(--acton-navy)]">
          Click the panorama to place a hotspot. Escape cancels.
        </p>
      ) : null}
      {arrival && !editMode ? (
        <p
          key={arrival.token}
          className="tour-arrival-name pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-black/45 px-4 py-2 text-sm font-semibold text-white"
          aria-live="polite"
        >
          {arrival.name}
        </p>
      ) : null}
      {showHint && !editMode ? (
        <p className="tour-drag-hint pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-xs font-semibold text-white">
          Drag to look around
        </p>
      ) : null}
      {gyroReady && !editMode ? (
        <button
          type="button"
          className="absolute top-3 right-3 z-20 hidden h-10 w-10 items-center justify-center rounded-full bg-[var(--acton-navy)]/70 text-white [@media(pointer:coarse)]:inline-flex"
          aria-label="Look around with device motion"
          onClick={() => gyroscopeRef.current?.toggle()}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 3.5 14 8.5 12 7.2 10 8.5Z" fill="currentColor" />
          </svg>
        </button>
      ) : null}
      {cover && !error ? (
        cover.thumbUrl ? (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 z-[6] scale-110 bg-cover bg-center blur-2xl transition-opacity duration-700 ${cover.fading ? "opacity-0" : "opacity-100"}`}
            style={{ backgroundImage: `url("${cover.thumbUrl}")` }}
          />
        ) : (
          <div
            className={`pointer-events-none absolute inset-0 z-[6] bg-[var(--acton-navy)] transition-opacity duration-700 ${cover.fading ? "opacity-0" : "opacity-100"}`}
          />
        )
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
        className={`tour-viewer h-full w-full transition-opacity duration-700 ${revealed && !error ? "opacity-100" : "opacity-0"}`}
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

const VIEWER_STYLE = `.tour-viewer .psv-loader,.tour-viewer .psv-navbar{display:none !important}.psv-marker{cursor:pointer}.psv-marker:hover{filter:brightness(1.25)}.psv-virtual-tour-link{cursor:pointer;transition:scale 160ms ease-out,filter 160ms ease-out}.psv-virtual-tour-link:hover,.psv-virtual-tour-link:focus-visible{scale:1.12;filter:brightness(1.25)}.psv-marker:focus-visible,.psv-virtual-tour-link:focus-visible{outline:2px solid #f5c518;outline-offset:3px}.tour-hotspot-pulse{transform-origin:50% 50%;animation:tour-hotspot-pulse 1.4s ease-out infinite}@keyframes tour-hotspot-pulse{0%{transform:scale(.7);opacity:.65}100%{transform:scale(1.7);opacity:0}}@keyframes tour-caption-in-out{0%{opacity:0}15%{opacity:1}72%{opacity:1}100%{opacity:0}}.tour-arrival-name,.tour-drag-hint{animation:tour-caption-in-out 2.6s ease forwards}`;

function sceneForPanorama(scenes: ViewerScene[], panorama: unknown): ViewerScene | undefined {
  const url = typeof panorama === "string" ? panorama : "";
  return scenes.find((scene) => url.includes(`/image/${encodeURIComponent(scene.id)}`));
}

function tourKeysShouldYield(active: Element | null, viewer: HTMLElement): boolean {
  if (!active || active === document.body || active === document.documentElement) return false;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  return !viewer.contains(active);
}

function linkFromArrow(target: EventTarget | null): VirtualTourLink | null {
  if (!(target instanceof Element)) return null;
  const host = target.closest(".psv-virtual-tour-link");
  if (!host) return null;
  for (const key of Object.getOwnPropertySymbols(host)) {
    const value = (host as unknown as Record<symbol, unknown>)[key];
    if (!value || typeof value !== "object" || !("nodeId" in value)) continue;
    const nodeId = (value as { nodeId?: unknown }).nodeId;
    if (typeof nodeId === "string") return value as VirtualTourLink;
  }
  return null;
}

function markViewerActive(viewer: Viewer): void {
  const withIdle = viewer as Viewer & { resetIdleTimer?: () => void };
  withIdle.resetIdleTimer?.();
}

function dragHintSeen(): boolean {
  try {
    return window.sessionStorage.getItem(DRAG_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function markDragHintSeen(): void {
  try {
    window.sessionStorage.setItem(DRAG_HINT_KEY, "1");
  } catch {
    // Private mode can reject storage. The hint still dismisses itself.
  }
}

function waitToWarm(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 1500 });
      return;
    }
    window.setTimeout(resolve, 300);
  });
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
  const tooltip = marker.tooltip ? { tooltip: marker.tooltip } : {};
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
      ...tooltip,
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
    ...tooltip,
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
