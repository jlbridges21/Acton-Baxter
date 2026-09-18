"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { InspectionTemplateSummary } from "@/lib/inspections/types";

async function postAction(body: Record<string, unknown>) {
  const res = await fetch("/api/inspections/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    template?: { id: string };
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? "Request failed");
  }
  return json;
}

export function TemplatesListClient({
  initialTemplates,
  isAdmin,
}: {
  initialTemplates: InspectionTemplateSummary[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [showArchived, setShowArchived] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InspectionTemplateSummary | null>(null);

  const visible = templates.filter((t) => showArchived || !t.archivedAt);

  async function refresh(includeArchived = showArchived) {
    const res = await fetch(
      `/api/inspections/templates${includeArchived ? "?includeArchived=1" : ""}`,
    );
    const json = (await res.json()) as { templates?: InspectionTemplateSummary[] };
    if (json.templates) setTemplates(json.templates);
  }

  async function createTemplate() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const json = await postAction({ action: "create", name });
      setNewName("");
      if (json.template?.id) router.push(`/inspections/templates/${json.template.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const json = await postAction({ action: "duplicate", templateId: id });
      if (json.template?.id) router.push(`/inspections/templates/${json.template.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    setError(null);
    try {
      await postAction({ action: "archive", templateId: id });
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    } finally {
      setBusy(false);
    }
  }

  async function unarchive(id: string) {
    setBusy(true);
    setError(null);
    try {
      await postAction({ action: "unarchive", templateId: id });
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unarchive");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPermanentDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await postAction({ action: "delete_template", templateId: deleteTarget.id });
      setDeleteTarget(null);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete template");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm">
          <label
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
            htmlFor="new-template-name"
          >
            New template
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-template-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Attached ADU"
              className="min-h-11"
            />
            <Button
              type="button"
              className="min-h-11 shrink-0"
              disabled={busy || !newName.trim()}
              onClick={() => void createTemplate()}
            >
              Create
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--acton-muted)]">
          {visible.length} template{visible.length === 1 ? "" : "s"}
        </p>
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => {
                const next = e.target.checked;
                setShowArchived(next);
                void refresh(next);
              }}
            />
            Show archived
          </label>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <ul className="space-y-2">
        {visible.map((template) => (
          <li
            key={template.id}
            className="rounded-xl border border-[var(--acton-border)] bg-white p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link
                  href={`/inspections/templates/${template.id}`}
                  className="text-base font-semibold text-[var(--acton-navy)] hover:underline"
                >
                  {template.name}
                </Link>
                {template.archivedAt ? (
                  <span className="ml-2 text-xs font-semibold tracking-wide text-amber-800 uppercase">
                    Archived
                  </span>
                ) : null}
                {template.description ? (
                  <p className="mt-1 text-sm text-[var(--acton-muted)]">{template.description}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  {template.sectionCount} sections · {template.itemCount} items
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void duplicate(template.id)}
                  >
                    Duplicate
                  </Button>
                  {template.archivedAt ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void unarchive(template.id)}
                      >
                        Unarchive
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => setDeleteTarget(template)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void archive(template.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="rounded-xl border border-dashed border-[var(--acton-border)] px-4 py-8 text-center text-sm text-[var(--acton-muted)]">
            No templates yet.
          </li>
        ) : null}
      </ul>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (busy) return;
          setDeleteTarget(null);
        }}
        title="Delete this template permanently?"
        description={
          <>
            This permanently deletes “{deleteTarget?.name}” and cannot be undone. Inspections
            already created from this template keep their own checklist snapshot and are not
            affected.
          </>
        }
        confirmLabel="Delete template"
        destructive
        busy={busy}
        onConfirm={() => void confirmPermanentDelete()}
      />
    </div>
  );
}
