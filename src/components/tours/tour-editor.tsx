"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { HotspotPanel } from "@/components/tours/hotspot-panel";
import { PanoramaUploader } from "@/components/tours/panorama-uploader";
import { SceneList } from "@/components/tours/scene-list";
import { ShareDialog } from "@/components/tours/share-dialog";
import { TourStage } from "@/components/tours/tour-stage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  clearSceneOpeningView,
  createHotspot,
  deleteHotspot,
  deleteScene,
  renameScene,
  renameTour,
  reorderScenes,
  saveHotspot,
  setSceneOpeningView,
  saveTourPlayback,
  setTourCover,
  setTourPublic,
} from "@/lib/tours/actions";
import { HotspotDraftController, createHotspotWriteQueue } from "@/lib/tours/hotspot-draft";
import {
  browserHotspotStorage,
  readHotspotStyle,
  styleFieldsChanged,
  writeHotspotStyle,
} from "@/lib/tours/hotspot-style";
import { tourSaveLabel, tourSaveState } from "@/lib/tours/save-state";
import {
  tourTransitionEffect,
  tourTransitionSpeed,
  type TourTransitionEffect,
  type TourTransitionSpeed,
} from "@/lib/tours/scene-transition";
import type { ViewerHotspot, ViewerScene, ViewerTour } from "@/lib/tours/viewer-model";

const FRAME_CHROME = {
  showTitle: false,
  showThumbs: false,
  showShare: false,
  showFullscreen: false,
};

function applyOrder(scenes: ViewerScene[], order: string[] | null): ViewerScene[] {
  if (!order) return scenes;
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  if (order.length !== scenes.length || order.some((id) => !byId.has(id))) return scenes;
  return order.flatMap((id) => {
    const scene = byId.get(id);
    return scene ? [scene] : [];
  });
}

