"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { PanoramaUploader } from "@/components/tours/panorama-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deleteScene,
  moveScene,
  renameScene,
  renameTour,
  setTourPublic,
} from "@/lib/tours/actions";
import { tourSaveLabel, tourSaveState } from "@/lib/tours/save-state";
import type { TourDetail } from "@/lib/tours/types";

function sceneNames(tour: TourDetail): Record<string, string> {
  return Object.fromEntries(tour.scenes.map((scene) => [scene.id, scene.name]));
}

function fieldsDirty(
  tour: TourDetail,
  savedTitle: string,
  savedNames: Record<string, string>,
  title: string,
  names: Record<string, string>,
): boolean {
  const nextTitle = title.trim() || "Untitled Tour";
  if (nextTitle !== savedTitle) return true;
  return tour.scenes.some((scene) => {
    const next = (names[scene.id] ?? scene.name).trim() || "Scene";
    const saved = savedNames[scene.id] ?? scene.name;
    return next !== saved;
  });
}

export function TourEditor({ tour }: { tour: TourDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(tour.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [names, setNames] = useState<Record<string, string>>(() => sceneNames(tour));
  const [savedTitle, setSavedTitle] = useState(tour.title);
  const [savedNames, setSavedNames] = useState<Record<string, string>>(() => sceneNames(tour));
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

  async function togglePublic() {
    setBusy(true);
    await runSave(() => setTourPublic(tour.id, !tour.isPublic));
    setBusy(false);
  }

  async function saveName(sceneId: string) {
    const scene = tour.scenes.find((item) => item.id === sceneId);
    const next = (names[sceneId] ?? "").trim() || "Scene";
    setNames((current) => ({ ...current, [sceneId]: next }));
    if (!scene || next === (savedNames[sceneId] ?? scene.name)) return;
    const result = await runSave(() => renameScene(tour.id, sceneId, next));
    if (!result.error) setSavedNames((current) => ({ ...current, [sceneId]: next }));
  }

  async function reorder(sceneId: string, direction: "up" | "down") {
    setBusy(true);
    await runSave(() => moveScene(tour.id, sceneId, direction));
    setBusy(false);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    const result = await runSave(() => deleteScene(tour.id, pendingDelete));
    setBusy(false);
    if (!result.error) setPendingDelete(null);
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-start justify-between gap-3 bg-[var(--acton-gray-50)]/95 px-1 py-2 backdrop-blur">
        <div className="min-w-0 flex-1 space-y-2">
          <Link
            href="/tours"
            className="text-sm font-medium text-[var(--acton-muted)] hover:underline"
          >
            All tours
          </Link>
          <Input
            aria-label="Tour title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
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
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tour.isPublic ? "green" : "gray"}>
            {tour.isPublic ? "Public" : "Private"}
          </Badge>
          <Link
            href={`/tours/${tour.id}/preview`}
            className="inline-flex h-10 items-center rounded-md border border-[var(--acton-border)] bg-white px-4 text-sm font-semibold text-[var(--acton-navy)]"
          >
            Preview
          </Link>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void togglePublic()}
          >
            {tour.isPublic ? "Make private" : "Make public"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <p className="text-sm text-[var(--acton-muted)]">
        Scenes are stored here. The 360° viewer arrives in a later update.
      </p>

      <PanoramaUploader tourId={tour.id} />

      {tour.scenes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--acton-border)] px-4 py-10 text-center">
          <p className="text-sm font-semibold text-[var(--acton-navy)]">No scenes yet</p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Add a panorama to start this tour.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tour.scenes.map((scene, index) => (
            <li
              key={scene.id}
              className="flex flex-col gap-3 rounded-lg border border-[var(--acton-border)] bg-white p-3 sm:flex-row sm:items-center"
            >
              {scene.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={scene.thumbnailUrl}
                  alt=""
                  className="h-20 w-40 rounded-md bg-[var(--acton-gray-50)] object-cover"
                />
              ) : (
                <div className="flex h-20 w-40 items-center justify-center rounded-md bg-[var(--acton-gray-50)] text-xs text-[var(--acton-muted)]">
                  No thumbnail
                </div>
              )}
              <Input
                aria-label={`Scene name ${index + 1}`}
                value={names[scene.id] ?? scene.name}
                onChange={(event) =>
                  setNames((current) => ({ ...current, [scene.id]: event.target.value }))
                }
                onBlur={() => void saveName(scene.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Move ${scene.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => void reorder(scene.id, "up")}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Move ${scene.name} down`}
                  disabled={busy || index === tour.scenes.length - 1}
                  onClick={() => void reorder(scene.id, "down")}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Delete ${scene.name}`}
                  disabled={busy}
                  onClick={() => setPendingDelete(scene.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
