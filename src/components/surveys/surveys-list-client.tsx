"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ClipboardList, Pencil, Search } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import { canEditSurvey, type SurveyActor } from "@/lib/surveys/permissions";
import { publicSurveyPath, publicSurveyUrl, type SurveySummary } from "@/lib/surveys/types";
import { ShareSlackDialog } from "./share-slack-dialog";
import { surveyFetch } from "./survey-api";
import { SurveyToast, useSurveyToast } from "./survey-toast";

export function SurveysListClient({
  initialSurveys,
  viewer,
  loadError,
}: {
  initialSurveys: SurveySummary[];
  viewer: SurveyActor;
  loadError: string | null;
}) {
  const router = useRouter();
  const toast = useSurveyToast();
  const [surveys, setSurveys] = useState(initialSurveys);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(loadError);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SurveySummary | null>(null);
  const [slackTarget, setSlackTarget] = useState<SurveySummary | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? surveys.filter((s) => s.title.toLowerCase().includes(q)) : surveys;
  }, [surveys, query]);

  async function copyLink(survey: SurveySummary) {
    const ok = await copyText(publicSurveyUrl(window.location.origin, survey.publicToken));
    toast.show(ok ? "Link copied" : "Couldn't copy the link");
  }

  async function duplicate(survey: SurveySummary) {
    setBusy(true);
    setError(null);
    try {
      const json = await surveyFetch<{ survey: { id: string } }>(
        `/api/surveys/${survey.id}/duplicate`,
        { method: "POST" },
      );
      router.push(`/surveys/${json.survey.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not duplicate the survey.");
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await surveyFetch(`/api/surveys/${deleteTarget.id}`, { method: "DELETE" });
      setSurveys((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.show("Survey deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the survey.");
    } finally {
      setBusy(false);
    }
  }

  function menuItems(survey: SurveySummary): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { id: "results", label: "Responses & Analytics", href: `/surveys/${survey.id}/responses` },
      { id: "copy", label: "Copy link", onSelect: () => void copyLink(survey) },
      {
        id: "open",
        label: "Open survey",
        onSelect: () => window.open(publicSurveyPath(survey.publicToken), "_blank", "noopener"),
      },
      { id: "slack", label: "Share to Slack", onSelect: () => setSlackTarget(survey) },
      {
        id: "duplicate",
        label: "Duplicate",
        disabled: busy,
        onSelect: () => void duplicate(survey),
      },
    ];
    if (canEditSurvey(viewer, survey)) {
      items.push({
        id: "delete",
        label: "Delete",
        destructive: true,
        onSelect: () => setDeleteTarget(survey),
      });
    }
    return items;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">Surveys</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Create surveys, share a link, and see results.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)}>
          New Survey
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {surveys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--acton-border)] px-4 py-16 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--acton-navy)]">No surveys yet</p>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Create a survey, add questions, and share the link.
          </p>
          <Button type="button" className="mt-4" onClick={() => setCreating(true)}>
            Create your first survey
          </Button>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]" />
            <Input
              aria-label="Search surveys by title"
              placeholder="Search by title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm" data-testid="surveys-table">
              <thead className="border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)] text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Creator</th>
                  <th className="px-4 py-3 text-right font-semibold">Responses</th>
                  <th className="px-4 py-3 font-semibold">Last response</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((survey) => (
                  <tr
                    key={survey.id}
                    className="border-b border-[var(--acton-border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/surveys/${survey.id}/responses`}
                        className="font-semibold text-[var(--acton-navy)] hover:underline"
                      >
                        {survey.title}
                      </Link>
                      {survey.questionCount === 0 ? (
                        <span className="ml-2 text-xs text-amber-800">No questions yet</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--acton-muted)]">
                      {survey.createdByName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--acton-navy)] tabular-nums">
                      {survey.responseCount}
                    </td>
                    <td className="px-4 py-3 text-[var(--acton-muted)]">
                      {survey.lastResponseAt
                        ? formatDistanceToNow(parseISO(survey.lastResponseAt), { addSuffix: true })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--acton-muted)]">
                      {format(parseISO(survey.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEditSurvey(viewer, survey) ? (
                          <Link
                            href={`/surveys/${survey.id}/edit`}
                            aria-label={`Edit ${survey.title}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        ) : null}
                        <ActionMenu
                          items={menuItems(survey)}
                          label={`Actions for ${survey.title}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--acton-muted)]">
                      No surveys match “{query}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}

      <NewSurveyDialog open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete survey?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” will be removed from the list and its link will stop working.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
      />

      {slackTarget ? (
        <ShareSlackDialog
          open
          onClose={() => setSlackTarget(null)}
          surveyId={slackTarget.id}
          surveyTitle={slackTarget.title}
          onShared={(channel) => toast.show(`Shared to #${channel}`)}
        />
      ) : null}

      <SurveyToast message={toast.message} />
    </div>
  );
}

function NewSurveyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose}>
      {open ? <NewSurveyForm key="new-survey" onClose={onClose} /> : null}
    </Dialog>
  );
}

function NewSurveyForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!title.trim()) {
      setError("Give the survey a title.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const json = await surveyFetch<{ survey: { id: string } }>("/api/surveys", {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      router.push(`/surveys/${json.survey.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the survey.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <DialogHeader>
        <DialogTitle>New survey</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div>
          <label
            htmlFor="new-survey-title"
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
          >
            Title
          </label>
          <Input
            id="new-survey-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Client experience survey"
            autoFocus
          />
        </div>
        <div>
          <label
            htmlFor="new-survey-description"
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
          >
            Description (optional)
          </label>
          <textarea
            id="new-survey-description"
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm text-[var(--acton-navy)]"
          />
        </div>
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create survey"}
        </Button>
      </DialogFooter>
    </form>
  );
}
