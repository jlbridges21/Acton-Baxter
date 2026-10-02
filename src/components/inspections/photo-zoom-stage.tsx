"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  PHOTO_SWIPE_THRESHOLD_PX,
  PHOTO_ZOOM_FIT,
  PHOTO_ZOOM_STEP,
  clampPhotoPan,
  clickPhotoZoom,
  fittedPhotoSize,
  isPhotoPanDrag,
  isPhotoZoomed,
  maxPhotoZoom,
  photoPanAfterQuarterTurnCcw,
  type PhotoZoom,
  type PhotoZoomSize,
  zoomAboutPoint,
} from "@/lib/inspections/photo-zoom";

export type PhotoZoomHandle = {
  isZoomed: () => boolean;
  reset: () => void;
  zoomBy: (delta: number) => void;
  /** Apply on the next image load so a rotated file and its pan arrive together. */
  rotateQuarterTurn: () => void;
  /** If that load already happened, rotate the current pan once. */
  finishRotate: () => void;
  cancelRotate: () => void;
};

type PhotoZoomStageProps = {
  mediaId: string;
  src: string;
  loading: boolean;
  onLoad: () => void;
  onError: () => void;
  /** Horizontal swipe at fit. Positive delta moves to the previous photo. */
  onSwipe: (delta: number) => void;
};

const EMPTY_SIZE: PhotoZoomSize = { width: 0, height: 0 };

/**
 * The <img> is laid out at its natural pixel size and only moved with a
 * transform, so zoom and pan stay on the compositor and a signed-URL remount
 * does not throw away the decoded bitmap's framing.
 */