export function TourEditor({ tour }: { tour: ViewerTour }) {
  const [title, setTitle] = useState(tour.title);
  const [savedTitle, setSavedTitle] = useState(tour.title);
  const [isPublic, setIsPublic] = useState(tour.isPublic);
  const [coverId, setCoverId] = useState(tour.coverSceneId);
  const [transitionEffect, setTransitionEffect] = useState(tour.transitionEffect);
  const [transitionSpeed, setTransitionSpeed] = useState(tour.transitionSpeed);
  const [transitionDirectional, setTransitionDirectional] = useState(tour.transitionDirectional);
  const [autorotate, setAutorotate] = useState(tour.autorotate);
  const [savedPlayback, setSavedPlayback] = useState(() => playbackOf(tour));
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(tour.scenes.map((scene) => [scene.id, scene.name])),
  );
  const [savedNames, setSavedNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(tour.scenes.map((scene) => [scene.id, scene.name])),
  );
  const [order, setOrder] = useState<string[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(tour.scenes[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [draftHotspots, setDraftHotspots] = useState<Record<string, ViewerHotspot[]> | null>(null);
  const [hotspotVersion, setHotspotVersion] = useState(0);
  const [hotspots] = useState(() => new HotspotDraftController());
  const [hotspotQueue] = useState(() => createHotspotWriteQueue());
  const [openingOverride, setOpeningOverride] = useState<
    Record<string, { yaw: number; pitch: number } | null>
  >({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const readView = useRef<(() => { yaw: number; pitch: number } | null) | null>(null);
  const scenes = useMemo(
    () => applyOrder(tour.scenes, order).filter((scene) => !removedIds.includes(scene.id)),
    [tour.scenes, order, removedIds],
  );
  hotspots.syncServer(tour.scenes);
  const displayScenes = useMemo(
    () =>
      scenes.map((scene) => ({
        ...withSceneEdits(scene, draftHotspots, openingOverride),
        name: names[scene.id] ?? scene.name,
      })),
    [scenes, draftHotspots, openingOverride, names],
  );
  const activeId = scenes.some((scene) => scene.id === pickedId)
    ? (pickedId ?? "")
    : (scenes[0]?.id ?? "");
  const active = displayScenes.find((scene) => scene.id === activeId) ?? null;
  const selectedHotspot =
    active?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null;
  const playback = {
    transitionEffect,
    transitionSpeed,
    transitionDirectional,
    autorotate,
  };
  const viewerTour = useMemo(
    () => ({
      ...tour,
      scenes: displayScenes,
      transitionEffect,
      transitionSpeed,
      transitionDirectional,
      autorotate,
    }),
    [tour, displayScenes, transitionEffect, transitionSpeed, transitionDirectional, autorotate],
  );
  const saveState = tourSaveState({
    inFlight,
    failed: saveFailed,
    dirty:
      fieldsDirty(tour, savedTitle, savedNames, title, names) ||
      playbackChanged(playback, savedPlayback) ||
      (hotspotVersion >= 0 && hotspots.isDirty(scenes)),
  });

  async function runSave(work: () => Promise<{ error: string | null }>) {
    setInFlight((count) => count + 1);
    setSaveFailed(false);
    try {
      const result = await work();
      setError(result.error);
      if (result.error) setSaveFailed(true);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save.";
      setError(message);
      setSaveFailed(true);
      return { error: message };
    } finally {
      setInFlight((count) => Math.max(0, count - 1));
    }
  }

  async function saveTitle() {
    const next = title.trim() || "Untitled Tour";
    setTitle(next);
    if (next === savedTitle) return;
    const result = await runSave(() => renameTour(tour.id, next));
    if (!result.error) setSavedTitle(next);
  }

  async function commitSceneName(sceneId: string, raw: string) {
    const next = raw.trim() || "Scene";
    setNames((current) => ({ ...current, [sceneId]: next }));
    const scene = scenes.find((item) => item.id === sceneId);
    if (next === (savedNames[sceneId] ?? scene?.name)) return;
    const result = await runSave(() => renameScene(tour.id, sceneId, next));
    if (!result.error) setSavedNames((current) => ({ ...current, [sceneId]: next }));
  }

  async function togglePublic(next: boolean) {
    const previous = isPublic;
    setIsPublic(next);
    setBusy(true);
    const result = await runSave(() => setTourPublic(tour.id, next));
    setBusy(false);
    if (result.error) setIsPublic(previous);
  }

  async function makeCover(sceneId: string) {
    if (sceneId === coverId) return;
    const previous = coverId;
    setCoverId(sceneId);
    setBusy(true);
    const result = await runSave(() => setTourCover(tour.id, sceneId));
    setBusy(false);
    if (result.error) setCoverId(previous);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const index = scenes.findIndex((scene) => scene.id === pendingDelete);
    const neighbor = scenes[index + 1]?.id ?? scenes[index - 1]?.id ?? null;
    setRemovedIds((current) => [...current, pendingDelete]);
    setBusy(true);
    const result = await runSave(() => deleteScene(tour.id, pendingDelete));
    setBusy(false);
    if (result.error) {
      setRemovedIds((current) => current.filter((id) => id !== pendingDelete));
      return;
    }
    if (pickedId === pendingDelete) setPickedId(neighbor);
    setPendingDelete(null);
  }

  async function onReorder(sceneIds: string[]) {
    setOrder(sceneIds);
    setBusy(true);
    const result = await runSave(() => reorderScenes(tour.id, sceneIds));
    setBusy(false);
    if (result.error) setOrder(null);
  }

  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  function publishHotspots() {
    setDraftHotspots(hotspots.drafts);
    setHotspotVersion((version) => version + 1);
  }

  function rememberStyle(previous: ViewerHotspot | null, next: ViewerHotspot) {
    if (!previous || !styleFieldsChanged(previous, next)) return;
    writeHotspotStyle(browserHotspotStorage(), {
      styleShape: next.styleShape,
      stylePlacement: next.stylePlacement,
      styleColor: next.styleColor,
      styleSize: next.styleSize,
    });
  }

  function scheduleHotspot(sceneId: string, hotspotId: string) {
    void hotspotQueue.enqueue(hotspotId, () => writeHotspot(sceneId, hotspotId));
  }

  async function writeHotspot(sceneId: string, hotspotId: string) {
    const revision = hotspots.revision(hotspotId);
    const latest = hotspots.find(sceneId, hotspotId);
    if (!latest) {
      if (!(hotspotId in hotspots.saved)) return;
      const result = await runSave(() => deleteHotspot(tour.id, sceneId, hotspotId));
      hotspots.complete({
        sceneId,
        hotspotId,
        revision,
        error: Boolean(result.error),
        kind: "delete",
        sent: null,
      });
      publishHotspots();
      return;
    }
    const kind = hotspotId in hotspots.saved ? "update" : "insert";
    const result = await runSave(() =>
      kind === "insert"
        ? createHotspot(hotspotBody(tour.id, sceneId, latest))
        : saveHotspot(hotspotBody(tour.id, sceneId, latest)),
    );
    const outcome = hotspots.complete({
      sceneId,
      hotspotId,
      revision,
      error: Boolean(result.error),
      kind,
      sent: latest,
    });
    publishHotspots();
    if (!hotspots.find(sceneId, hotspotId)) {
      setSelectedHotspotId((current) => (current === hotspotId ? null : current));
    }
    if (outcome.resave) scheduleHotspot(sceneId, hotspotId);
  }

  function placeHotspot(position: { yaw: number; pitch: number }) {
    if (!active) return;
    const sceneId = active.id;
    setPlacing(false);
    const style = readHotspotStyle(browserHotspotStorage());
    const hotspot: ViewerHotspot = {
      id: crypto.randomUUID(),
      type: "link",
      yaw: position.yaw,
      pitch: position.pitch,
      label: null,
      content: null,
      targetSceneId: scenes.find((scene) => scene.id !== sceneId)?.id ?? null,
      styleShape: style.styleShape,
      styleColor: style.styleColor,
      styleSize: style.styleSize,
      styleRotation: 0,
      stylePlacement: style.stylePlacement,
    };
    hotspots.place(sceneId, hotspot);
    publishHotspots();
    setSelectedHotspotId(hotspot.id);
    scheduleHotspot(sceneId, hotspot.id);
  }

  function draftHotspot(hotspot: ViewerHotspot) {
    if (!active) return;
    rememberStyle(hotspots.find(active.id, hotspot.id), hotspot);
    hotspots.patch(active.id, hotspot);
    publishHotspots();
  }

  function commitHotspot(hotspot: ViewerHotspot) {
    if (!active) return;
    rememberStyle(hotspots.find(active.id, hotspot.id), hotspot);
    hotspots.patch(active.id, hotspot);
    publishHotspots();
    scheduleHotspot(active.id, hotspot.id);
  }

  function moveHotspot(move: { id: string; yaw: number; pitch: number }) {
    if (!active) return;
    const current = hotspots.find(active.id, move.id);
    if (!current || (current.yaw === move.yaw && current.pitch === move.pitch)) return;
    hotspots.patch(active.id, { ...current, yaw: move.yaw, pitch: move.pitch });
    publishHotspots();
    scheduleHotspot(active.id, move.id);
  }

  function removeHotspot(hotspotId: string) {
    if (!active) return;
    hotspots.remove(active.id, hotspotId);
    publishHotspots();
    if (selectedHotspotId === hotspotId) setSelectedHotspotId(null);
    scheduleHotspot(active.id, hotspotId);
  }

  async function saveOpeningView() {
    if (!active) return;
    const position = readView.current?.();
    if (!position) return;
    setOpeningOverride((current) => ({ ...current, [active.id]: position }));
    setBusy(true);
    const result = await runSave(() =>
      setSceneOpeningView(tour.id, active.id, position.yaw, position.pitch),
    );
    setBusy(false);
    if (result.error) {
      setOpeningOverride((current) => {
        const next = { ...current };
        delete next[active.id];
        return next;
      });
    }
  }

  async function clearOpeningView() {
    if (!active) return;
    setOpeningOverride((current) => ({ ...current, [active.id]: null }));
    setBusy(true);
    const result = await runSave(() => clearSceneOpeningView(tour.id, active.id));
    setBusy(false);
    if (result.error) {
      setOpeningOverride((current) => {
        const next = { ...current };
        delete next[active.id];
        return next;
      });
    }
  }

  async function savePlayback() {
    const next = {
      transitionEffect,
      transitionSpeed,
      transitionDirectional,
      autorotate,
    };
    if (!playbackChanged(next, savedPlayback)) return;
    const result = await runSave(() => saveTourPlayback(tour.id, next));
    if (!result.error) setSavedPlayback(next);
  }

  async function flushPending() {
    if (saveState === "saving" || saveState === "saved") return;
    await saveTitle();
    await savePlayback();
    const writes: Promise<void>[] = [];
    for (const scene of scenes) {
      const raw = names[scene.id] ?? scene.name;
      const next = raw.trim() || "Scene";
      if (next !== (savedNames[scene.id] ?? scene.name)) await commitSceneName(scene.id, raw);
      const live = new Set(hotspots.list(scene.id).map((hotspot) => hotspot.id));
      for (const hotspot of hotspots.list(scene.id)) {
        if (hotspots.saved[hotspot.id] !== JSON.stringify(hotspot)) {
          writes.push(hotspotQueue.enqueue(hotspot.id, () => writeHotspot(scene.id, hotspot.id)));
        }
      }
      for (const hotspot of scene.hotspots) {
        if (!live.has(hotspot.id)) {
          writes.push(hotspotQueue.enqueue(hotspot.id, () => writeHotspot(scene.id, hotspot.id)));
        }
      }
    }
    await Promise.all(writes);
  }

  const saveButtonLabel =
    saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-[var(--acton-gray-50)] lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--acton-border)] bg-white px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            href="/tours"
            className="shrink-0 text-xs font-semibold text-[var(--acton-muted)] hover:underline"
          >
            Tours
          </Link>
          <input
            aria-label="Tour name"
            value={title}
            className="min-w-0 flex-1 bg-transparent text-lg font-bold text-[var(--acton-navy)] outline-none"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <Badge tone={isPublic ? "green" : "gray"}>{isPublic ? "Public" : "Private"}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void togglePublic(!isPublic)}
          >
            {isPublic ? "Make private" : "Make public"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setShareOpen(true)}>
            Share
          </Button>
          <Link
            href={`/tours/${tour.id}/preview`}
            className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] bg-white px-3 text-xs font-semibold text-[var(--acton-navy)]"
          >
            Preview
          </Link>
          <p
            className={`text-xs ${
              saveState === "saved"
                ? "text-emerald-700"
                : saveState === "error"
                  ? "text-red-700"
                  : "text-amber-800"
            }`}
            aria-live="polite"
          >
            {tourSaveLabel(saveState)}
          </p>
          <Button
            type="button"
            size="sm"
            disabled={saveState === "saving" || saveState === "saved"}
            onClick={() => void flushPending()}
          >
            {saveButtonLabel}
          </Button>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="order-1 min-h-[55dvh] min-w-0 flex-1 lg:order-2 lg:min-h-0">
          <div className="relative h-[55dvh] min-h-[320px] overflow-hidden lg:h-full">
            <TourStage
              tour={viewerTour}
              chrome={FRAME_CHROME}
              layout="frame"
              warmOtherScenes
              pauseWarm={uploading}
              sceneId={activeId}
              onSceneChange={(sceneId) => {
                setPickedId(sceneId);
                setSelectedHotspotId(null);
                setPlacing(false);
              }}
              editing={{
                placing,
                selectedHotspotId,
                onPlace: (position) => void placeHotspot(position),
                onSelectHotspot: (hotspotId) => {
                  setSelectedHotspotId(hotspotId);
                  setPlacing(false);
                },
                onMoveHotspot: (move) => void moveHotspot(move),
                onBindView: (read) => {
                  readView.current = read;
                },
              }}
            />
          </div>
        </div>

        <aside className="order-2 flex w-full shrink-0 flex-col border-[var(--acton-border)] lg:order-1 lg:h-full lg:w-72 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <SceneList
              scenes={scenes}
              names={names}
              activeId={activeId}
              coverSceneId={coverId}
              busy={busy}
              onSelect={(sceneId) => {
                setPickedId(sceneId);
                setSelectedHotspotId(null);
                setPlacing(false);
              }}
              onReorder={(ids) => void onReorder(ids)}
              onNameChange={(sceneId, name) =>
                setNames((current) => ({ ...current, [sceneId]: name }))
              }
              onNameCommit={(sceneId, name) => void commitSceneName(sceneId, name)}
              onCover={(sceneId) => void makeCover(sceneId)}
              onDelete={(sceneId) => setPendingDelete(sceneId)}
            />
          </div>
          <div className="shrink-0 border-t border-[var(--acton-border)] p-2">
            <PanoramaUploader tourId={tour.id} onBusyChange={setUploading} />
          </div>
        </aside>

        <aside className="order-3 w-full min-w-0 shrink-0 space-y-6 overflow-x-hidden border-[var(--acton-border)] p-3 lg:h-full lg:w-80 lg:overflow-y-auto lg:border-l">
          <section className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Tour settings
            </h2>
            <p className="text-sm text-[var(--acton-navy)]">
              {isPublic
                ? "Anyone with the link can view this tour."
                : "Only signed-in staff can view this tour."}
            </p>
            <p className="truncate text-xs text-[var(--acton-muted)]">
              {coverId ? "A cover scene is set." : "No cover scene yet."}
            </p>
            <label className="block min-w-0 text-xs font-medium text-[var(--acton-navy)]">
              Transition
              <select
                className="mt-1 w-full max-w-full rounded-md border border-[var(--acton-border)] bg-white px-2 py-2 text-sm text-[var(--acton-navy)]"
                value={transitionEffect}
                onChange={(event) => setTransitionEffect(tourTransitionEffect(event.target.value))}
              >
                <option value="none">None</option>
                <option value="fade">Fade</option>
                <option value="black">Black</option>
                <option value="white">White</option>
              </select>
            </label>
            <label className="block min-w-0 text-xs font-medium text-[var(--acton-navy)]">
              Speed
              <select
                className="mt-1 w-full max-w-full rounded-md border border-[var(--acton-border)] bg-white px-2 py-2 text-sm text-[var(--acton-navy)]"
                value={transitionSpeed}
                onChange={(event) => setTransitionSpeed(tourTransitionSpeed(event.target.value))}
              >
                <option value="fast">Fast</option>
                <option value="normal">Normal</option>
                <option value="slow">Slow</option>
              </select>
            </label>
            <p className="text-xs text-[var(--acton-muted)]">
              This editor always previews Fast. The published tour uses the speed you save.
            </p>
            <label className="flex min-w-0 items-start gap-2 text-sm text-[var(--acton-navy)]">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={transitionDirectional}
                onChange={(event) => setTransitionDirectional(event.target.checked)}
              />
              <span>Move toward the hotspot</span>
            </label>
            <label className="flex min-w-0 items-start gap-2 text-sm text-[var(--acton-navy)]">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={autorotate}
                onChange={(event) => setAutorotate(event.target.checked)}
              />
              <span>Autorotate on the published tour</span>
            </label>
          </section>

          <section className="space-y-2 border-t border-[var(--acton-border)] pt-4">
            <h2 className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Scene
            </h2>
            {active ? (
              <>
                <p className="truncate text-sm font-medium text-[var(--acton-navy)]">
                  {names[active.id] ?? active.name}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void saveOpeningView()}
                >
                  Set current view as the opening view
                </Button>
                {active.hasInitialView ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void clearOpeningView()}
                  >
                    Clear opening view
                  </Button>
                ) : (
                  <p className="text-xs text-[var(--acton-muted)]">
                    This scene opens at the default view.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--acton-muted)]">
                Add a panorama to start this tour.
              </p>
            )}
          </section>

          <div className="border-t border-[var(--acton-border)] pt-4">
            <HotspotPanel
              scene={active}
              scenes={displayScenes}
              selected={selectedHotspot}
              placing={placing}
              busy={busy}
              onStartPlace={() => {
                setSelectedHotspotId(null);
                setPlacing(true);
              }}
              onCancelPlace={() => setPlacing(false)}
              onSelect={setSelectedHotspotId}
              onDraft={draftHotspot}
              onCommit={(hotspot) => void commitHotspot(hotspot)}
              onDelete={(hotspotId) => void removeHotspot(hotspotId)}
            />
          </div>
        </aside>
      </div>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={tour.slug}
        isPublic={isPublic}
        busy={busy}
        onMakePublic={() => void togglePublic(true)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this scene?"
        description="The panorama files are removed first, then the scene. This cannot be undone."
        confirmLabel="Delete scene"
        destructive
        busy={busy}
      />
    </div>
  );
}

