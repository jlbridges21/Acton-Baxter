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
import type { TourDetail } from "@/lib/tours/types";

export function TourEditor({ tour }: { tour: TourDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(tour.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(tour.scenes.map((scene) => [scene.id, scene.name])),
  );

  async function saveTitle() {
    const next = title.trim() || "Untitled Tour";
    setTitle(next);
    if (next === tour.title) return;
    const result = await renameTour(tour.id, next);
    setError(result.error);
    if (!result.error) router.refresh();
  }

  async function togglePublic() {
    setBusy(true);
    const result = await setTourPublic(tour.id, !tour.isPublic);
    setBusy(false);
    setError(result.error);
    if (!result.error) router.refresh();
  }

  async function saveName(sceneId: string) {
    const scene = tour.scenes.find((item) => item.id === sceneId);
    const next = (names[sceneId] ?? "").trim() || "Scene";
    setNames((current) => ({ ...current, [sceneId]: next }));
    if (!scene || next === scene.name) return;
    const result = await renameScene(tour.id, sceneId, next);
    setError(result.error);
    if (!result.error) router.refresh();
  }

  async function reorder(sceneId: string, direction: "up" | "down") {
    setBusy(true);
    const result = await moveScene(tour.id, sceneId, direction);
    setBusy(false);
    setError(result.error);
    if (!result.error) router.refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    const result = await deleteScene(tour.id, pendingDelete);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