export const PhotoZoomStage = forwardRef<PhotoZoomHandle, PhotoZoomStageProps>(
  function PhotoZoomStage({ mediaId, src, loading, onLoad, onError, onSwipe }, ref) {
    const zoomId = useId();
    const stageRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<PhotoZoom>(PHOTO_ZOOM_FIT);
    const viewportRef = useRef<PhotoZoomSize>(EMPTY_SIZE);
    const naturalRef = useRef<PhotoZoomSize>(EMPTY_SIZE);
    const maxZoomRef = useRef(1);
    const pendingRotateRef = useRef(false);
    const onSwipeRef = useRef(onSwipe);
    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    const commitRef = useRef<(next: PhotoZoom, smooth: boolean) => void>(() => undefined);
    const [view, setView] = useState<PhotoZoom>(PHOTO_ZOOM_FIT);
    const [natural, setNatural] = useState<PhotoZoomSize>(EMPTY_SIZE);
    const [viewport, setViewport] = useState<PhotoZoomSize>(EMPTY_SIZE);
    const [devicePixelRatio, setDevicePixelRatio] = useState(1);
    const [smooth, setSmooth] = useState(false);

    onSwipeRef.current = onSwipe;
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;

    const fit = fittedPhotoSize(viewport, natural);
    const maxZoom = maxPhotoZoom({
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      fitWidth: fit.width,
      fitHeight: fit.height,
      devicePixelRatio,
    });
    maxZoomRef.current = maxZoom;
    const fitScale = natural.width > 0 ? fit.width / natural.width : 1;
    const zoomed = isPhotoZoomed(view.zoom);

    function commit(next: PhotoZoom, animate: boolean) {
      const limited = zoomAboutPoint(next, next.zoom, 0, 0, maxZoomRef.current);
      const clamped = clampPhotoPan(
        limited,
        viewportRef.current,
        fittedPhotoSize(viewportRef.current, naturalRef.current),
      );
      const current = viewRef.current;
      viewRef.current = clamped;
      if (
        current.zoom === clamped.zoom &&
        current.panX === clamped.panX &&
        current.panY === clamped.panY
      ) {
        return;
      }
      setSmooth(animate);
      setView(clamped);
    }
    commitRef.current = commit;

    useImperativeHandle(ref, () => ({
      isZoomed: () => isPhotoZoomed(viewRef.current.zoom),
      reset: () => commitRef.current(PHOTO_ZOOM_FIT, true),
      zoomBy: (delta) => {
        const current = viewRef.current;
        commitRef.current(
          zoomAboutPoint(current, current.zoom + delta, 0, 0, maxZoomRef.current),
          true,
        );
      },
      rotateQuarterTurn: () => {
        pendingRotateRef.current = true;
      },
      finishRotate: () => {
        if (!pendingRotateRef.current) return;
        pendingRotateRef.current = false;
        commitRef.current(photoPanAfterQuarterTurnCcw(viewRef.current), true);
      },
      cancelRotate: () => {
        pendingRotateRef.current = false;
      },
    }));

    useEffect(() => {
      viewRef.current = PHOTO_ZOOM_FIT;
      setView(PHOTO_ZOOM_FIT);
      setNatural(EMPTY_SIZE);
      naturalRef.current = EMPTY_SIZE;
      pendingRotateRef.current = false;
    }, [mediaId]);

    useEffect(() => {
      const read = () => setDevicePixelRatio(window.devicePixelRatio || 1);
      read();
      window.addEventListener("resize", read);
      const query = window.matchMedia?.("(resolution: 1dppx)");
      query?.addEventListener?.("change", read);
      return () => {
        window.removeEventListener("resize", read);
        query?.removeEventListener?.("change", read);
      };
    }, []);

    useEffect(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const surface = stage;

      function measure() {
        const next = { width: surface.clientWidth, height: surface.clientHeight };
        viewportRef.current = next;
        setViewport(next);
        commitRef.current(viewRef.current, false);
      }

      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(stage);
      return () => observer.disconnect();
    }, [mediaId]);

    useEffect(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const surface = stage;

      function pointFrom(clientX: number, clientY: number) {
        const rect = surface.getBoundingClientRect();
        return {
          x: clientX - (rect.left + rect.width / 2),
          y: clientY - (rect.top + rect.height / 2),
        };
      }

      function onWheel(event: WheelEvent) {
        event.preventDefault();
        const point = pointFrom(event.clientX, event.clientY);
        const current = viewRef.current;
        commitRef.current(
          zoomAboutPoint(
            current,
            current.zoom * Math.exp(-event.deltaY * 0.0015),
            point.x,
            point.y,
            maxZoomRef.current,
          ),
          false,
        );
      }

      let touch: {
        x: number;
        y: number;
        panX: number;
        panY: number;
        moved: boolean;
      } | null = null;
      let pinch: { distance: number; zoom: number; panX: number; panY: number } | null = null;

      function onTouchStart(event: TouchEvent) {
        if (event.target instanceof Element && event.target.closest("[data-photo-zoom-control]")) {
          return;
        }
        if (event.touches.length >= 2) {
          const first = event.touches[0];
          const second = event.touches[1];
          if (!first || !second) return;
          pinch = {
            distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
            zoom: viewRef.current.zoom,
            panX: viewRef.current.panX,
            panY: viewRef.current.panY,
          };
          touch = null;
          return;
        }
        const first = event.touches[0];
        if (!first) return;
        touch = {
          x: first.clientX,
          y: first.clientY,
          panX: viewRef.current.panX,
          panY: viewRef.current.panY,
          moved: false,
        };
      }

      function onTouchMove(event: TouchEvent) {
        if (event.touches.length >= 2 && pinch) {
          const first = event.touches[0];
          const second = event.touches[1];
          if (!first || !second || pinch.distance <= 0) return;
          event.preventDefault();
          const distance = Math.hypot(
            first.clientX - second.clientX,
            first.clientY - second.clientY,
          );
          const midpoint = pointFrom(
            (first.clientX + second.clientX) / 2,
            (first.clientY + second.clientY) / 2,
          );
          commitRef.current(
            zoomAboutPoint(
              { zoom: pinch.zoom, panX: pinch.panX, panY: pinch.panY },
              pinch.zoom * (distance / pinch.distance),
              midpoint.x,
              midpoint.y,
              maxZoomRef.current,
            ),
            false,
          );
          return;
        }
        if (!touch || event.touches.length !== 1 || !isPhotoZoomed(viewRef.current.zoom)) return;
        const first = event.touches[0];
        if (!first) return;
        const dx = first.clientX - touch.x;
        const dy = first.clientY - touch.y;
        if (!touch.moved && !isPhotoPanDrag(dx, dy)) return;
        event.preventDefault();
        touch.moved = true;
        commitRef.current(
          {
            zoom: viewRef.current.zoom,
            panX: touch.panX + dx,
            panY: touch.panY + dy,
          },
          false,
        );
      }

      function onTouchEnd(event: TouchEvent) {
        if (event.touches.length < 2) pinch = null;
        if (event.touches.length > 0) return;
        const ended = touch;
        touch = null;
        if (!ended) return;
        const dx = (event.changedTouches[0]?.clientX ?? ended.x) - ended.x;
        const dy = (event.changedTouches[0]?.clientY ?? ended.y) - ended.y;
        if (isPhotoZoomed(viewRef.current.zoom)) {
          if (!ended.moved && !isPhotoPanDrag(dx, dy)) {
            const point = pointFrom(ended.x, ended.y);
            commitRef.current(
              clickPhotoZoom(viewRef.current, point.x, point.y, maxZoomRef.current),
              true,
            );
          }
          return;
        }
        if (Math.abs(dx) >= PHOTO_SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
          onSwipeRef.current(dx > 0 ? -1 : 1);
          return;
        }
        if (!isPhotoPanDrag(dx, dy)) {
          const point = pointFrom(ended.x, ended.y);
          commitRef.current(
            clickPhotoZoom(viewRef.current, point.x, point.y, maxZoomRef.current),
            true,
          );
        }
      }

      stage.addEventListener("wheel", onWheel, { passive: false });
      stage.addEventListener("touchstart", onTouchStart, { passive: true });
      stage.addEventListener("touchmove", onTouchMove, { passive: false });
      stage.addEventListener("touchend", onTouchEnd);
      stage.addEventListener("touchcancel", onTouchEnd);
      return () => {
        stage.removeEventListener("wheel", onWheel);
        stage.removeEventListener("touchstart", onTouchStart);
        stage.removeEventListener("touchmove", onTouchMove);
        stage.removeEventListener("touchend", onTouchEnd);
        stage.removeEventListener("touchcancel", onTouchEnd);
      };
    }, [mediaId]);

    const dragRef = useRef<{
      id: number;
      x: number;
      y: number;
      panX: number;
      panY: number;
      moved: boolean;
    } | null>(null);

    function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("[data-photo-zoom-control]")) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: viewRef.current.panX,
        panY: viewRef.current.panY,
        moved: false,
      };
      setSmooth(false);
    }

    function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId || !isPhotoZoomed(viewRef.current.zoom)) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && !isPhotoPanDrag(dx, dy)) return;
      drag.moved = true;
      commitRef.current(
        { zoom: viewRef.current.zoom, panX: drag.panX + dx, panY: drag.panY + dy },
        false,
      );
    }

    function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.moved || isPhotoPanDrag(dx, dy)) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      commitRef.current(
        clickPhotoZoom(
          viewRef.current,
          event.clientX - (rect.left + rect.width / 2),
          event.clientY - (rect.top + rect.height / 2),
          maxZoomRef.current,
        ),
        true,
      );
    }

    function onImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
      const img = event.currentTarget;
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      naturalRef.current = size;
      setNatural(size);
      if (pendingRotateRef.current) {
        pendingRotateRef.current = false;
        commitRef.current(photoPanAfterQuarterTurnCcw(viewRef.current), true);
      } else {
        commitRef.current(viewRef.current, false);
      }
      onLoadRef.current();
    }

    const ready = natural.width > 0 && fit.width > 0;
    const atMin = !zoomed;
    const atMax = view.zoom >= maxZoom - 1e-3;

    return (
      <div
        ref={stageRef}
        className={`relative h-full w-full overflow-hidden ${
          zoomed ? "cursor-zoom-out" : "cursor-zoom-in"
        }`}
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {loading ? (
          <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/70">
            Loading…
          </p>
        ) : null}
        {/* The natural pixel size keeps the full decode. The transform does the fitting. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={`${mediaId}-${src}`}
          src={src}
          alt=""
          draggable={false}
          width={ready ? natural.width : undefined}
          height={ready ? natural.height : undefined}
          className={`select-none ${
            ready ? "absolute top-1/2 left-1/2 max-w-none" : "max-h-full max-w-full object-contain"
          } ${loading ? "opacity-0" : "opacity-100"} ${
            smooth ? "transition-transform duration-200 ease-out motion-reduce:transition-none" : ""
          }`}
          style={
            ready
              ? {
                  width: natural.width,
                  height: natural.height,
                  transform: `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) scale(${fitScale * view.zoom})`,
                  transformOrigin: "center center",
                  imageRendering: "auto",
                  willChange: "transform",
                }
              : { imageRendering: "auto" }
          }
          onLoad={onImageLoad}
          onError={() => onErrorRef.current()}
        />
        <div
          data-photo-zoom-control
          className="absolute bottom-3 left-3 z-20 flex cursor-auto items-center gap-1.5 rounded-full bg-black/70 px-2 py-1 text-white"
        >
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
            aria-label="Zoom out"
            disabled={atMin}
            onClick={() => {
              const current = viewRef.current;
              commit(zoomAboutPoint(current, current.zoom - PHOTO_ZOOM_STEP, 0, 0, maxZoom), true);
            }}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <label htmlFor={zoomId} className="sr-only">
            Zoom
          </label>
          <input
            id={zoomId}
            type="range"
            min={1}
            max={maxZoom > 1 ? maxZoom : 1}
            step={0.01}
            value={Math.min(view.zoom, maxZoom > 1 ? maxZoom : 1)}
            disabled={maxZoom <= 1}
            aria-valuetext={`${Math.round(view.zoom * 100)} percent`}
            className="h-1 w-28 cursor-pointer accent-white disabled:cursor-default"
            onChange={(event) => {
              const current = viewRef.current;
              commit(zoomAboutPoint(current, Number(event.target.value), 0, 0, maxZoom), true);
            }}
          />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40"
            aria-label="Zoom in"
            disabled={atMax}
            onClick={() => {
              const current = viewRef.current;
              commit(zoomAboutPoint(current, current.zoom + PHOTO_ZOOM_STEP, 0, 0, maxZoom), true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  },
);
