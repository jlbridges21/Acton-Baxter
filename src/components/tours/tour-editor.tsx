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
  setTourCover,
  setTourPublic,
} from "@/lib/tours/actions";
import { tourSaveLabel, tourSaveState } from "@/lib/tours/save-state";
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
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [draftHotspots, setDraftHotspots] = useState<Record<string, ViewerHotspot[]> | null>(null);
  const [savedHotspots, setSavedHotspots] = useState<Record<string, string>>(() =>
    hotspotSnapshot(tour.scenes),
  );
  const [openingOverride, setOpeningOverride] = useState<
    Record<string, { yaw: number; pitch: number } | null>
  >({});
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const readView = useRef<(() => { yaw: number; pitch: number } | null) | null>(null);
  const scenes = useMemo(
    () => applyOrder(tour.scenes, order).filter((scene) => !removedIds.includes(scene.id)),
    [tour.scenes, order, removedIds],
  );
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
  const viewerTour = useMemo(() => ({ ...tour, scenes: displayScenes }), [tour, displayScenes]);
  const saveState = tourSaveState({
    inFlight,
    failed: saveFailed,
    dirty:
      fieldsDirty(tour, savedTitle, savedNames, title, names) ||
      hotspotListsDirty(scenes, draftHotspots, savedHotspots),
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

  function replaceHotspots(sceneId: string, hotspots: ViewerHotspot[]) {
    setDraftHotspots((current) => ({ ...(current ?? {}), [sceneId]: hotspots }));
  }

  function hotspotsOf(sceneId: string): ViewerHotspot[] {
    return displayScenes.find((scene) => scene.id === sceneId)?.hotspots ?? [];
  }

  async function placeHotspot(position: { yaw: number; pitch: number }) {
    if (!active) return;
    setPlacing(false);
    const hotspot: ViewerHotspot = {
      id: crypto.randomUUID(),
      type: "link",
      yaw: position.yaw,
      pitch: position.pitch,
      label: null,
      content: null,
      targetSceneId: scenes.find((scene) => scene.id !== active.id)?.id ?? null,
      styleShape: "arrow",
      styleColor: "#FFFFFF",
      styleSize: 48,
      styleRotation: 0,
      stylePlacement: "billboard",
    };
    const next = [...hotspotsOf(active.id), hotspot];
    replaceHotspots(active.id, next);
    setSelectedHotspotId(hotspot.id);
    const result = await runSave(() =>
      createHotspot({
        tourId: tour.id,
        sceneId: active.id,
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
      }),
    );
    if (result.error) {
      replaceHotspots(
        active.id,
        next.filter((item) => item.id !== hotspot.id),
      );
      setSelectedHotspotId(null);
      return;
    }
    setSavedHotspots((current) => ({ ...current, [active.id]: JSON.stringify(next) }));
  }

  function draftHotspot(hotspot: ViewerHotspot) {
    if (!active) return;
    replaceHotspots(
      active.id,
      hotspotsOf(active.id).map((item) => (item.id === hotspot.id ? hotspot : item)),
    );
  }

  async function commitHotspot(hotspot: ViewerHotspot) {
    if (!active) return;
    const next = hotspotsOf(active.id).map((item) => (item.id === hotspot.id ? hotspot : item));
    replaceHotspots(active.id, next);
    const result = await runSave(() =>
      saveHotspot({
        tourId: tour.id,
        sceneId: active.id,
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
      }),
    );
    if (!result.error) {
      setSavedHotspots((current) => ({ ...current, [active.id]: JSON.stringify(next) }));
    }
  }

  async function moveHotspot(move: { id: string; yaw: number; pitch: number }) {
    if (!active) return;
    const current = hotspotsOf(active.id).find((item) => item.id === move.id);
    if (!current || (current.yaw === move.yaw && current.pitch === move.pitch)) return;
    await commitHotspot({ ...current, yaw: move.yaw, pitch: move.pitch });
  }

  async function removeHotspot(hotspotId: string) {
    if (!active) return;
    const previous = hotspotsOf(active.id);
    const next = previous.filter((item) => item.id !== hotspotId);
    replaceHotspots(active.id, next);
    if (selectedHotspotId === hotspotId) setSelectedHotspotId(null);
    const result = await runSave(() => deleteHotspot(tour.id, active.id, hotspotId));
    if (result.error) {
      replaceHotspots(active.id, previous);
      return;
    }
    setSavedHotspots((current) => ({ ...current, [active.id]: JSON.stringify(next) }));
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

  async function flushPending() {
    if (saveState === "saving" || saveState === "saved") return;
    await saveTitle();
    for (const scene of scenes) {
      const raw = names[scene.id] ?? scene.name;
      const next = raw.trim() || "Scene";
      if (next !== (savedNames[scene.id] ?? scene.name)) await commitSceneName(scene.id, raw);
    }
    if (selectedHotspot && active) {
      const saved =
        savedHotspots[active.id] ??
        JSON.stringify(tour.scenes.find((scene) => scene.id === active.id)?.hotspots ?? []);
      if (JSON.stringify(hotspotsOf(active.id)) !== saved) await commitHotspot(selectedHotspot);
    }
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
            <PanoramaUploader tourId={tour.id} />
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

function hotspotSnapshot(scenes: ViewerScene[]): Record<string, string> {
  return Object.fromEntries(scenes.map((scene) => [scene.id, JSON.stringify(scene.hotspots)]));
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

function hotspotListsDirty(
  scenes: ViewerScene[],
  draftHotspots: Record<string, ViewerHotspot[]> | null,
  savedHotspots: Record<string, string>,
): boolean {
  if (!draftHotspots) return false;
  return scenes.some((scene) => {
    const draft = draftHotspots[scene.id];
    if (!draft) return false;
    const saved = savedHotspots[scene.id] ?? JSON.stringify(scene.hotspots);
    return JSON.stringify(draft) !== saved;
  });
}
