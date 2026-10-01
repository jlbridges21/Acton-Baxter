"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PanoramaUploader } from "@/components/tours/panorama-uploader";
import { SceneStrip } from "@/components/tours/scene-strip";
import { ShareDialog } from "@/components/tours/share-dialog";
import { TourStage } from "@/components/tours/tour-stage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deleteScene,
  renameScene,
  renameTour,
  reorderScenes,
  setTourCover,
  setTourPublic,
} from "@/lib/tours/actions";
import { tourSaveLabel, tourSaveState } from "@/lib/tours/save-state";
import type { ViewerScene, ViewerTour } from "@/lib/tours/viewer-model";

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
  const router = useRouter();
  const [title, setTitle] = useState(tour.title);
  const [savedTitle, setSavedTitle] = useState(tour.title);
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
  const scenes = useMemo(() => applyOrder(tour.scenes, order), [tour.scenes, order]);
  const activeId = scenes.some((scene) => scene.id === pickedId)
    ? (pickedId ?? "")
    : (scenes[0]?.id ?? "");
  const active = scenes.find((scene) => scene.id === activeId) ?? null;
  const viewerTour = useMemo(() => ({ ...tour, scenes }), [tour, scenes]);
  const saveState = tourSaveState({
    inFlight,
    failed: saveFailed,
    dirty: fieldsDirty(tour, savedTitle, savedNames, title, names),
  });

  async function runSave(work: () => Promise<{ error: string | null }>) {
    setInFlight((count) => count + 1);
    setSaveFailed(false);
    try {
      const result = await work();
      setError(result.error);
      if (result.error) setSaveFailed(true);
      else router.refresh();
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

  async function saveName() {
    if (!active) return;
    const next = (names[active.id] ?? active.name).trim() || "Scene";
    setNames((current) => ({ ...current, [active.id]: next }));
    if (next === (savedNames[active.id] ?? active.name)) return;
    const result = await runSave(() => renameScene(tour.id, active.id, next));
    if (!result.error) setSavedNames((current) => ({ ...current, [active.id]: next }));
  }

  async function togglePublic(next: boolean) {
    setBusy(true);
    await runSave(() => setTourPublic(tour.id, next));
    setBusy(false);
  }

  async function makeCover() {
    if (!active || active.id === tour.coverSceneId) return;
    setBusy(true);
    await runSave(() => setTourCover(tour.id, active.id));
    setBusy(false);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const index = scenes.findIndex((scene) => scene.id === pendingDelete);
    const neighbor = scenes[index + 1]?.id ?? scenes[index - 1]?.id ?? null;
    setBusy(true);
    const result = await runSave(() => deleteScene(tour.id, pendingDelete));
    setBusy(false);
    if (result.error) return;
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

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7rem)] lg:min-h-[560px]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/tours"
            className="text-sm font-medium text-[var(--acton-muted)] hover:underline"
          >
            All tours
          </Link>
          <h1 className="truncate text-lg font-bold text-[var(--acton-navy)]">
            {title.trim() || "Untitled Tour"}
          </h1>
        </div>
        <p
          className={`shrink-0 text-xs ${
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
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-[420px] min-w-0 flex-1 flex-col gap-3 lg:min-h-0">
          <div className="relative h-[55dvh] min-h-[320px] overflow-hidden rounded-lg border border-[var(--acton-border)] lg:h-auto lg:flex-1">
            <TourStage
              tour={viewerTour}
              chrome={FRAME_CHROME}
              layout="frame"
              sceneId={activeId}
              onSceneChange={setPickedId}
            />
          </div>
          <SceneStrip
            scenes={scenes.map((scene) => ({
              ...scene,
              name: names[scene.id] ?? scene.name,
            }))}
            activeId={activeId}
            onSelect={setPickedId}
            onReorder={(ids) => void onReorder(ids)}
          />
        </div>

        <aside className="w-full shrink-0 space-y-6 lg:w-80 lg:overflow-y-auto lg:pr-1">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Tour
            </h2>
            <Input
              aria-label="Tour title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tour.isPublic ? "green" : "gray"}>
                {tour.isPublic ? "Public" : "Private"}
              </Badge>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void togglePublic(!tour.isPublic)}
              >
                {tour.isPublic ? "Make private" : "Make public"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShareOpen(true)}>
                Share
              </Button>
              <Link
                href={`/tours/${tour.id}/preview`}
                className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
              >
                Preview
              </Link>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Scene
            </h2>
            {active ? (
              <>
                <Input
                  aria-label="Scene name"
                  value={names[active.id] ?? active.name}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [active.id]: event.target.value }))
                  }
                  onBlur={() => void saveName()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || active.id === tour.coverSceneId}
                    onClick={() => void makeCover()}
                  >
                    {active.id === tour.coverSceneId ? "Cover scene" : "Set as cover"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setPendingDelete(active.id)}
                  >
                    Delete scene
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--acton-muted)]">
                Add a panorama to start this tour.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
              Hotspots
            </h2>
            <p className="text-sm text-[var(--acton-muted)]">
              Hotspot tools will sit in this section.
            </p>
          </section>

          <PanoramaUploader tourId={tour.id} />
        </aside>
      </div>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        slug={tour.slug}
        isPublic={tour.isPublic}
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
