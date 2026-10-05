"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { arrivalHeadingNote } from "@/lib/tours/arrival-heading";
import { hotspotListRow, isBrokenLink } from "@/lib/tours/hotspot-markers";
import {
  HOTSPOT_SHAPES,
  hotspotPlacement,
  hotspotShape,
  shapeUsesRotation,
  type HotspotShape,
} from "@/lib/tours/hotspot-shapes";
import type { ViewerHotspot, ViewerScene } from "@/lib/tours/viewer-model";

const fieldClass =
  "mt-1 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm text-[var(--acton-navy)]";

export function HotspotPanel({
  scene,
  scenes,
  selected,
  placing,
  busy,
  onStartPlace,
  onCancelPlace,
  onSelect,
  onDraft,
  onCommit,
  onDelete,
}: {
  scene: ViewerScene | null;
  scenes: ViewerScene[];
  selected: ViewerHotspot | null;
  placing: boolean;
  busy: boolean;
  onStartPlace: () => void;
  onCancelPlace: () => void;
  onSelect: (hotspotId: string | null) => void;
  onDraft: (hotspot: ViewerHotspot) => void;
  onCommit: (hotspot: ViewerHotspot) => void;
  onDelete: (hotspotId: string) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const sceneIds = new Set(scenes.map((item) => item.id));
  const others = scenes.filter((item) => item.id !== scene?.id);
  const hotspots = scene?.hotspots ?? [];
  const arrivalNote =
    scene && selected?.type === "link" && selected.targetSceneId
      ? arrivalHeadingNote({
          sourceSceneId: scene.id,
          target: scenes.find((item) => item.id === selected.targetSceneId) ?? null,
        })
      : null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        Hotspots
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!scene || busy || placing} onClick={onStartPlace}>
          Add hotspot
        </Button>
        {placing ? (
          <Button type="button" variant="secondary" onClick={onCancelPlace}>
            Cancel placement
          </Button>
        ) : null}
      </div>
      {placing ? (
        <p className="text-sm text-[var(--acton-navy)]">
          Click the panorama to place the hotspot. Press Escape to cancel.
        </p>
      ) : null}
      {hotspots.length ? (
        <ul className="space-y-1">
          {hotspots.map((hotspot) => {
            const row = hotspotListRow(hotspot, scenes);
            const active = hotspot.id === selected?.id;
            const typeLabel = row.broken ? "Broken link" : row.kind;
            return (
              <li key={hotspot.id} className="min-w-0">
                <button
                  type="button"
                  title={row.primary}
                  aria-label={
                    row.primary === typeLabel ? row.primary : `${row.primary}, ${typeLabel}`
                  }
                  className={`flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md border px-2 py-1.5 text-left text-sm ${
                    active
                      ? "border-[var(--acton-navy)] bg-[var(--acton-gray-50)]"
                      : "border-[var(--acton-border)] bg-white"
                  }`}
                  onClick={() => onSelect(hotspot.id)}
                >
                  <span
                    className={`min-w-0 flex-1 truncate font-medium ${
                      row.broken && !row.muted
                        ? "text-red-700"
                        : row.muted
                          ? "text-[var(--acton-muted)]"
                          : "text-[var(--acton-navy)]"
                    }`}
                  >
                    {row.primary}
                  </span>
                  <span
                    className={`shrink-0 text-xs whitespace-nowrap ${
                      row.broken ? "font-semibold text-red-700" : "text-[var(--acton-muted)]"
                    }`}
                  >
                    {typeLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-[var(--acton-muted)]">This scene has no hotspots yet.</p>
      )}
      {selected ? (
        <div className="space-y-3 rounded-md border border-[var(--acton-border)] bg-white p-3">
          <label className="block text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Type</span>
            <select
              className={fieldClass}
              value={selected.type}
              onChange={(event) => {
                const type = event.target.value === "info" ? "info" : "link";
                const next = {
                  ...selected,
                  type,
                  targetSceneId: type === "info" ? null : selected.targetSceneId,
                } as ViewerHotspot;
                onDraft(next);
                onCommit(next);
              }}
            >
              <option value="link">Link</option>
              <option value="info">Info</option>
            </select>
          </label>
          {selected.type === "link" ? (
            others.length === 0 ? (
              <p className="text-sm text-[var(--acton-navy)]">
                Add another scene before this hotspot can link anywhere.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-[var(--acton-navy)]">
                  {isBrokenLink(selected, sceneIds)
                    ? "Broken link — choose a scene"
                    : "Target scene"}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {others.map((target) => {
                    const active = target.id === selected.targetSceneId;
                    return (
                      <button
                        key={target.id}
                        type="button"
                        className={`min-w-0 overflow-hidden rounded-md border-2 text-left ${
                          active ? "border-[var(--acton-navy)]" : "border-[var(--acton-border)]"
                        }`}
                        onClick={() => {
                          const next = { ...selected, targetSceneId: target.id };
                          onDraft(next);
                          onCommit(next);
                        }}
                      >
                        {target.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={target.thumbUrl} alt="" className="h-12 w-full object-cover" />
                        ) : (
                          <div className="flex h-12 items-center justify-center bg-[var(--acton-gray-50)] text-[10px] text-[var(--acton-muted)]">
                            No thumbnail
                          </div>
                        )}
                        <span className="block truncate px-1 py-0.5 text-[10px] font-medium text-[var(--acton-navy)]">
                          {target.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {arrivalNote ? (
                  <p className="text-sm text-[var(--acton-navy)]">{arrivalNote}</p>
                ) : null}
              </fieldset>
            )
          ) : (
            <>
              <label className="block text-sm">
                <span className="font-medium text-[var(--acton-navy)]">Label</span>
                <Input
                  className="mt-1"
                  aria-label="Hotspot label"
                  value={selected.label ?? ""}
                  onChange={(event) => onDraft({ ...selected, label: event.target.value })}
                  onBlur={() => onCommit({ ...selected, label: selected.label?.trim() || null })}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-[var(--acton-navy)]">Content</span>
                <textarea
                  aria-label="Hotspot content"
                  rows={3}
                  className={fieldClass}
                  value={selected.content ?? ""}
                  onChange={(event) => onDraft({ ...selected, content: event.target.value })}
                  onBlur={() =>
                    onCommit({ ...selected, content: selected.content?.trim() || null })
                  }
                />
              </label>
            </>
          )}
          <label className="block text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Shape</span>
            <select
              className={fieldClass}
              value={selected.styleShape}
              onChange={(event) => {
                const styleShape = hotspotShape(event.target.value);
                const next = { ...selected, styleShape };
                onDraft(next);
                onCommit(next);
              }}
            >
              {HOTSPOT_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {shapeLabel(shape)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Placement</span>
            <select
              className={fieldClass}
              aria-label="Hotspot placement"
              value={selected.stylePlacement}
              onChange={(event) => {
                const stylePlacement = hotspotPlacement(event.target.value);
                const next = { ...selected, stylePlacement };
                onDraft(next);
                onCommit(next);
              }}
            >
              <option value="billboard">Billboard — faces the camera</option>
              <option value="floor">Floor — lies on the ground</option>
            </select>
          </label>
          {shapeUsesRotation(selected.styleShape) ? (
            <label className="block text-sm">
              <span className="font-medium text-[var(--acton-navy)]">Rotation</span>
              <input
                aria-label="Hotspot rotation"
                type="range"
                min={0}
                max={359}
                className="mt-2 w-full"
                value={selected.styleRotation}
                onChange={(event) =>
                  onDraft({ ...selected, styleRotation: Number(event.target.value) })
                }
                onMouseUp={(event) =>
                  onCommit({ ...selected, styleRotation: Number(event.currentTarget.value) })
                }
                onKeyUp={(event) =>
                  onCommit({ ...selected, styleRotation: Number(event.currentTarget.value) })
                }
              />
              <span className="text-xs text-[var(--acton-muted)]">{selected.styleRotation}°</span>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Color</span>
            <input
              aria-label="Hotspot color"
              type="color"
              className="mt-1 h-10 w-full max-w-full"
              value={
                /^#[0-9A-Fa-f]{6}$/.test(selected.styleColor) ? selected.styleColor : "#ffffff"
              }
              onChange={(event) => {
                const next = { ...selected, styleColor: event.target.value.toUpperCase() };
                onDraft(next);
                onCommit(next);
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-[var(--acton-navy)]">Size</span>
            <input
              aria-label="Hotspot size"
              type="range"
              min={16}
              max={128}
              className="mt-2 w-full"
              value={selected.styleSize}
              onChange={(event) => onDraft({ ...selected, styleSize: Number(event.target.value) })}
              onMouseUp={(event) =>
                onCommit({ ...selected, styleSize: Number(event.currentTarget.value) })
              }
              onKeyUp={(event) =>
                onCommit({ ...selected, styleSize: Number(event.currentTarget.value) })
              }
            />
            <span className="text-xs text-[var(--acton-muted)]">{selected.styleSize}px</span>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setPendingDelete(true)}
          >
            Delete hotspot
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingDelete}
        onClose={() => setPendingDelete(false)}
        onConfirm={() => {
          if (!selected) return;
          onDelete(selected.id);
          setPendingDelete(false);
        }}
        title="Delete this hotspot?"
        description="The hotspot is removed from this scene. This cannot be undone."
        confirmLabel="Delete hotspot"
        destructive
        busy={busy}
      />
    </section>
  );
}

function shapeLabel(shape: HotspotShape): string {
  switch (shape) {
    case "chevron":
      return "Chevron";
    case "circle":
      return "Circle";
    case "ring":
      return "Ring";
    case "dot":
      return "Dot";
    case "pulse":
      return "Pulse";
    default:
      return "Arrow";
  }
}
