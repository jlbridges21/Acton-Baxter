"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import { firstSurveyDraftError } from "@/lib/surveys/schemas";
import {
  SURVEY_DISPLAY_MODES,
  SURVEY_DISPLAY_MODE_LABELS,
  SURVEY_IDENTITY_MODES,
  SURVEY_IDENTITY_MODE_LABELS,
  activeQuestions,
  publicSurveyUrl,
  questionTypeHasOptions,
  type PublicSurvey,
  type SurveyDetail,
  type SurveyDisplayMode,
  type SurveyIdentityMode,
} from "@/lib/surveys/types";
import { ShareSlackDialog } from "./share-slack-dialog";
import { surveyFetch } from "./survey-api";
import { SurveyQuestionCard, newOptionId, type DraftQuestion } from "./survey-question-card";
import { SurveyRespondentForm } from "./survey-respondent-form";
import { SurveyToast, useSurveyToast } from "./survey-toast";

type Draft = {
  title: string;
  description: string;
  displayMode: SurveyDisplayMode;
  identityMode: SurveyIdentityMode;
  questions: DraftQuestion[];
};

function draftFromSurvey(survey: SurveyDetail): Draft {
  return {
    title: survey.title,
    description: survey.description ?? "",
    displayMode: survey.displayMode,
    identityMode: survey.identityMode,
    questions: activeQuestions(survey.questions).map((q) => ({
      id: q.id,
      prompt: q.prompt,
      helpText: q.helpText ?? "",
      type: q.type,
      required: q.required,
      options: q.options,
    })),
  };
}

function toPayload(draft: Draft) {
  return {
    title: draft.title,
    description: draft.description || null,
    displayMode: draft.displayMode,
    identityMode: draft.identityMode,
    questions: draft.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      helpText: q.helpText || null,
      type: q.type,
      required: q.required,
      options: questionTypeHasOptions(q.type) ? q.options : [],
    })),
  };
}

function toPreview(draft: Draft, token: string): PublicSurvey {
  return {
    token,
    title: draft.title || "Untitled survey",
    description: draft.description || null,
    displayMode: draft.displayMode,
    identityMode: draft.identityMode,
    questions: draft.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt || "Untitled question",
      helpText: q.helpText || null,
      type: q.type,
      required: q.required,
      options: questionTypeHasOptions(q.type) ? q.options.filter((o) => o.label.trim()) : [],
    })),
  };
}

const noopSubscribe = () => () => {};

/** Empty during SSR so the share URL never causes a hydration mismatch. */
function useBrowserOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

function newQuestion(): DraftQuestion {
  return {
    id: `new-${nanoid(10)}`,
    prompt: "",
    helpText: "",
    type: "star_rating",
    required: false,
    options: [],
  };
}

