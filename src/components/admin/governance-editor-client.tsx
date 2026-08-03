"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { GovernanceDomain, GovernanceSectionKey } from "@/lib/baxter-ai/governance";

type Payload = {
  active: { id: string; version_number: number; status: string } | null;
  activeSections: Array<{ section_key: GovernanceSectionKey; content: string; domain: string }>;
  draft: { id: string; version_number: number; status: string; rationale: string | null } | null;
  draftSections: Array<{ section_key: GovernanceSectionKey; content: string; domain: string }>;
  draftApprovals: Array<{ section_key: GovernanceSectionKey; approved_by: string }>;
  gate: {
    ok: boolean;
    error?: string;
    missingApprovals?: Array<{ sectionKey: GovernanceSectionKey; domain: string }>;
    changedSections?: GovernanceSectionKey[];
  } | null;
  owners: Array<{ domain: GovernanceDomain; profile_id: string | null }>;
  loaded: { versionNumber: number; usedFallback: boolean };
  meta: {
    sectionKeys: GovernanceSectionKey[];
    sectionLabels: Record<GovernanceSectionKey, string>;
    sectionDomains: Record<GovernanceSectionKey, GovernanceDomain>;
    domains: GovernanceDomain[];
    domainLabels: Record<GovernanceDomain, string>;
  };
};

export function GovernanceEditorClient({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<GovernanceSectionKey | null>(null);
  const [draftText, setDraftText] = useState("");
  const [tab, setTab] = useState<"active" | "draft" | "owners">("active");

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/baxter/governance");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error?.message ?? "Failed to load governance");
      return;
    }
    setData(body as Payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function post(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json();
      if (!res.ok && res.status !== 409) {
        throw new Error(body.error?.message ?? body.error ?? "Request failed");
      }
      if (res.status === 409 && body.error) {
        setError(typeof body.error === "string" ? body.error : body.error.message);
      }
      await load();
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <p className="text-sm text-[var(--acton-muted)]">Loading governance…</p>;
  }

  const sections = tab === "draft" && data.draft ? data.draftSections : data.activeSections;
  const approved = new Set(data.draftApprovals.map((a) => a.section_key));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["active", "draft", "owners"] as const).map((t) => (
          <Button
            key={t}
            type="button"
            variant={tab === t ? "accent" : "secondary"}
            size="sm"
            onClick={() => setTab(t)}
          >
            {t === "active"
              ? "Active content"
              : t === "draft"
                ? "Draft & approvals"
                : "Domain owners"}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <Card className="p-4">
        <CardTitle>Versions</CardTitle>
        <CardDescription className="mt-2 text-sm">
          Runtime architecture: code-fixed. Active content v{data.active?.version_number ?? "—"}.{" "}
          {data.loaded.usedFallback
            ? "Currently using compiled fallback (DB unavailable or incomplete)."
            : `Loaded content v${data.loaded.versionNumber} from the database.`}
          {data.draft ? ` Draft v${data.draft.version_number} in progress.` : " No draft open."}
        </CardDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void post("ensure_draft")}>
            {data.draft ? "Open existing draft" : "Propose draft from active"}
          </Button>
          {data.draft ? (
            <Button
              type="button"
              size="sm"
              variant="accent"
              disabled={busy}
              onClick={() => void post("activate", { versionId: data.draft!.id })}
            >
              Activate draft
            </Button>
          ) : null}
        </div>
        {data.gate && !data.gate.ok ? (
          <p className="mt-3 text-sm text-amber-900">{data.gate.error}</p>
        ) : null}
      </Card>

      {tab === "owners" ? (
        <Card className="p-4">
          <CardTitle>Domain owners</CardTitle>
          <CardDescription className="mt-2">
            Start unassigned. Only super_admin can assign. Domain owners (or super_admin) must
            approve changed sections before activation.
          </CardDescription>
          <ul className="mt-4 space-y-3 text-sm">
            {data.meta.domains.map((domain) => {
              const owner = data.owners.find((o) => o.domain === domain);
              return (
                <li
                  key={domain}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--acton-border)] pb-2"
                >
                  <div>
                    <p className="font-semibold text-[var(--acton-navy)]">
                      {data.meta.domainLabels[domain]}
                    </p>
                    <p className="text-xs text-[var(--acton-muted)]">
                      {owner?.profile_id ?? "Unassigned"}
                    </p>
                  </div>
                  {isSuperAdmin ? (
                    <div className="flex gap-2">
                      <input
                        className="h-9 w-64 rounded border border-[var(--acton-border)] px-2 text-xs"
                        placeholder="Profile UUID"
                        id={`owner-${domain}`}
                        defaultValue={owner?.profile_id ?? ""}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const el = document.getElementById(
                            `owner-${domain}`,
                          ) as HTMLInputElement | null;
                          void post("assign_domain_owner", {
                            domain,
                            profileId: el?.value.trim() || null,
                          });
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.meta.sectionKeys.map((key) => {
            const section = sections.find((s) => s.section_key === key);
            const content = section?.content ?? "";
            const domain = data.meta.sectionDomains[key];
            const isChanged =
              data.draft &&
              data.activeSections.find((s) => s.section_key === key)?.content !==
                data.draftSections.find((s) => s.section_key === key)?.content;
            return (
              <Card key={key} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{data.meta.sectionLabels[key]}</CardTitle>
                    <CardDescription className="mt-1">
                      Domain: {data.meta.domainLabels[domain]}
                      {tab === "draft" && isChanged ? " · changed" : ""}
                      {tab === "draft" && isChanged
                        ? approved.has(key)
                          ? " · approved"
                          : " · needs approval"
                        : ""}
                    </CardDescription>
                  </div>
                  {tab === "draft" && data.draft ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setEditing(key);
                          setDraftText(content);
                        }}
                      >
                        Edit
                      </Button>
                      {isChanged && !approved.has(key) ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void post("approve_section", {
                              versionId: data.draft!.id,
                              sectionKey: key,
                            })
                          }
                        >
                          Approve
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {editing === key ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      className="min-h-48 w-full rounded border border-[var(--acton-border)] p-3 font-mono text-xs"
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || !data.draft}
                        onClick={() =>
                          void post("update_section", {
                            versionId: data.draft!.id,
                            sectionKey: key,
                            content: draftText,
                          }).then(() => setEditing(null))
                        }
                      >
                        Save to draft
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <pre className="mt-3 max-h-40 overflow-auto rounded bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap text-[var(--acton-navy)]">
                    {content}
                  </pre>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
