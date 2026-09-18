"use client";

/**
 * Site inspection template editor — compact rows, modal editing, drag-and-drop.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TemplateItemModal,
  emptyItemDraft,
  itemToDraft,
  type ItemDraft,
} from "@/components/inspections/template-item-modal";
import { persistItemDraft } from "@/components/inspections/template-item-save";
import type {
  InspectionTemplateDetail,
  InspectionTemplateItem,
  InspectionTemplateSection,
} from "@/lib/inspections/types";

async function postAction(body: Record<string, unknown>) {
  const res = await fetch("/api/inspections/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    template?: InspectionTemplateDetail;
  };
  if (!res.ok || !json.template) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.template;
}

function MoveButtons({
  disabled,
  onUp,
  onDown,
}: {
  disabled?: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onUp}
        aria-label="Move up"
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onDown}
        aria-label="Move down"
      >
        ↓
      </Button>
    </div>
  );
}

function itemSummary(item: InspectionTemplateItem): string {
  const parts = ["Checkbox"];
  if (item.allowsMedia) parts.push("Media");
  if (item.allowsNotes) parts.push("Notes");
  const n = item.subQuestions.length;
  if (n) parts.push(`${n} sub-question${n === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function containerId(sectionId: string | null) {
  return sectionId === null ? "standalone" : `section:${sectionId}`;
}

function parseContainer(id: UniqueIdentifier): string | null | undefined {
  const s = String(id);
  if (s === "standalone") return null;
  if (s.startsWith("section:")) return s.slice("section:".length);
  return undefined;
}

function findItemContainer(
  template: InspectionTemplateDetail,
  itemId: string,
): string | null | undefined {
  if (template.standaloneItems.some((i) => i.id === itemId)) return null;
  for (const section of template.sections) {
    if (section.items.some((i) => i.id === itemId)) return section.id;
  }
  return undefined;
}

export function TemplateEditorClient({
  initialTemplate,
  isAdmin,
}: {
  initialTemplate: InspectionTemplateDetail;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialTemplate.sections.map((s) => [s.id, true])),
  );
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false);

  const [sectionModal, setSectionModal] = useState<{
    mode: "add" | "edit";
    sectionId: string | null;
    title: string;
  } | null>(null);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [itemModal, setItemModal] = useState<ItemDraft | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: Record<string, unknown>;
  } | null>(null);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [dragFromContainer, setDragFromContainer] = useState<string | null | undefined>(undefined);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function run(body: Record<string, unknown>) {
    if (!isAdmin) return template;
    setBusy(true);
    setError(null);
    try {
      const next = await postAction(body);
      setTemplate(next);
      setOpenSections((prev) => {
        const merged = { ...prev };
        for (const s of next.sections) {
          if (merged[s.id] === undefined) merged[s.id] = true;
        }
        return merged;
      });
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDelete() {
    if (!isAdmin || !template.archivedAt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inspections/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_template", templateId: template.id }),
      });
      const json = (await res.json()) as {
        deleted?: boolean;
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        const message =
          typeof json.error === "string"
            ? json.error
            : (json.error?.message ?? "Could not delete template");
        throw new Error(message);
      }
      setConfirmPermanentDelete(false);
      router.push("/inspections/templates");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete template");
      setBusy(false);
    }
  }

  function moveInList(ids: string[], index: number, dir: -1 | 1): string[] | null {
    const target = index + dir;
    if (target < 0 || target >= ids.length) return null;
    const next = [...ids];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    return next;
  }

  const coverConflictTitle = useMemo(() => {
    if (!itemModal?.isCoverPhotoSource) return null;
    const all = [...template.standaloneItems, ...template.sections.flatMap((s) => s.items)];
    const other = all.find((i) => i.isCoverPhotoSource && i.id !== itemModal.serverId);
    return other?.title ?? null;
  }, [itemModal, template]);

  async function saveItemDraft(draft: ItemDraft) {
    setBusy(true);
    setError(null);
    try {
      const latest = await persistItemDraft(postAction, template, draft);
      setTemplate(latest);
      setItemModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save item");
    } finally {
      setBusy(false);
    }
  }

  function itemsInContainer(sectionId: string | null): InspectionTemplateItem[] {
    if (sectionId === null) return template.standaloneItems;
    return template.sections.find((s) => s.id === sectionId)?.items ?? [];
  }

  async function persistItemOrder(
    itemId: string,
    fromSectionId: string | null | undefined,
    toSectionId: string | null,
    orderedIds: string[],
  ) {
    if (fromSectionId === toSectionId) {
      await run({
        action: "reorder_items",
        templateId: template.id,
        sectionId: toSectionId,
        orderedIds,
      });
    } else {
      await run({
        action: "move_item",
        itemId,
        targetSectionId: toSectionId,
        orderedIds,
      });
    }
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("section-drag:")) {
      setActiveSectionId(id.slice("section-drag:".length));
      setActiveItemId(null);
      setDragFromContainer(undefined);
    } else if (id.startsWith("item:")) {
      const itemId = id.slice("item:".length);
      setActiveItemId(itemId);
      setActiveSectionId(null);
      setDragFromContainer(findItemContainer(template, itemId));
    }
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !isAdmin) return;
    const activeId = String(active.id);
    if (!activeId.startsWith("item:")) return;
    const itemId = activeId.slice("item:".length);

    const overId = String(over.id);
    let overContainer: string | null | undefined;
    if (overId === "standalone" || overId.startsWith("section:")) {
      overContainer = parseContainer(overId);
    } else if (overId.startsWith("item:")) {
      overContainer = findItemContainer(template, overId.slice("item:".length));
    } else {
      return;
    }
    if (overContainer === undefined) return;

    const fromContainer = findItemContainer(template, itemId);
    if (fromContainer === undefined || fromContainer === overContainer) return;

    // Optimistic local move between containers while dragging
    setTemplate((prev) => {
      const fromItems =
        fromContainer === null
          ? [...prev.standaloneItems]
          : [...(prev.sections.find((s) => s.id === fromContainer)?.items ?? [])];
      const itemIndex = fromItems.findIndex((i) => i.id === itemId);
      if (itemIndex < 0) return prev;
      const [moved] = fromItems.splice(itemIndex, 1);
      if (!moved) return prev;
      const movedItem = { ...moved, sectionId: overContainer };

      const toItems =
        overContainer === null
          ? [...prev.standaloneItems.filter((i) => i.id !== itemId)]
          : [
              ...(prev.sections.find((s) => s.id === overContainer)?.items ?? []).filter(
                (i) => i.id !== itemId,
              ),
            ];

      let insertAt = toItems.length;
      if (overId.startsWith("item:")) {
        const overItemId = overId.slice("item:".length);
        const idx = toItems.findIndex((i) => i.id === overItemId);
        if (idx >= 0) insertAt = idx;
      }
      toItems.splice(insertAt, 0, movedItem);

      return {
        ...prev,
        standaloneItems:
          overContainer === null
            ? toItems
            : fromContainer === null
              ? fromItems
              : prev.standaloneItems,
        sections: prev.sections.map((s) => {
          if (s.id === fromContainer) return { ...s, items: fromItems };
          if (s.id === overContainer) return { ...s, items: toItems };
          return s;
        }),
      };
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const fromAtStart = dragFromContainer;
    setActiveItemId(null);
    setActiveSectionId(null);
    setDragFromContainer(undefined);
    if (!over || !isAdmin) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("section-drag:")) {
      const sectionId = activeId.slice("section-drag:".length);
      const overSectionId = overId.startsWith("section-drag:")
        ? overId.slice("section-drag:".length)
        : overId.startsWith("section:")
          ? overId.slice("section:".length)
          : null;
      if (!overSectionId || sectionId === overSectionId) return;
      const ids = template.sections.map((s) => s.id);
      const oldIndex = ids.indexOf(sectionId);
      const newIndex = ids.indexOf(overSectionId);
      if (oldIndex < 0 || newIndex < 0) return;
      const orderedIds = arrayMove(ids, oldIndex, newIndex);
      await run({
        action: "reorder_sections",
        templateId: template.id,
        orderedIds,
      });
      return;
    }

    if (!activeId.startsWith("item:")) return;
    const itemId = activeId.slice("item:".length);
    const toContainer =
      overId === "standalone" || overId.startsWith("section:")
        ? parseContainer(overId)
        : overId.startsWith("item:")
          ? findItemContainer(template, overId.slice("item:".length))
          : findItemContainer(template, itemId);
    if (toContainer === undefined) return;

    const items = itemsInContainer(toContainer);
    let orderedIds = items.map((i) => i.id);
    if (!orderedIds.includes(itemId)) orderedIds = [...orderedIds, itemId];
    if (overId.startsWith("item:")) {
      const overItemId = overId.slice("item:".length);
      const oldIndex = orderedIds.indexOf(itemId);
      const newIndex = orderedIds.indexOf(overItemId);
      if (oldIndex >= 0 && newIndex >= 0) {
        orderedIds = arrayMove(orderedIds, oldIndex, newIndex);
      }
    }

    await persistItemOrder(itemId, fromAtStart, toContainer, orderedIds);
  }

  const sectionIds = template.sections.map((s) => `section-drag:${s.id}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/inspections/templates"
          className="text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          ← Templates
        </Link>
        {template.archivedAt ? (
          <span className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Archived
          </span>
        ) : null}
        {isAdmin && template.archivedAt ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={() => setConfirmPermanentDelete(true)}
          >
            Delete permanently
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm">
        {isAdmin ? (
          <div className="space-y-3">
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
                htmlFor="tpl-name"
              >
                Template name
              </label>
              <Input
                id="tpl-name"
                defaultValue={template.name}
                key={`name-${template.id}-${template.updatedAt}`}
                className="min-h-11"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== template.name) {
                    void run({ action: "update_meta", templateId: template.id, name });
                  }
                }}
              />
            </div>
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
                htmlFor="tpl-desc"
              >
                Description
              </label>
              <Input
                id="tpl-desc"
                defaultValue={template.description ?? ""}
                key={`desc-${template.id}-${template.updatedAt}`}
                className="min-h-11"
                onBlur={(e) => {
                  const description = e.target.value.trim() || null;
                  if (description !== template.description) {
                    void run({
                      action: "update_meta",
                      templateId: template.id,
                      description,
                    });
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-[var(--acton-navy)]">{template.name}</h2>
            {template.description ? (
              <p className="mt-1 text-sm text-[var(--acton-muted)]">{template.description}</p>
            ) : null}
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={(e) => void onDragEnd(e)}
      >
        <ItemList
          title="Standalone items"
          containerKey="standalone"
          sectionId={null}
          items={template.standaloneItems}
          isAdmin={isAdmin}
          busy={busy}
          onAdd={() => setItemModal(emptyItemDraft(null))}
          onEdit={(item) => setItemModal(itemToDraft(item))}
          onDelete={(item) =>
            setConfirm({
              title: "Delete item?",
              description: `Delete “${item.title}”? Sub-questions and options on this item will be removed.`,
              action: { action: "delete_item", itemId: item.id },
            })
          }
          onMove={(index, dir) => {
            const next = moveInList(
              template.standaloneItems.map((i) => i.id),
              index,
              dir,
            );
            if (next) {
              void run({
                action: "reorder_items",
                templateId: template.id,
                sectionId: null,
                orderedIds: next,
              });
            }
          }}
        />

        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          {template.sections.map((section, sectionIndex) => (
            <SortableSection
              key={section.id}
              section={section}
              open={openSections[section.id] !== false}
              onToggle={() =>
                setOpenSections((prev) => ({
                  ...prev,
                  [section.id]: !(prev[section.id] !== false),
                }))
              }
              isAdmin={isAdmin}
              busy={busy}
              onEdit={() => {
                setSectionModal({ mode: "edit", sectionId: section.id, title: section.title });
                setSectionTitle(section.title);
                setSectionError(null);
              }}
              onDelete={() =>
                setConfirm({
                  title: "Delete section?",
                  description: `Delete section “${section.title}” and its ${section.items.length} item${section.items.length === 1 ? "" : "s"}? This cannot be undone.`,
                  action: { action: "delete_section", sectionId: section.id },
                })
              }
              onMoveSection={(dir) => {
                const next = moveInList(
                  template.sections.map((s) => s.id),
                  sectionIndex,
                  dir,
                );
                if (next) {
                  void run({
                    action: "reorder_sections",
                    templateId: template.id,
                    orderedIds: next,
                  });
                }
              }}
              onAddItem={() => setItemModal(emptyItemDraft(section.id))}
              onEditItem={(item) => setItemModal(itemToDraft(item))}
              onDeleteItem={(item) =>
                setConfirm({
                  title: "Delete item?",
                  description: `Delete “${item.title}”? Sub-questions and options on this item will be removed.`,
                  action: { action: "delete_item", itemId: item.id },
                })
              }
              onMoveItem={(index, dir) => {
                const next = moveInList(
                  section.items.map((i) => i.id),
                  index,
                  dir,
                );
                if (next) {
                  void run({
                    action: "reorder_items",
                    templateId: template.id,
                    sectionId: section.id,
                    orderedIds: next,
                  });
                }
              }}
            />
          ))}
        </SortableContext>

        <DragOverlay>
          {activeItemId ? (
            <div className="rounded-lg border border-[var(--acton-navy)] bg-white px-3 py-2 text-sm shadow-lg">
              {itemsInContainer(findItemContainer(template, activeItemId) ?? null).find(
                (i) => i.id === activeItemId,
              )?.title ?? "Item"}
            </div>
          ) : null}
          {activeSectionId ? (
            <div className="rounded-lg border border-[var(--acton-navy)] bg-white px-3 py-2 text-sm font-semibold shadow-lg">
              {template.sections.find((s) => s.id === activeSectionId)?.title ?? "Section"}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {isAdmin ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy}
          onClick={() => {
            setSectionModal({ mode: "add", sectionId: null, title: "" });
            setSectionTitle("");
            setSectionError(null);
          }}
        >
          + Add section
        </Button>
      ) : null}

      <Dialog open={Boolean(sectionModal)} onClose={() => setSectionModal(null)} size="md">
        <DialogHeader>
          <DialogTitle>
            {sectionModal?.mode === "edit" ? "Edit section" : "Add section"}
          </DialogTitle>
          <DialogDescription>Sections group related checklist items.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
            htmlFor="sec-title"
          >
            Section title
          </label>
          <Input
            id="sec-title"
            className="min-h-11"
            value={sectionTitle}
            onChange={(e) => setSectionTitle(e.target.value)}
            aria-invalid={Boolean(sectionError)}
          />
          {sectionError ? <p className="mt-1 text-sm text-red-700">{sectionError}</p> : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton />
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              const title = sectionTitle.trim();
              if (!title) {
                setSectionError("Title is required");
                return;
              }
              if (sectionModal?.mode === "edit" && sectionModal.sectionId) {
                void run({
                  action: "update_section",
                  sectionId: sectionModal.sectionId,
                  title,
                }).then(() => setSectionModal(null));
              } else {
                void run({
                  action: "add_section",
                  templateId: template.id,
                  title,
                }).then(() => setSectionModal(null));
              }
            }}
          >
            {busy ? "Saving…" : "Save section"}
          </Button>
        </DialogFooter>
      </Dialog>

      {itemModal ? (
        <TemplateItemModal
          key={itemModal.serverId ?? `new-${itemModal.sectionId ?? "s"}-${itemModal.title}`}
          open
          draft={itemModal}
          coverConflictTitle={coverConflictTitle}
          busy={busy}
          onClose={() => setItemModal(null)}
          onSave={saveItemDraft}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={() => {
          if (!confirm) return;
          void run(confirm.action).then(() => setConfirm(null));
        }}
      />

      <ConfirmDialog
        open={confirmPermanentDelete}
        onClose={() => setConfirmPermanentDelete(false)}
        title="Permanently delete this template?"
        description={
          <>
            This permanently removes “{template.name}” and its checklist structure. Existing site
            inspections that were created from this template keep their own snapshot and are not
            affected.
          </>
        }
        confirmLabel="Delete template"
        destructive
        busy={busy}
        onConfirm={() => void permanentlyDelete()}
      />
    </div>
  );
}

function ItemList({
  title,
  containerKey,
  sectionId,
  items,
  isAdmin,
  busy,
  onAdd,
  onEdit,
  onDelete,
  onMove,
}: {
  title: string;
  containerKey: string;
  sectionId: string | null;
  items: InspectionTemplateItem[];
  isAdmin: boolean;
  busy: boolean;
  onAdd: () => void;
  onEdit: (item: InspectionTemplateItem) => void;
  onDelete: (item: InspectionTemplateItem) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const ids = items.map((i) => `item:${i.id}`);
  return (
    <div className="space-y-2" data-container={containerKey}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          {title}
        </h3>
        {isAdmin ? (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onAdd}>
            + Add item
          </Button>
        ) : null}
      </div>
      <SortableContext
        id={containerId(sectionId)}
        items={ids}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-2">
          {items.map((item, index) => (
            <SortableItemRow
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              busy={busy}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
              onMove={(dir) => onMove(index, dir)}
            />
          ))}
        </ul>
      </SortableContext>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--acton-border)] px-3 py-4 text-center text-sm text-[var(--acton-muted)]">
          No items yet
        </p>
      ) : null}
    </div>
  );
}

function SortableSection({
  section,
  open,
  onToggle,
  isAdmin,
  busy,
  onEdit,
  onDelete,
  onMoveSection,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onMoveItem,
}: {
  section: InspectionTemplateSection;
  open: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveSection: (dir: -1 | 1) => void;
  onAddItem: () => void;
  onEditItem: (item: InspectionTemplateItem) => void;
  onDeleteItem: (item: InspectionTemplateItem) => void;
  onMoveItem: (index: number, dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `section-drag:${section.id}`,
    disabled: !isAdmin,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const itemIds = section.items.map((i) => `item:${i.id}`);

  return (
    <section
      ref={setNodeRef}
      style={style}
      className="overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2">
        {isAdmin ? (
          <button
            type="button"
            className="touch-none rounded p-1 text-[var(--acton-muted)] hover:bg-white"
            aria-label={`Drag section ${section.title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          className="min-h-11 flex-1 text-left text-sm font-semibold text-[var(--acton-navy)]"
          onClick={onToggle}
          aria-expanded={open}
        >
          {open ? "▼" : "▶"} {section.title}
          <span className="ml-2 font-normal text-[var(--acton-muted)]">
            ({section.items.length})
          </span>
        </button>
        {isAdmin ? (
          <>
            <MoveButtons
              disabled={busy}
              onUp={() => onMoveSection(-1)}
              onDown={() => onMoveSection(1)}
            />
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
              Delete
            </Button>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2 p-3">
          <SortableContext
            id={containerId(section.id)}
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {section.items.map((item, index) => (
                <SortableItemRow
                  key={item.id}
                  item={item}
                  isAdmin={isAdmin}
                  busy={busy}
                  onEdit={() => onEditItem(item)}
                  onDelete={() => onDeleteItem(item)}
                  onMove={(dir) => onMoveItem(index, dir)}
                />
              ))}
            </ul>
          </SortableContext>
          {section.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--acton-border)] px-3 py-4 text-center text-sm text-[var(--acton-muted)]">
              No items in this section
            </p>
          ) : null}
          {isAdmin ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onAddItem}>
              + Add item
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SortableItemRow({
  item,
  isAdmin,
  busy,
  onEdit,
  onDelete,
  onMove,
}: {
  item: InspectionTemplateItem;
  isAdmin: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item:${item.id}`,
    disabled: !isAdmin,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--acton-border)] bg-white px-2 py-2 sm:px-3"
    >
      {isAdmin ? (
        <button
          type="button"
          className="touch-none rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
          aria-label={`Drag item ${item.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={isAdmin ? onEdit : undefined}
        disabled={!isAdmin}
      >
        <p className="truncate font-medium text-[var(--acton-navy)]">{item.title}</p>
        <p className="truncate text-xs text-[var(--acton-muted)]">{itemSummary(item)}</p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {item.isCoverPhotoSource ? (
            <span className="text-[10px] font-semibold tracking-wide text-[var(--acton-navy)] uppercase">
              Cover photo source
            </span>
          ) : null}
          {item.guideNotes.trim() ? (
            <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
              Internal only
            </span>
          ) : null}
        </div>
      </button>
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-1">
          <MoveButtons disabled={busy} onUp={() => onMove(-1)} onDown={() => onMove(1)} />
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}