export function SurveyEditorClient({ initialSurvey }: { initialSurvey: SurveyDetail }) {
  const toast = useSurveyToast();
  const [survey, setSurvey] = useState(initialSurvey);
  const [draft, setDraft] = useState<Draft>(() => draftFromSurvey(initialSurvey));
  const [savedJson, setSavedJson] = useState(() =>
    JSON.stringify(toPayload(draftFromSurvey(initialSurvey))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [slackOpen, setSlackOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DraftQuestion | null>(null);

  const dirty = JSON.stringify(toPayload(draft)) !== savedJson;
  const answered = useMemo(() => new Set(survey.answeredQuestionIds), [survey.answeredQuestionIds]);
  const savedQuestionCount = activeQuestions(survey.questions).length;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const origin = useBrowserOrigin();
  const shareUrl = origin ? publicSurveyUrl(origin, survey.publicToken) : "";

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    function onClickCapture(e: MouseEvent) {
      const anchor = (e.target as HTMLElement | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || e.metaKey || e.ctrlKey) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty]);

  function updateQuestion(next: DraftQuestion) {
    setDraft((d) => ({ ...d, questions: d.questions.map((q) => (q.id === next.id ? next : q)) }));
  }

  function removeQuestion(id: string) {
    setDraft((d) => ({ ...d, questions: d.questions.filter((q) => q.id !== id) }));
  }

  function duplicateQuestion(source: DraftQuestion) {
    const copy: DraftQuestion = {
      ...source,
      id: `new-${nanoid(10)}`,
      options: source.options.map((o) => ({ id: newOptionId(), label: o.label })),
    };
    setDraft((d) => {
      const index = d.questions.findIndex((q) => q.id === source.id);
      const questions = [...d.questions];
      questions.splice(index + 1, 0, copy);
      return { ...d, questions };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      const from = d.questions.findIndex((q) => q.id === active.id);
      const to = d.questions.findIndex((q) => q.id === over.id);
      if (from < 0 || to < 0) return d;
      return { ...d, questions: arrayMove(d.questions, from, to) };
    });
  }

  async function save() {
    const payload = toPayload(draft);
    const problem = firstSurveyDraftError(payload);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const json = await surveyFetch<{ survey: SurveyDetail }>(`/api/surveys/${survey.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const next = draftFromSurvey(json.survey);
      setSurvey(json.survey);
      setDraft(next);
      setSavedJson(JSON.stringify(toPayload(next)));
      toast.show("Survey saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the survey.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    const ok = await copyText(shareUrl);
    toast.show(ok ? "Link copied" : "Couldn't copy the link");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/surveys"
          className="inline-flex items-center gap-1 text-sm text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
        >
          <ArrowLeft className="h-4 w-4" /> Surveys
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--acton-muted)]" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Link
            href={`/surveys/${survey.id}/responses`}
            className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] px-3 text-xs font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
          >
            Results
          </Link>
          <Button type="button" size="sm" disabled={saving || !dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      {survey.responseCount > 0 ? (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="survey-responses-banner"
        >
          This survey has {survey.responseCount} response{survey.responseCount === 1 ? "" : "s"}.
          Changes apply to new responses.
        </p>
      ) : null}

      {savedQuestionCount > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--acton-border)] bg-white p-3 shadow-sm"
          data-testid="survey-share-bar"
        >
          <span className="text-sm font-medium text-[var(--acton-navy)]">Share link</span>
          <Input
            readOnly
            value={shareUrl}
            aria-label="Survey link"
            className="h-9 min-w-0 flex-1"
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
            Copy
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSlackOpen(true)}>
            Share to Slack
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-[var(--acton-gray-50)] px-4 py-3 text-sm text-[var(--acton-muted)]">
          Add at least one question and save to get a shareable link.
        </p>
      )}

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-3 rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm">
        <div>
          <label
            htmlFor="survey-title"
            className="mb-1 block text-xs font-semibold text-[var(--acton-muted)] uppercase"
          >
            Title
          </label>
          <Input
            id="survey-title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="text-lg font-semibold"
          />
        </div>
        <div>
          <label
            htmlFor="survey-description"
            className="mb-1 block text-xs font-semibold text-[var(--acton-muted)] uppercase"
          >
            Description (optional)
          </label>
          <textarea
            id="survey-description"
            value={draft.description}
            maxLength={2000}
            rows={2}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
          />
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm sm:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-[var(--acton-muted)] uppercase">
            Display
          </legend>
          {SURVEY_DISPLAY_MODES.map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-2 py-1 text-sm text-[var(--acton-navy)]"
            >
              <input
                type="radio"
                name="survey-display-mode"
                checked={draft.displayMode === mode}
                onChange={() => setDraft((d) => ({ ...d, displayMode: mode }))}
              />
              {SURVEY_DISPLAY_MODE_LABELS[mode]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-[var(--acton-muted)] uppercase">
            Responses
          </legend>
          {SURVEY_IDENTITY_MODES.map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-2 py-1 text-sm text-[var(--acton-navy)]"
            >
              <input
                type="radio"
                name="survey-identity-mode"
                checked={draft.identityMode === mode}
                onChange={() => setDraft((d) => ({ ...d, identityMode: mode }))}
              />
              {SURVEY_IDENTITY_MODE_LABELS[mode]}
            </label>
          ))}
          {draft.identityMode === "anonymous" ? (
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              Names, emails, and Baxter accounts are never stored — even for signed-in teammates.
            </p>
          ) : null}
        </fieldset>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--acton-navy)]">
          Questions ({draft.questions.length})
        </h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={draft.questions.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-3">
              {draft.questions.map((q, index) => (
                <SurveyQuestionCard
                  key={q.id}
                  question={q}
                  index={index}
                  hasAnswers={answered.has(q.id)}
                  onChange={updateQuestion}
                  onDuplicate={() => duplicateQuestion(q)}
                  onDelete={() => (answered.has(q.id) ? setArchiveTarget(q) : removeQuestion(q.id))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, newQuestion()] }))}
        >
          <Plus className="mr-1 h-4 w-4" /> Add question
        </Button>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <Button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="shadow-lg"
        >
          {saving ? "Saving…" : "Save survey"}
        </Button>
      </div>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} size="lg">
        <DialogHeader>
          <DialogTitle>{draft.title || "Untitled survey"}</DialogTitle>
          <DialogDescription>Preview — responses here aren&apos;t recorded.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {previewOpen ? (
            draft.questions.length === 0 ? (
              <p className="text-sm text-[var(--acton-muted)]">
                Add a question to preview the survey.
              </p>
            ) : (
              <SurveyRespondentForm survey={toPreview(draft, survey.publicToken)} preview />
            )
          ) : null}
        </DialogBody>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) removeQuestion(archiveTarget.id);
          setArchiveTarget(null);
        }}
        title="Remove this question?"
        description="It already has answers. When you save, it's hidden from new responses and its past answers move to “Removed questions” in results."
        confirmLabel="Remove"
        destructive
      />

      {slackOpen ? (
        <ShareSlackDialog
          open
          onClose={() => setSlackOpen(false)}
          surveyId={survey.id}
          surveyTitle={survey.title}
          onShared={(channel) => toast.show(`Shared to #${channel}`)}
        />
      ) : null}

      <SurveyToast message={toast.message} />
    </div>
  );
}
