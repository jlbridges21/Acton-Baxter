"use client";

/**
 * Saved personal views: save the current grouping, sorting, and filters under a name, apply
 * one later, or make one your default for this report. Views are private to the signed-in
 * person and never change the report's published defaults.
 */

import { useCallback, useRef, useState } from "react";
import { Bookmark, Star, Trash2 } from "lucide-react";
import { aiFetch, errorMessage, useLoad } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import type { ControlState } from "@/lib/reports/result-types";

type View = { id: string; name: string; state: ControlState; isDefault: boolean };

export function SavedViewsMenu({
  reportId,
  state,
  hasUrlState,
  onApply,
}: {
  reportId: string;
  state: ControlState;
  /** The page opened with explicit filters (a shared link): don't replace them with a default. */
  hasUrlState: boolean;
  onApply: (state: ControlState) => void;
}) {
  const [views, setViews] = useState<View[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await aiFetch<{ views: View[] }>(`/api/reports/${reportId}/views`);
      setViews(res.views);
      const def = res.views.find((v) => v.isDefault);
      if (def && !hasUrlState && !applied.current) {
        applied.current = true;
        onApply(def.state);
      }
    } catch {
      // Saved views are optional (e.g. before the migration): hide quietly.
    }
  }, [reportId, hasUrlState, onApply]);
  useLoad(load);

  const call = async (init: RequestInit, query = "") => {
    setError(null);
    try {
      const res = await aiFetch<{ views: View[] }>(`/api/reports/${reportId}/views${query}`, init);
      setViews(res.views);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="relative print:hidden">
      <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bookmark className="h-3.5 w-3.5" aria-hidden /> My views
        {views.length ? ` (${views.length})` : ""}
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-72 space-y-2 rounded-md border border-[var(--acton-border)] bg-white p-3 text-sm shadow-lg">
          <p className="text-xs text-[var(--acton-muted)]">
            Your own saved grouping, sorting, and filters. Other people don&apos;t see these.
          </p>
          {views.length ? (
            <ul className="space-y-1">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex-1 truncate text-left font-semibold text-[var(--acton-navy)] hover:underline"
                    onClick={() => {
                      onApply(v.state);
                      setOpen(false);
                    }}
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    title={v.isDefault ? "Your default view" : "Make this your default"}
                    aria-label={
                      v.isDefault ? `${v.name} is your default` : `Make ${v.name} your default`
                    }
                    onClick={() =>
                      void call({
                        method: "POST",
                        body: JSON.stringify({
                          name: v.name,
                          state: v.state,
                          isDefault: !v.isDefault,
                        }),
                      })
                    }
                  >
                    <Star
                      className={
                        v.isDefault
                          ? "h-3.5 w-3.5 fill-amber-400 text-amber-500"
                          : "h-3.5 w-3.5 text-[var(--acton-muted)]"
                      }
                      aria-hidden
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${v.name}`}
                    onClick={() =>
                      void call({ method: "DELETE" }, `?id=${encodeURIComponent(v.id)}`)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[var(--acton-muted)]" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void call({
                method: "POST",
                body: JSON.stringify({ name: name.trim(), state }),
              }).then(() => setName(""));
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Save current view as…"
              aria-label="View name"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--acton-border)] px-2 text-sm"
            />
            <Button size="sm" type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </form>
          <button
            type="button"
            className="text-xs font-semibold text-[var(--acton-navy)] underline"
            onClick={() => {
              onApply({});
              setOpen(false);
            }}
          >
            Reset to the report&apos;s default
          </button>
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