type Playback = {
  transitionEffect: TourTransitionEffect;
  transitionSpeed: TourTransitionSpeed;
  transitionDirectional: boolean;
  autorotate: boolean;
};

function playbackOf(tour: ViewerTour): Playback {
  return {
    transitionEffect: tour.transitionEffect,
    transitionSpeed: tour.transitionSpeed,
    transitionDirectional: tour.transitionDirectional,
    autorotate: tour.autorotate,
  };
}

function playbackChanged(current: Playback, saved: Playback): boolean {
  return (
    current.transitionEffect !== saved.transitionEffect ||
    current.transitionSpeed !== saved.transitionSpeed ||
    current.transitionDirectional !== saved.transitionDirectional ||
    current.autorotate !== saved.autorotate
  );
}

function fieldsDirty(
  tour: ViewerTour,
  savedTitle: string,
  savedNames: Record<string, string>,
  title: string,
  names: Record<string, string>,
): boolean {
  if ((title.trim() || "Untitled Tour") !== savedTitle) return true;
  return tour.scenes.some((scene) => {
    const next = (names[scene.id] ?? scene.name).trim() || "Scene";
    const saved = savedNames[scene.id] ?? scene.name;
    return next !== saved;
  });
}

function withSceneEdits(
  scene: ViewerScene,
  draftHotspots: Record<string, ViewerHotspot[]> | null,
  openingOverride: Record<string, { yaw: number; pitch: number } | null>,
): ViewerScene {
  const hotspots = draftHotspots?.[scene.id] ?? scene.hotspots;
  if (!(scene.id in openingOverride)) return { ...scene, hotspots };
  const opening = openingOverride[scene.id];
  if (!opening) {
    return { ...scene, hotspots, hasInitialView: false, initialYaw: 0, initialPitch: 0 };
  }
  return {
    ...scene,
    hotspots,
    hasInitialView: true,
    initialYaw: opening.yaw,
    initialPitch: opening.pitch,
  };
}

function hotspotBody(tourId: string, sceneId: string, hotspot: ViewerHotspot) {
  return {
    tourId,
    sceneId,
    hotspotId: hotspot.id,
    type: hotspot.type,
    yaw: hotspot.yaw,
    pitch: hotspot.pitch,
    label: hotspot.label,
    content: hotspot.content,
    targetSceneId: hotspot.targetSceneId,
    styleShape: hotspot.styleShape,
    styleColor: hotspot.styleColor,
    styleSize: hotspot.styleSize,
    styleRotation: hotspot.styleRotation,
    stylePlacement: hotspot.stylePlacement,
  };
}
