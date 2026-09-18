"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  INSPECTION_SUB_QUESTION_TYPES,
  type InspectionSubQuestionType,
  type InspectionTemplateDetail,
  type InspectionTemplateItem,
  type InspectionTemplateSection,
  type InspectionTemplateSubQuestion,
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

function GuideNotesBadge() {
  return (
    <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
      Internal only
    </span>
  );
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

function typeLabel(type: InspectionSubQuestionType): string {
  switch (type) {
    case "yes_no_na":
      return "Yes / No / N/A";
    case "single_select":
      return "Single select";
    case "multi_select":
      return "Multi select";
    case "text":
      return "Text";
  }
}

export function TemplateEditorClient({
  initialTemplate,
  isAdmin,
}: {
  initialTemplate: InspectionTemplateDetail;
  isAdmin: boolean;
}) {
  const [template, setTemplate] = useState(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialTemplate.sections.map((s) => [s.id, true])),
  );

  async function run(body: Record<string, unknown>) {
    if (!isAdmin) return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
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

      <StandaloneItems
        template={template}
        isAdmin={isAdmin}
        busy={busy}
        onRun={run}
        moveInList={moveInList}
      />

      {template.sections.map((section, sectionIndex) => (
        <SectionBlock
          key={section.id}
          template={template}
          section={section}
          sectionIndex={sectionIndex}
          open={openSections[section.id] !== false}
          onToggle={() =>
            setOpenSections((prev) => ({ ...prev, [section.id]: !(prev[section.id] !== false) }))
          }
          isAdmin={isAdmin}
          busy={busy}
          onRun={run}
          moveInList={moveInList}
        />
      ))}

      {isAdmin ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-full sm:w-auto"
          disabled={busy}
          onClick={() => {
            const title = window.prompt("Section title");
            if (title?.trim()) {
              void run({
                action: "add_section",
                templateId: template.id,
                title: title.trim(),
              });
            }
          }}
        >
          + Add section
        </Button>
      ) : null}
    </div>
  );
}

function StandaloneItems({
  template,
  isAdmin,
  busy,
  onRun,
  moveInList,
}: {
  template: InspectionTemplateDetail;
  isAdmin: boolean;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  moveInList: (ids: string[], index: number, dir: -1 | 1) => string[] | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          Standalone items
        </h3>
        {isAdmin ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              const title = window.prompt("Item title");
              if (title?.trim()) {
                void onRun({
                  action: "add_item",
                  templateId: template.id,
                  sectionId: null,
                  title: title.trim(),
                });
              }
            }}
          >
            + Add item
          </Button>
        ) : null}
      </div>
      {template.standaloneItems.map((item, index) => (
        <ItemEditor
          key={item.id}
          item={item}
          isAdmin={isAdmin}
          busy={busy}
          onRun={onRun}
          onMove={(dir) => {
            const next = moveInList(
              template.standaloneItems.map((i) => i.id),
              index,
              dir,
            );
            if (next) {
              void onRun({
                action: "reorder_items",
                templateId: template.id,
                sectionId: null,
                orderedIds: next,
              });
            }
          }}
        />
      ))}
    </div>
  );
}

