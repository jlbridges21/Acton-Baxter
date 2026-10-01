"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Orbit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createTour, deleteTour, renameTour, setTourPublic } from "@/lib/tours/actions";
import type { TourSummary } from "@/lib/tours/types";

export function ToursDashboard({
  tours,
  loadError,
}: {
  tours: TourSummary[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(loadError);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TourSummary | null>(null);
  const [renaming, setRenaming] = useState<TourSummary | null>(null);
  const [title, setTitle] = useState("");

  async function onCreate() {
    setBusy(true);
    const result = await createTour();
    setBusy(false);
    if (result.error || !result.tourId) {
      setError(result.error || "Could not create the tour.");
      return;
    }
    router.push(`/tours/${result.tourId}`);
  }

  async function onRename() {
    if (!renaming) return;
    setBusy(true);
    const result = await renameTour(renaming.id, title);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRenaming(null);
    router.refresh();
  }

  async function onToggle(tour: TourSummary) {
    setBusy(true);
    const result = await setTourPublic(tour.id, !tour.isPublic);
    setBusy(false);
    setError(result.error);
    if (!result.error) router.refresh();
  }

  async function onDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    const result = await deleteTour(pendingDelete.id);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">Tours</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            360° tours for the team. Public tours stay private in storage and are shared with signed
            links later.
          </p>
        </div>
        <Button type="button" onClick={() => void onCreate()} disabled={busy}>
          New tour
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {tours.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--acton-border)] px-4 py-16 text-center">
          <Orbit className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--acton-navy)]">No tours yet</p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Create a tour, then add panorama scenes.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tours.map((tour) => (
            <li key={tour.id}>
              <Card className="flex h-full flex-col gap-3 p-0">
                {tour.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tour.coverUrl}
                    alt=""
                    className="h-36 w-full rounded-t-lg bg-[var(--acton-gray-50)] object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center rounded-t-lg bg-[var(--acton-gray-50)] text-sm text-[var(--acton-muted)]">
                    No cover yet
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-[var(--acton-navy)]">
                      {tour.title}
                    </h2>
                    <Badge tone={tour.isPublic ? "green" : "gray"}>
                      {tour.isPublic ? "Public" : "Private"}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--acton-muted)]">
                    {tour.sceneCount} {tour.sceneCount === 1 ? "scene" : "scenes"} ·{" "}
                    {format(parseISO(tour.createdAt), "MMM d, yyyy")} · {tour.ownerName}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link
                      href={`/tours/${tour.id}`}
                      className="inline-flex h-8 items-center rounded-md bg-[var(--acton-navy)] px-3 text-xs font-semibold text-white"
                    >
                      Edit
                    </Link>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setTitle(tour.title);
                        setRenaming(tour);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onToggle(tour)}
                    >
                      {tour.isPublic ? "Make private" : "Make public"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => setPendingDelete(tour)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)}>
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename();
          }}
        >
          <DialogTitle>Rename tour</DialogTitle>
          <Input
            aria-label="Tour title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void onDelete()}
        title="Delete this tour?"
        description="Panorama files are removed first, then the tour and its scenes. This cannot be undone."
        confirmLabel="Delete tour"
        destructive
        busy={busy}
      />
    </div>
  );
}
