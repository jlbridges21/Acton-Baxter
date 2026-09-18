"use client";

/**
 * Add/Edit checklist item modal — title, guide notes, toggles, sub-questions, options.
 */

import { useMemo, useState } from "react";
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
  INSPECTION_SUB_QUESTION_TYPES,
  type InspectionSubQuestionType,
  type InspectionTemplateItem,
} from "@/lib/inspections/types";

export type DraftOption = { key: string; label: string };
export type DraftSubQuestion = {
  key: string;
  serverId: string | null;
  prompt: string;
  questionType: InspectionSubQuestionType;
  options: DraftOption[];
};

export type ItemDraft = {
  serverId: string | null;
  sectionId: string | null;
  title: string;
  guideNotes: string;
  allowsMedia: boolean;
  allowsNotes: boolean;
  isCoverPhotoSource: boolean;
  subQuestions: DraftSubQuestion[];
};

function newKey() {
  return crypto.randomUUID();
}

export function itemToDraft(item: InspectionTemplateItem): ItemDraft {
  return {
    serverId: item.id,
    sectionId: item.sectionId,
    title: item.title,
    guideNotes: item.guideNotes,
    allowsMedia: item.allowsMedia,
    allowsNotes: item.allowsNotes,
    isCoverPhotoSource: item.isCoverPhotoSource,
    subQuestions: item.subQuestions.map((sq) => ({
      key: sq.id,
      serverId: sq.id,
      prompt: sq.prompt,
      questionType: sq.questionType,
      options: sq.options.map((o) => ({ key: o.id, label: o.label })),
    })),
  };
}

