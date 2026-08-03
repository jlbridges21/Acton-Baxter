"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { CustomerDossier } from "@/lib/dossier/types";

function SectionStatus({ status }: { status: string }) {
  if (status === "ok") return <Badge tone="green">Loaded</Badge>;
  if (status === "empty") return <Badge tone="gray">None found</Badge>;
  if (status === "error") return <Badge tone="red">Unavailable</Badge>;
  if (status === "omitted") return null;
  return <Badge tone="amber">Unavailable</Badge>;
}

export function CustomerDossierClient({
  dossier,
  isAdmin,
  initialQuery,
}: {
  dossier: CustomerDossier | null;
  isAdmin: boolean;
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    const params = new URLSearchParams();
    if (/^[0-9a-f-]{20,}$/i.test(q) && !q.includes(" ")) {
      params.set("contactId", q);
    } else {
      params.set("q", q);
    }
    router.push(`/customers/lookup?${params.toString()}`);
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardTitle>Look up a customer</CardTitle>
        <CardDescription className="mt-2">
          Search by name or GoHighLevel contact id. Baxter assembles what it already knows from GHL,
          PEM NEAT, and Project Setup
          {isAdmin ? ", plus open Process Monitoring findings" : ""}.
        </CardDescription>
        <form onSubmit={onSearch} className="mt-4 flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Customer name or GHL contact id"
            className="min-w-[16rem] flex-1"
            aria-label="Customer search"
          />
          <Button type="submit" variant="accent" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Search"}
          </Button>
        </form>
      </Card>

      {!dossier ? (
        <p className="text-sm text-[var(--acton-muted)]">
          Enter a name to see a read-only cross-system view. No actions are taken from this page.
        </p>
      ) : (
        <DossierView dossier={dossier} />
      )}
    </div>
  );
}

function DossierView({ dossier }: { dossier: CustomerDossier }) {
  const name = dossier.identity.displayName ?? "Customer";

  return (
    <div className="space-y-4" data-testid="customer-dossier">
      <div>
        <h2 className="text-xl font-bold text-[var(--acton-navy)]">{name}</h2>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Read-only dossier. Sections load independently — a failure in one system does not hide the
          others.
        </p>
      </div>

      <Card data-testid="dossier-ghl">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>GoHighLevel</CardTitle>
          <SectionStatus status={dossier.ghl.status} />
        </div>
        {dossier.ghl.error ? (
          <p className="mt-2 text-sm text-red-700">{dossier.ghl.error}</p>
        ) : null}
        {dossier.ghl.clarificationMessage ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">
            {dossier.ghl.clarificationMessage}
          </p>
        ) : null}
        {dossier.ghl.status === "ok" ? (
          <div className="mt-3 space-y-2 text-sm text-[var(--acton-navy)]">
            <p>
              <span className="text-[var(--acton-muted)]">Contact: </span>
              {dossier.ghl.contactName}
              {dossier.ghl.contactId ? (
                <span className="text-[var(--acton-muted)]"> ({dossier.ghl.contactId})</span>
              ) : null}
            </p>
            {dossier.ghl.email ? (
              <p>
                <span className="text-[var(--acton-muted)]">Email: </span>
                {dossier.ghl.email}
              </p>
            ) : null}
            {dossier.ghl.phone ? (
              <p>
                <span className="text-[var(--acton-muted)]">Phone: </span>
                {dossier.ghl.phone}
              </p>
            ) : null}
            {dossier.ghl.ownerName ? (
              <p>
                <span className="text-[var(--acton-muted)]">Owner: </span>
                {dossier.ghl.ownerName}
              </p>
            ) : null}
            <div>
              <p className="font-semibold">Opportunities</p>
              {dossier.ghl.opportunities.length === 0 ? (
                <p className="text-[var(--acton-muted)]">None on file.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {dossier.ghl.opportunities.map((opp) => (
                    <li key={opp.id}>
                      {opp.name ?? "Untitled"} — {opp.stageName ?? opp.status ?? "unknown stage"}
                      {opp.pipelineName ? ` (${opp.pipelineName})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : dossier.ghl.status === "empty" && !dossier.ghl.clarificationMessage ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">No matching GHL contact found.</p>
        ) : null}
      </Card>

      <Card data-testid="dossier-pem">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>PEM NEAT</CardTitle>
          <SectionStatus status={dossier.pemNeats.status} />
        </div>
        {dossier.pemNeats.error ? (
          <p className="mt-2 text-sm text-red-700">{dossier.pemNeats.error}</p>
        ) : null}
        {dossier.pemNeats.records.length === 0 && dossier.pemNeats.status !== "error" ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">No linked PEM NEAT found.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {dossier.pemNeats.records.map((pem) => (
              <li key={pem.id} className="text-sm">
                <Link
                  href={pem.href}
                  className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  {pem.prospectName}
                </Link>
                <p className="text-[var(--acton-muted)]">
                  Outcome: {pem.meetingOutcome ?? "n/a"} · Qualification:{" "}
                  {pem.qualification ?? "n/a"} · Status: {pem.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="dossier-project-setup">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Project Setup</CardTitle>
          <SectionStatus status={dossier.projectSetup.status} />
        </div>
        {dossier.projectSetup.error ? (
          <p className="mt-2 text-sm text-red-700">{dossier.projectSetup.error}</p>
        ) : null}
        {dossier.projectSetup.runs.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]" data-testid="dossier-setup-empty">
            {dossier.projectSetup.emptyMessage ?? "No Project Setup run found for this customer."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {dossier.projectSetup.runs.map((run) => (
              <li key={run.id} className="text-sm">
                <Link
                  href={run.href}
                  className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                >
                  {run.projectNumber ?? "Project setup run"} ({run.status}
                  {run.dryRun ? ", dry-run" : ""})
                </Link>
                <ul className="mt-1 space-y-0.5 text-[var(--acton-muted)]">
                  {run.folderLink ? (
                    <li>
                      <a
                        href={run.folderLink}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        Open project folder
                      </a>
                    </li>
                  ) : run.folderName ? (
                    <li>Folder: {run.folderName}</li>
                  ) : null}
                  {run.charterLink ? (
                    <li>
                      <a
                        href={run.charterLink}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        Open project charter
                      </a>
                    </li>
                  ) : run.charterName ? (
                    <li>Charter: {run.charterName}</li>
                  ) : null}
                  {run.slackChannelName ? <li>Slack: #{run.slackChannelName}</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dossier.monitoring.status !== "omitted" ? (
        <Card data-testid="dossier-monitoring">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Process Monitoring</CardTitle>
            <SectionStatus status={dossier.monitoring.status} />
          </div>
          {dossier.monitoring.error ? (
            <p className="mt-2 text-sm text-red-700">{dossier.monitoring.error}</p>
          ) : null}
          {dossier.monitoring.findings.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--acton-muted)]">No open findings.</p>
          ) : (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {dossier.monitoring.findings.map((f) => (
                <li key={f.id}>
                  <Link
                    href={f.href}
                    className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                  >
                    [{f.severity}] {f.title}
                  </Link>{" "}
                  <span className="text-[var(--acton-muted)]">({f.status})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
