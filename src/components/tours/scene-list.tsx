"use client";

import { useEffect, useRef } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ViewerScene } from "@/lib/tours/viewer-model";

export function SceneList({
  scenes,
  names,
  activeId,
  coverSceneId,
  busy,
  onSelect,
  onReorder,
  onNameChange,
  onNameCommit,
  onCover,
  onDelete,
}: {
  scenes: ViewerScene[];
  names: Record<string, string>;
  activeId: string;
  coverSceneId: string | null;
  busy: boolean;
  onSelect: (sceneId: string) => void;
  onReorder: (sceneIds: string[]) => void;
  onNameChange: (sceneId: string, name: string) => void;
  onNameCommit: (sceneId: string, name: string) => void;
  onCover: (sceneId: string) => void;
  onDelete: (sceneId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = scenes.map((scene) => scene.id);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  if (!scenes.length) {
    return <p className="px-3 py-4 text-sm text-[var(--acton-muted)]">No scenes yet.</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1" aria-label="Scenes">
          {scenes.map((scene) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              name={names[scene.id] ?? scene.name}
              active={scene.id === activeId}
              cover={scene.id === coverSceneId}
              busy={busy}
              onSelect={onSelect}
              onNameChange={onNameChange}
              onNameCommit={onNameCommit}
              onCover={onCover}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SceneRow({
  scene,
  name,
  active,
  cover,
  busy,
  onSelect,
  onNameChange,
  onNameCommit,
  onCover,
  onDelete,
}: {
  scene: ViewerScene;
  name: string;
  active: boolean;
  cover: boolean;
  busy: boolean;
  onSelect: (sceneId: string) => void;
  onNameChange: (sceneId: string, name: string) => void;
  onNameCommit: (sceneId: string, name: string) => void;
  onCover: (sceneId: string) => void;
  onDelete: (sceneId: string) => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li
      ref={(node) => {
        ref.current = node;
        setNodeRef(node);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border bg-white ${
        active ? "border-[var(--acton-navy)]" : "border-[var(--acton-border)]"
      } ${isDragging ? "opacity-70" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1 p-1">
        <button
          type="button"
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
          aria-label={`${name}. Drag to reorder, or use the arrow keys.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shrink-0 overflow-hidden rounded"
          aria-current={active ? "true" : undefined}
          aria-label={`Show ${name}`}
          onClick={() => onSelect(scene.id)}
        >
          {scene.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.thumbUrl} alt="" className="h-10 w-14 object-cover" />
          ) : (
            <span className="flex h-10 w-14 items-center justify-center bg-[var(--acton-gray-50)] text-[9px] text-[var(--acton-muted)]">
              No image
            </span>
          )}
        </button>
        <input
          aria-label={`Scene name for ${scene.name}`}
          value={name}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-sm font-medium text-[var(--acton-navy)] outline-none focus:bg-[var(--acton-gray-50)]"
          onChange={(event) => onNameChange(scene.id, event.target.value)}
          onBlur={(event) => onNameCommit(scene.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
      <div className="flex gap-1 px-1 pb-1">
        <button
          type="button"
          disabled={busy || cover}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] disabled:opacity-60"
          onClick={() => onCover(scene.id)}
        >
          {cover ? "Cover" : "Set cover"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50"
          onClick={() => onDelete(scene.id)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