export function emptyItemDraft(sectionId: string | null): ItemDraft {
  return {
    serverId: null,
    sectionId,
    title: "",
    guideNotes: "",
    allowsMedia: true,
    allowsNotes: true,
    isCoverPhotoSource: false,
    subQuestions: [],
  };
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

function isSelectType(type: InspectionSubQuestionType) {
  return type === "single_select" || type === "multi_select";
}

export function parseBulkOptions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (trimmed.includes(" / ")) {
    return trimmed
      .split(" / ")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (trimmed.includes("/")) {
    return trimmed
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function draftsEqual(a: ItemDraft, b: ItemDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function TemplateItemModal({
  open,
  draft,
  coverConflictTitle,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: ItemDraft;
  coverConflictTitle: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ItemDraft) => Promise<void>;
}) {
  const [local, setLocal] = useState(draft);
  const [baseline] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const [typeChange, setTypeChange] = useState<{
    key: string;
    nextType: InspectionSubQuestionType;
  } | null>(null);
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("");

  // Parent remounts this modal with a fresh `key` when the draft changes.

  const dirty = useMemo(() => !draftsEqual(local, baseline), [local, baseline]);

  function requestClose() {
    if (dirty) {
      setDiscardOpen(true);
      return false;
    }
    return true;
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!local.title.trim()) next.title = "Title is required";
    local.subQuestions.forEach((sq, i) => {
      if (!sq.prompt.trim()) next[`sq-${sq.key}`] = `Sub-question ${i + 1} needs a label`;
      if (isSelectType(sq.questionType) && sq.options.filter((o) => o.label.trim()).length < 1) {
        next[`sq-opt-${sq.key}`] =
          `Add at least one option for “${sq.prompt || `question ${i + 1}`}”`;
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    const cleaned: ItemDraft = {
      ...local,
      title: local.title.trim(),
      subQuestions: local.subQuestions.map((sq) => ({
        ...sq,
        prompt: sq.prompt.trim(),
        options: isSelectType(sq.questionType)
          ? sq.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label)
          : [],
      })),
    };
    await onSave(cleaned);
  }

  function applyTypeChange(key: string, nextType: InspectionSubQuestionType) {
    setLocal((prev) => ({
      ...prev,
      subQuestions: prev.subQuestions.map((sq) => {
        if (sq.key !== key) return sq;
        return {
          ...sq,
          questionType: nextType,
          options: isSelectType(nextType) ? sq.options : [],
        };
      }),
    }));
  }

  function requestTypeChange(key: string, nextType: InspectionSubQuestionType) {
    const sq = local.subQuestions.find((s) => s.key === key);
    if (!sq) return;
    if (
      isSelectType(sq.questionType) &&
      !isSelectType(nextType) &&
      sq.options.some((o) => o.label.trim())
    ) {
      setTypeChange({ key, nextType });
      return;
    }
    applyTypeChange(key, nextType);
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} onRequestClose={requestClose} size="lg">
        <DialogHeader>
          <DialogTitle>{local.serverId ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            Checklist row with optional media, notes, and sub-questions.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
              htmlFor="item-title"
            >
              Title
            </label>
            <Input
              id="item-title"
              className="min-h-11"
              value={local.title}
              onChange={(e) => setLocal((p) => ({ ...p, title: e.target.value }))}
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title ? <p className="mt-1 text-sm text-red-700">{errors.title}</p> : null}
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50/90 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold text-amber-950" htmlFor="item-guide">
                Guide notes
              </label>
              <span className="inline-flex items-center rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
                Internal only
              </span>
            </div>
            <textarea
              id="item-guide"
              className="min-h-28 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-[var(--acton-navy)]"
              value={local.guideNotes}
              onChange={(e) => setLocal((p) => ({ ...p, guideNotes: e.target.value }))}
              placeholder="Field guidance for inspectors"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--acton-navy)]">Item options</legend>
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--acton-border)] px-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--acton-navy)]"
                checked={local.allowsMedia}
                onChange={(e) => setLocal((p) => ({ ...p, allowsMedia: e.target.checked }))}
              />
              <span className="text-sm text-[var(--acton-navy)]">Attach media (photo / video)</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-[var(--acton-border)] px-3">
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--acton-navy)]"
                checked={local.allowsNotes}
                onChange={(e) => setLocal((p) => ({ ...p, allowsNotes: e.target.checked }))}
              />
              <span className="text-sm text-[var(--acton-navy)]">Free-text notes</span>
            </label>
            <label className="flex min-h-11 items-start gap-3 rounded-md border border-[var(--acton-border)] px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-[var(--acton-navy)]"
                checked={local.isCoverPhotoSource}
                onChange={(e) => setLocal((p) => ({ ...p, isCoverPhotoSource: e.target.checked }))}
              />
              <span className="text-sm text-[var(--acton-navy)]">
                Cover photo source
                <span className="mt-0.5 block text-xs text-[var(--acton-muted)]">
                  Only one item per template can be the cover source.
                  {local.isCoverPhotoSource && coverConflictTitle
                    ? ` Saving will replace “${coverConflictTitle}”.`
                    : null}
                </span>
              </span>
            </label>
          </fieldset>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Sub-questions</h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-10"
                onClick={() =>
                  setLocal((p) => ({
                    ...p,
                    subQuestions: [
                      ...p.subQuestions,
                      {
                        key: newKey(),
                        serverId: null,
                        prompt: "",
                        questionType: "yes_no_na",
                        options: [],
                      },
                    ],
                  }))
                }
              >
                + Add sub-question
              </Button>
            </div>

            {local.subQuestions.length === 0 ? (
              <p className="text-sm text-[var(--acton-muted)]">No sub-questions yet.</p>
            ) : null}

            {local.subQuestions.map((sq, index) => (
              <div
                key={sq.key}
                className="space-y-2 rounded-lg border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      className="min-h-10 bg-white"
                      placeholder="Question label"
                      value={sq.prompt}
                      onChange={(e) =>
                        setLocal((p) => ({
                          ...p,
                          subQuestions: p.subQuestions.map((s) =>
                            s.key === sq.key ? { ...s, prompt: e.target.value } : s,
                          ),
                        }))
                      }
                      aria-invalid={Boolean(errors[`sq-${sq.key}`])}
                    />
                    {errors[`sq-${sq.key}`] ? (
                      <p className="text-sm text-red-700">{errors[`sq-${sq.key}`]}</p>
                    ) : null}
                    <select
                      className="min-h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                      value={sq.questionType}
                      onChange={(e) =>
                        requestTypeChange(sq.key, e.target.value as InspectionSubQuestionType)
                      }
                    >
                      {INSPECTION_SUB_QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {typeLabel(t)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Move sub-question up"
                      disabled={index === 0}
                      onClick={() =>
                        setLocal((p) => {
                          if (index === 0) return p;
                          const next = [...p.subQuestions];
                          const tmp = next[index - 1]!;
                          next[index - 1] = next[index]!;
                          next[index] = tmp;
                          return { ...p, subQuestions: next };
                        })
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Move sub-question down"
                      disabled={index >= local.subQuestions.length - 1}
                      onClick={() =>
                        setLocal((p) => {
                          if (index >= p.subQuestions.length - 1) return p;
                          const next = [...p.subQuestions];
                          const tmp = next[index + 1]!;
                          next[index + 1] = next[index]!;
                          next[index] = tmp;
                          return { ...p, subQuestions: next };
                        })
                      }
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLocal((p) => ({
                          ...p,
                          subQuestions: p.subQuestions.filter((s) => s.key !== sq.key),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {isSelectType(sq.questionType) ? (
                  <div className="space-y-2 border-t border-[var(--acton-border)] pt-2">
                    <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                      Options
                    </p>
                    {errors[`sq-opt-${sq.key}`] ? (
                      <p className="text-sm text-red-700">{errors[`sq-opt-${sq.key}`]}</p>
                    ) : null}
                    {sq.options.map((opt, optIndex) => (
                      <div key={opt.key} className="flex flex-wrap items-center gap-2">
                        <Input
                          className="min-h-9 flex-1 bg-white text-sm"
                          value={opt.label}
                          onChange={(e) =>
                            setLocal((p) => ({
                              ...p,
                              subQuestions: p.subQuestions.map((s) =>
                                s.key === sq.key
                                  ? {
                                      ...s,
                                      options: s.options.map((o) =>
                                        o.key === opt.key ? { ...o, label: e.target.value } : o,
                                      ),
                                    }
                                  : s,
                              ),
                            }))
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Move option up"
                          disabled={optIndex === 0}
                          onClick={() =>
                            setLocal((p) => ({
                              ...p,
                              subQuestions: p.subQuestions.map((s) => {
                                if (s.key !== sq.key || optIndex === 0) return s;
                                const opts = [...s.options];
                                const tmp = opts[optIndex - 1]!;
                                opts[optIndex - 1] = opts[optIndex]!;
                                opts[optIndex] = tmp;
                                return { ...s, options: opts };
                              }),
                            }))
                          }
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Move option down"
                          disabled={optIndex >= sq.options.length - 1}
                          onClick={() =>
                            setLocal((p) => ({
                              ...p,
                              subQuestions: p.subQuestions.map((s) => {
                                if (s.key !== sq.key || optIndex >= s.options.length - 1) return s;
                                const opts = [...s.options];
                                const tmp = opts[optIndex + 1]!;
                                opts[optIndex + 1] = opts[optIndex]!;
                                opts[optIndex] = tmp;
                                return { ...s, options: opts };
                              }),
                            }))
                          }
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Remove option"
                          onClick={() =>
                            setLocal((p) => ({
                              ...p,
                              subQuestions: p.subQuestions.map((s) =>
                                s.key === sq.key
                                  ? {
                                      ...s,
                                      options: s.options.filter((o) => o.key !== opt.key),
                                    }
                                  : s,
                              ),
                            }))
                          }
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setLocal((p) => ({
                            ...p,
                            subQuestions: p.subQuestions.map((s) =>
                              s.key === sq.key
                                ? {
                                    ...s,
                                    options: [...s.options, { key: newKey(), label: "" }],
                                  }
                                : s,
                            ),
                          }))
                        }
                      >
                        + Option
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setBulkFor(sq.key);
                          setBulkText("");
                        }}
                      >
                        Paste many…
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton />
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {busy ? "Saving…" : "Save item"}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard unsaved changes?"
        description="You have edits that haven’t been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />

      <ConfirmDialog
        open={Boolean(typeChange)}
        onClose={() => setTypeChange(null)}
        title="Discard options?"
        description="Switching away from a select type will remove the options you’ve entered for this sub-question."
        confirmLabel="Discard options"
        destructive
        onConfirm={() => {
          if (typeChange) applyTypeChange(typeChange.key, typeChange.nextType);
          setTypeChange(null);
        }}
      />

      <Dialog open={Boolean(bulkFor)} onClose={() => setBulkFor(null)} size="md">
        <DialogHeader>
          <DialogTitle>Add options in bulk</DialogTitle>
          <DialogDescription>
            One per line, or separated by commas or slashes (e.g. 100 / 200 / 320).
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <textarea
            className="min-h-36 w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={'100 / 200 / 320 / 400\nor\n5/8"\n3/4"\n1"'}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => setBulkFor(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            onClick={() => {
              if (!bulkFor) return;
              const labels = parseBulkOptions(bulkText);
              setLocal((p) => ({
                ...p,
                subQuestions: p.subQuestions.map((s) =>
                  s.key === bulkFor
                    ? {
                        ...s,
                        options: [
                          ...s.options,
                          ...labels.map((label) => ({ key: newKey(), label })),
                        ],
                      }
                    : s,
                ),
              }));
              setBulkFor(null);
            }}
          >
            Add options
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
