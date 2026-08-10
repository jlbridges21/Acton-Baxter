"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ProfilePersonPicker } from "@/components/admin/profile-person-picker";
import type {
  GovernanceDomain,
  GovernanceOwnerCandidate,
  GovernanceSectionKey,
  GovernanceSurface,
} from "@/lib/baxter-ai/governance";

type GatePayload = {
  ok: boolean;
  error?: string;
  missingApprovals?: Array<{
    sectionKey: GovernanceSectionKey;
    sectionLabel?: string;
    domain: GovernanceDomain;
    domainLabel?: string;
    ownerAssigned?: boolean;
  }>;
  unassignedDomains?: Array<{ domain: GovernanceDomain; domainLabel: string }>;
  changedSections?: GovernanceSectionKey[];
};

type Payload = {
  surface: GovernanceSurface;
  active: { id: string; version_number: number; status: string } | null;
  activeSections: Array<{ section_key: GovernanceSectionKey; content: string; domain: string }>;
  draft: { id: string; version_number: number; status: string; rationale: string | null } | null;
  draftSections: Array<{ section_key: GovernanceSectionKey; content: string; domain: string }>;
  draftApprovals: Array<{ section_key: GovernanceSectionKey; approved_by: string }>;
  gate: GatePayload | null;
  owners: Array<{ domain: GovernanceDomain; profile_id: string | null }>;
  ownerCandidates: GovernanceOwnerCandidate[];
  loaded: { versionNumber: number; usedFallback: boolean };
  meta: {
    surface: GovernanceSurface;
    surfaces: GovernanceSurface[];
    surfaceLabels: Record<GovernanceSurface, string>;
    sectionKeys: GovernanceSectionKey[];
    sectionLabels: Record<GovernanceSectionKey, string>;
    sectionDomains: Record<GovernanceSectionKey, GovernanceDomain>;
    domains: GovernanceDomain[];
    domainLabels: Record<GovernanceDomain, string>;
  };
};

type MainTab = "content" | "owners";
type ContentMode = "live" | "draft";

const DOMAIN_EXPLAINER =
  "Domains group related sections so the right person reviews the right kind of change — grading-criteria changes need Process Content approval; tone and wording changes need a different reviewer.";