function SectionBlock({
  template,
  section,
  sectionIndex,
  open,
  onToggle,
  isAdmin,
  busy,
  onRun,
  moveInList,
}: {
  template: InspectionTemplateDetail;
  section: InspectionTemplateSection;
  sectionIndex: number;
  open: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  moveInList: (ids: string[], index: number, dir: -1 | 1) => string[] | null;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--acton-border)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2">
        <button
          type="button"
          className="min-h-11 flex-1 text-left text-sm font-semibold text-[var(--acton-navy)]"
          onClick={onToggle}
          aria-expanded={open}
        >
          {open ? "▼" : "▶"} {section.title}
        </button>
        {isAdmin ? (
          <>
            <MoveButtons
              disabled={busy}
              onUp={() => {
                const next = moveInList(
                  template.sections.map((s) => s.id),
                  sectionIndex,
                  -1,
                );
                if (next) {
                  void onRun({
                    action: "reorder_sections",
                    templateId: template.id,
                    orderedIds: next,
                  });
                }
              }}
              onDown={() => {
                const next = moveInList(
                  template.sections.map((s) => s.id),
                  sectionIndex,
                  1,
                );
                if (next) {
                  void onRun({
                    action: "reorder_sections",
                    templateId: template.id,
                    orderedIds: next,
                  });
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                const title = window.prompt("Rename section", section.title);
                if (title?.trim() && title.trim() !== section.title) {
                  void onRun({
                    action: "update_section",
                    sectionId: section.id,
                    title: title.trim(),
                  });
                }
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete section “${section.title}” and its items?`)) {
                  void onRun({ action: "delete_section", sectionId: section.id });
                }
              }}
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 p-3">
          {section.items.map((item, index) => (
            <ItemEditor
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              busy={busy}
              onRun={onRun}
              onMove={(dir) => {
                const next = moveInList(
                  section.items.map((i) => i.id),
                  index,
                  dir,
                );
                if (next) {
                  void onRun({
                    action: "reorder_items",
                    templateId: template.id,
                    sectionId: section.id,
                    orderedIds: next,
                  });
                }
              }}
            />
          ))}
          {isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                const title = window.prompt("Item title");
                if (title?.trim()) {
                  void onRun({
                    action: "add_item",
                    templateId: template.id,
                    sectionId: section.id,
                    title: title.trim(),
                  });
                }
              }}
            >
              + Add item
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ItemEditor({
  item,
  isAdmin,
  busy,
  onRun,
  onMove,
}: {
  item: InspectionTemplateItem;
  isAdmin: boolean;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--acton-border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isAdmin ? (
            <Input
              defaultValue={item.title}
              key={`item-title-${item.id}-${item.sortOrder}-${item.title}`}
              className="min-h-10 font-medium"
              onBlur={(e) => {
                const title = e.target.value.trim();
                if (title && title !== item.title) {
                  void onRun({ action: "update_item", itemId: item.id, title });
                }
              }}
            />
          ) : (
            <p className="font-medium text-[var(--acton-navy)]">{item.title}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--acton-muted)]">
            <span>Checkbox · Media · Notes</span>
            {item.isCoverPhotoSource ? (
              <span className="font-semibold text-[var(--acton-navy)]">Cover photo source</span>
            ) : null}
          </div>
        </div>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-1">
            <MoveButtons disabled={busy} onUp={() => onMove(-1)} onDown={() => onMove(1)} />
            <label className="flex items-center gap-1 text-xs text-[var(--acton-navy)]">
              <input
                type="checkbox"
                checked={item.isCoverPhotoSource}
                disabled={busy}
                onChange={(e) =>
                  void onRun({
                    action: "update_item",
                    itemId: item.id,
                    isCoverPhotoSource: e.target.checked,
                  })
                }
              />
              Cover
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete item “${item.title}”?`)) {
                  void onRun({ action: "delete_item", itemId: item.id });
                }
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/80 p-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-950">Guide notes</span>
          <GuideNotesBadge />
        </div>
        {isAdmin ? (
          <textarea
            className="min-h-24 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-[var(--acton-navy)]"
            defaultValue={item.guideNotes}
            key={`guide-${item.id}-${item.guideNotes.length}`}
            onBlur={(e) => {
              if (e.target.value !== item.guideNotes) {
                void onRun({
                  action: "update_item",
                  itemId: item.id,
                  guideNotes: e.target.value,
                });
              }
            }}
          />
        ) : (
          <pre className="font-sans text-sm whitespace-pre-wrap text-amber-950">
            {item.guideNotes || "—"}
          </pre>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          Sub-questions
        </p>
        {item.subQuestions.map((sq, index) => (
          <SubQuestionEditor
            key={sq.id}
            subQuestion={sq}
            isAdmin={isAdmin}
            busy={busy}
            onRun={onRun}
            onMove={(dir) => {
              const ids = item.subQuestions.map((s) => s.id);
              const target = index + dir;
              if (target < 0 || target >= ids.length) return;
              const next = [...ids];
              const tmp = next[index]!;
              next[index] = next[target]!;
              next[target] = tmp;
              void onRun({
                action: "reorder_sub_questions",
                itemId: item.id,
                orderedIds: next,
              });
            }}
          />
        ))}
        {isAdmin ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              const prompt = window.prompt("Sub-question prompt");
              if (!prompt?.trim()) return;
              const typeRaw = window.prompt(
                `Type: ${INSPECTION_SUB_QUESTION_TYPES.join(", ")}`,
                "yes_no_na",
              );
              const questionType = (typeRaw?.trim() || "yes_no_na") as InspectionSubQuestionType;
              if (!INSPECTION_SUB_QUESTION_TYPES.includes(questionType)) {
                window.alert("Invalid type");
                return;
              }
              let options: { label: string }[] | undefined;
              if (questionType === "single_select" || questionType === "multi_select") {
                const raw = window.prompt("Options (comma-separated)");
                options = (raw ?? "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((label) => ({ label }));
              }
              void onRun({
                action: "add_sub_question",
                itemId: item.id,
                prompt: prompt.trim(),
                questionType,
                options,
              });
            }}
          >
            + Add sub-question
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SubQuestionEditor({
  subQuestion,
  isAdmin,
  busy,
  onRun,
  onMove,
}: {
  subQuestion: InspectionTemplateSubQuestion;
  isAdmin: boolean;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onMove: (dir: -1 | 1) => void;
}) {
  const needsOptions =
    subQuestion.questionType === "single_select" || subQuestion.questionType === "multi_select";

  return (
    <div className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isAdmin ? (
            <Input
              defaultValue={subQuestion.prompt}
              key={`sq-${subQuestion.id}-${subQuestion.prompt}`}
              className="min-h-9 bg-white text-sm"
              onBlur={(e) => {
                const prompt = e.target.value.trim();
                if (prompt && prompt !== subQuestion.prompt) {
                  void onRun({
                    action: "update_sub_question",
                    subQuestionId: subQuestion.id,
                    prompt,
                  });
                }
              }}
            />
          ) : (
            <p className="text-sm font-medium text-[var(--acton-navy)]">{subQuestion.prompt}</p>
          )}
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            {typeLabel(subQuestion.questionType)}
          </p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-1">
            <MoveButtons disabled={busy} onUp={() => onMove(-1)} onDown={() => onMove(1)} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Delete this sub-question?")) {
                  void onRun({
                    action: "delete_sub_question",
                    subQuestionId: subQuestion.id,
                  });
                }
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {needsOptions ? (
        <ul className="mt-2 space-y-1">
          {subQuestion.options.map((opt, index) => (
            <li key={opt.id} className="flex flex-wrap items-center gap-2">
              {isAdmin ? (
                <>
                  <Input
                    defaultValue={opt.label}
                    key={`opt-${opt.id}-${opt.label}`}
                    className="min-h-8 flex-1 bg-white text-sm"
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== opt.label) {
                        void onRun({
                          action: "update_option",
                          optionId: opt.id,
                          label,
                        });
                      }
                    }}
                  />
                  <MoveButtons
                    disabled={busy}
                    onUp={() => {
                      const ids = subQuestion.options.map((o) => o.id);
                      const target = index - 1;
                      if (target < 0) return;
                      const next = [...ids];
                      const tmp = next[index]!;
                      next[index] = next[target]!;
                      next[target] = tmp;
                      void onRun({
                        action: "reorder_options",
                        subQuestionId: subQuestion.id,
                        orderedIds: next,
                      });
                    }}
                    onDown={() => {
                      const ids = subQuestion.options.map((o) => o.id);
                      const target = index + 1;
                      if (target >= ids.length) return;
                      const next = [...ids];
                      const tmp = next[index]!;
                      next[index] = next[target]!;
                      next[target] = tmp;
                      void onRun({
                        action: "reorder_options",
                        subQuestionId: subQuestion.id,
                        orderedIds: next,
                      });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRun({ action: "delete_option", optionId: opt.id })}
                  >
                    ×
                  </Button>
                </>
              ) : (
                <span className="text-sm text-[var(--acton-navy)]">{opt.label}</span>
              )}
            </li>
          ))}
          {isAdmin ? (
            <li>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const label = window.prompt("Option label");
                  if (label?.trim()) {
                    void onRun({
                      action: "add_option",
                      subQuestionId: subQuestion.id,
                      label: label.trim(),
                    });
                  }
                }}
              >
                + Option
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
