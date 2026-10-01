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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ViewerScene } from "@/lib/tours/viewer-model";

export function SceneStrip({
  scenes,
  activeId,
  onSelect,
  onReorder,
}: {
  scenes: ViewerScene[];
  activeId: string;
  onSelect: (sceneId: string) => void;
  onReorder: (sceneIds: string[]) => void;
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

  if (!scenes.length) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Scenes">
          {scenes.map((scene) => (
            <SceneThumb
              key={scene.id}
              scene={scene}
              active={scene.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SceneThumb({
  scene,
  active,
  onSelect,
}: {
  scene: ViewerScene;
  active: boolean;
  onSelect: (sceneId: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`w-28 shrink-0 ${isDragging ? "opacity-70" : ""}`}
    >
      <button
        ref={ref}
        type="button"
        aria-current={active ? "true" : undefined}
        aria-label={`${scene.name}. Drag to reorder, or use the arrow keys.`}
        className={`w-full overflow-hidden rounded-md border-2 bg-white text-left ${
          active ? "border-[var(--acton-navy)]" : "border-[var(--acton-border)]"
        }`}
        onClick={() => onSelect(scene.id)}
        {...attributes}
        {...listeners}
      >
        {scene.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.thumbUrl} alt="" className="h-14 w-full object-cover" />
        ) : (
          <div className="flex h-14 items-center justify-center bg-[var(--acton-gray-50)] text-[10px] text-[var(--acton-muted)]">
            No thumbnail
          </div>
        )}
        <span className="block truncate px-1 py-0.5 text-[10px] font-medium text-[var(--acton-navy)]">
          {scene.name}
        </span>
      </button>
    </div>
  );
}