function ActivationBlockedPanel({
  gate,
  onGoToOwners,
}: {
  gate: GatePayload;
  onGoToOwners: () => void;
}) {
  const missing = gate.missingApprovals ?? [];
  const byDomain = new Map<
    string,
    { domainLabel: string; ownerAssigned: boolean; sections: string[] }
  >();

  for (const m of missing) {
    const label = m.sectionLabel ?? m.sectionKey;
    const domainLabel = m.domainLabel ?? m.domain;
    const existing = byDomain.get(m.domain);
    if (existing) {
      existing.sections.push(label);
      existing.ownerAssigned = existing.ownerAssigned && Boolean(m.ownerAssigned);
    } else {
      byDomain.set(m.domain, {
        domainLabel,
        ownerAssigned: Boolean(m.ownerAssigned),
        sections: [label],
      });
    }
  }

  // Prefer structured data; fall back to server error string (already humanized).
  if (byDomain.size === 0 && gate.error) {
    return (
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm whitespace-pre-wrap text-amber-950">
        {gate.error}
        <p className="mt-2 text-xs text-amber-900/80">{DOMAIN_EXPLAINER}</p>
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={onGoToOwners}>
          Go to Domain owners
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      {[...byDomain.values()].map((group) => (
        <div key={group.domainLabel}>
          <p className="font-semibold">
            The following sections were changed and need {group.domainLabel} approval before this
            draft can activate:
          </p>
          <ul className="mt-1 list-none space-y-0.5 pl-0">
            {group.sections.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
          {!group.ownerAssigned ? (
            <p className="mt-2 text-amber-900">
              No owner is assigned for {group.domainLabel} yet. A super-admin can assign one under
              Domain owners.
            </p>
          ) : null}
        </div>
      ))}
      <p className="text-xs text-amber-900/80">{DOMAIN_EXPLAINER}</p>
      <Button type="button" size="sm" variant="secondary" onClick={onGoToOwners}>
        Go to Domain owners
      </Button>
    </div>
  );
}

export function GovernanceEditorClient({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<GovernanceSectionKey | null>(null);
  const [draftText, setDraftText] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("content");
  const [contentMode, setContentMode] = useState<ContentMode>("live");
  const [surface, setSurface] = useState<GovernanceSurface>("baxter_runtime");
  const [expanded, setExpanded] = useState<Set<GovernanceSectionKey>>(new Set());
  const [pendingOwnerIds, setPendingOwnerIds] = useState<
    Partial<Record<GovernanceDomain, string | null>>
  >({});

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/baxter/governance?surface=${encodeURIComponent(surface)}`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error?.message ?? "Failed to load governance");
      return;
    }
    setData(body as Payload);
  }, [surface]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Collapse / reset editor chrome when the surface changes (done in the surface click handler).

  async function post(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, surface, ...payload }),
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

  function toggleExpanded(key: GovernanceSectionKey) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function openOrCreateDraft() {
    if (data?.draft) {
      setMainTab("content");
      setContentMode("draft");
      setEditing(null);
      return;
    }
    await post("ensure_draft");
    setMainTab("content");
    setContentMode("draft");
  }

  if (!data) {
    return <p className="text-sm text-[var(--acton-muted)]">Loading governance…</p>;
  }

  const showingDraft = contentMode === "draft" && Boolean(data.draft);
  const sections = showingDraft ? data.draftSections : data.activeSections;
  const approved = new Set(data.draftApprovals.map((a) => a.section_key));
  const surfaceLabels = data.meta.surfaceLabels;
  const candidates = data.ownerCandidates ?? [];

  return (
    <div className="space-y-6">
      {/* Surface switcher */}
      <div className="flex flex-wrap gap-2">
        {(
          data.meta.surfaces ?? (["baxter_runtime", "pem_neat_grading"] as GovernanceSurface[])
        ).map((s) => (
          <Button
            key={s}
            type="button"
            variant={surface === s ? "accent" : "secondary"}
            size="sm"
            onClick={() => {
              setSurface(s);
              setExpanded(new Set());
              setEditing(null);
              setContentMode("live");
              setMainTab("content");
            }}
          >
            {surfaceLabels?.[s] ?? s}
          </Button>
        ))}
      </div>

      <p className="text-sm text-[var(--acton-muted)]">
        {surface === "pem_neat_grading"
          ? "Criteria Baxter uses when generating PEM NEATs. Propose a draft, get Process Content approval, then activate."
          : "Wording Baxter uses in chat. Propose a draft, get the right domain approval, then activate."}
      </p>

      {/* Primary navigation */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--acton-border)] pb-3">
        <Button
          type="button"
          variant={mainTab === "content" ? "accent" : "secondary"}
          size="sm"
          onClick={() => setMainTab("content")}
        >
          Editable content
        </Button>
        <Button
          type="button"
          variant={mainTab === "owners" ? "accent" : "secondary"}
          size="sm"
          onClick={() => setMainTab("owners")}
        >
          Domain owners
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm whitespace-pre-wrap text-red-800">
          {error}
        </p>
      ) : null}

      {mainTab === "owners" ? (
        <Card className="p-4">
          <CardTitle>Domain owners</CardTitle>
          <CardDescription className="mt-2 text-sm">{DOMAIN_EXPLAINER}</CardDescription>
          <p className="mt-2 text-sm text-[var(--acton-muted)]">
            Only a super-admin can assign owners. Domain owners (or a super-admin) must approve
            changed sections before a draft can go live.
          </p>
          <ul className="mt-4 space-y-4">
            {data.meta.domains.map((domain) => {
              const owner = data.owners.find((o) => o.domain === domain);
              const selectedId =
                pendingOwnerIds[domain] !== undefined
                  ? pendingOwnerIds[domain]
                  : (owner?.profile_id ?? null);
              const selectedPerson = candidates.find((c) => c.id === selectedId) ?? null;
              return (
                <li
                  key={domain}
                  className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)]/40 p-3"
                >
                  <p className="font-semibold text-[var(--acton-navy)]">
                    {data.meta.domainLabels[domain]}
                  </p>
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    {selectedPerson
                      ? `Current owner: ${selectedPerson.displayName}${selectedPerson.email ? ` · ${selectedPerson.email}` : ""}`
                      : "Unassigned — changes in this domain cannot be activated until someone is assigned (or a super-admin approves)."}
                  </p>
                  {isSuperAdmin ? (
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <ProfilePersonPicker
                        people={candidates}
                        value={selectedId}
                        disabled={busy}
                        onChange={(id) =>
                          setPendingOwnerIds((prev) => ({
                            ...prev,
                            [domain]: id,
                          }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const profileId =
                            pendingOwnerIds[domain] !== undefined
                              ? pendingOwnerIds[domain]
                              : (owner?.profile_id ?? null);
                          void post("assign_domain_owner", {
                            domain,
                            profileId,
                          }).then(() => {
                            setPendingOwnerIds((prev) => {
                              const next = { ...prev };
                              delete next[domain];
                              return next;
                            });
                          });
                        }}
                      >
                        Save owner
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <>
          {/* Version status — plain language */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{surfaceLabels?.[surface] ?? surface}</CardTitle>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
                      Currently live: v{data.active?.version_number ?? "—"}
                    </span>
                    {data.loaded.usedFallback ? (
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                        Using compiled fallback (database unavailable)
                      </span>
                    ) : null}
                  </div>
                  {data.draft ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-950 ring-1 ring-sky-200">
                        Draft in progress: v{data.draft.version_number}
                        {data.gate && !data.gate.ok ? " — pending approval" : " — ready to review"}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[var(--acton-muted)]">No draft in progress.</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void openOrCreateDraft()}
                  data-testid="governance-open-draft"
                >
                  {data.draft ? "Open existing draft" : "Propose draft from live"}
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
            </div>

            {data.gate && !data.gate.ok ? (
              <ActivationBlockedPanel gate={data.gate} onGoToOwners={() => setMainTab("owners")} />
            ) : null}
          </Card>

          {/* Live vs draft mode */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={!showingDraft ? "accent" : "secondary"}
              onClick={() => {
                setContentMode("live");
                setEditing(null);
              }}
            >
              Live content
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showingDraft ? "accent" : "secondary"}
              disabled={!data.draft}
              onClick={() => {
                setContentMode("draft");
                setEditing(null);
              }}
              data-testid="governance-draft-mode"
            >
              Draft {data.draft ? `(v${data.draft.version_number})` : "(none)"}
            </Button>
          </div>

          {!showingDraft ? (
            <p className="text-xs text-[var(--acton-muted)]">
              Showing what is currently live. Open or propose a draft to edit.
            </p>
          ) : (
            <p className="text-xs text-[var(--acton-muted)]">
              Showing the draft. Expand a section to read it; use Edit to propose changes. Changed
              sections need domain approval before activation.
            </p>
          )}

          {/* Accordion sections */}
          <div className="space-y-2">
            {data.meta.sectionKeys.map((key) => {
              const section = sections.find((s) => s.section_key === key);
              const content = section?.content ?? "";
              const domain = data.meta.sectionDomains[key];
              const isOpen = expanded.has(key) || editing === key;
              const isChanged =
                showingDraft &&
                data.activeSections.find((s) => s.section_key === key)?.content !==
                  data.draftSections.find((s) => s.section_key === key)?.content;

              return (
                <Card key={key} className="overflow-hidden p-0">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--acton-gray-50)]/60"
                    onClick={() => toggleExpanded(key)}
                    aria-expanded={isOpen}
                    data-testid={`governance-section-${key}`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--acton-navy)]">
                        {data.meta.sectionLabels[key]}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                        {data.meta.domainLabels[domain]}
                        {showingDraft && isChanged ? " · changed" : ""}
                        {showingDraft && isChanged
                          ? approved.has(key)
                            ? " · approved"
                            : " · needs approval"
                          : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--acton-muted)]">
                      {isOpen ? "Hide" : "Show"}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="border-t border-[var(--acton-border)] px-4 py-3">
                      {showingDraft ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setEditing(key);
                              setDraftText(content);
                              setExpanded((prev) => new Set(prev).add(key));
                            }}
                          >
                            Edit
                          </Button>
                          {isChanged && !approved.has(key) ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy || !data.draft}
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

                      {editing === key ? (
                        <div className="space-y-2">
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
                        <pre className="max-h-64 overflow-auto rounded bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap text-[var(--acton-navy)]">
                          {content}
                        </pre>
                      )}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
