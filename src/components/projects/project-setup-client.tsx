"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type SearchHit = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
};

type Preview = {
  contact: {
    id: string;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    assignedUserId: string | null;
    assignedUserName: string | null;
  };
  salesRep: string;
  fpPaidDate: string;
  jurisdiction: string | null;
  projectNumber: string;
  projectLastName: string;
  folderName: string;
  charterName: string;
  slackChannelName: string;
  inviteEmails: string[];
  inviteLabel: string;
  testMode: boolean;
  googleWritesEnabled?: boolean;
  dryRunDefault?: boolean;
};

export function ProjectSetupClient({
  googleWritesEnabled = false,
}: {
  googleWritesEnabled?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [salesRep, setSalesRep] = useState("");
  const [fpPaidDate, setFpPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectNumber, setProjectNumber] = useState("");
  const [lastName, setLastName] = useState("");
  const [dryRun, setDryRun] = useState(!googleWritesEnabled);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const derivedPreview = useMemo(() => {
    if (!preview) return null;
    const number = projectNumber.trim().toUpperCase() || preview.projectNumber;
    const ln = lastName.trim() || preview.projectLastName;
    const folderName = `${number} ${ln}`.trim();
    const charterName = `${ln} Project Charter`;
    const slack = `${number.toLowerCase()}-${ln}`
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[''`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    return { folderName, charterName, slackChannelName: slack };
  }, [preview, projectNumber, lastName]);

  async function runSearch() {
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(
        `/api/projects/setup/contacts?q=${encodeURIComponent(query.trim())}`,
      );
      const payload = (await response.json()) as {
        contacts?: SearchHit[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Search failed");
      }
      setHits(payload.contacts ?? []);
    } catch (err) {
      setHits([]);
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function selectContact(contactId: string) {
    setSelectedId(contactId);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const params = new URLSearchParams({ contactId });
      if (fpPaidDate) params.set("fpPaidDate", fpPaidDate);
      const response = await fetch(`/api/projects/setup/preview?${params.toString()}`);
      const payload = (await response.json()) as {
        preview?: Preview;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to load contact");
      }
      const next = payload.preview!;
      setPreview(next);
      setSalesRep(next.salesRep);
      setFpPaidDate(next.fpPaidDate);
      setProjectNumber(next.projectNumber);
      setLastName(next.projectLastName);
      setDryRun(next.dryRunDefault ?? !googleWritesEnabled);
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : "Unable to load contact");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleBegin() {
    if (!preview) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/projects/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ghlContactId: preview.contact.id,
          salesRep: salesRep.trim(),
          projectNumber: projectNumber.trim().toUpperCase(),
          projectLastName: lastName.trim(),
          fpPaidDate,
          dryRun: googleWritesEnabled ? dryRun : true,
          contactSnapshot: preview.contact,
        }),
      });
      const payload = (await response.json()) as {
        runId?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to start project setup");
      }
      router.push(`/projects/setup/${payload.runId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to start project setup");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardTitle>Find the customer in GoHighLevel</CardTitle>
        <CardDescription className="mt-2">
          Search by name, email, or phone. Select a contact to confirm project details before
          running a dry-run setup.
        </CardDescription>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-3.5 left-3 h-4 w-4 text-[var(--acton-muted)]" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts…"
              aria-label="Search GoHighLevel contacts"
            />
          </div>
          <Button type="submit" disabled={searching || query.trim().length < 2}>
            {searching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Search
          </Button>
        </form>
        {searchError ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {searchError}
          </p>
        ) : null}
        {hits.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--acton-border)] rounded-md border border-[var(--acton-border)]">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-3 py-3 text-left hover:bg-[var(--acton-gray-50)] ${
                    selectedId === hit.id ? "bg-[var(--acton-gray-50)]" : ""
                  }`}
                  onClick={() => void selectContact(hit.id)}
                >
                  <span className="font-semibold text-[var(--acton-navy)]">{hit.name}</span>
                  <span className="text-xs text-[var(--acton-muted)]">
                    {[hit.email, hit.phone, hit.address].filter(Boolean).join(" · ") ||
                      "No contact details"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {previewLoading ? (
        <Card className="flex items-center gap-3">
          <LoaderCircle className="h-5 w-5 animate-spin text-[var(--acton-navy)]" />
          <span className="text-sm">Loading contact details…</span>
        </Card>
      ) : null}

      {previewError ? (
        <Card>
          <p className="text-sm text-red-700" role="alert">
            {previewError}
          </p>
        </Card>
      ) : null}

      {preview && !previewLoading ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Confirm project setup</CardTitle>
            {(dryRun || !googleWritesEnabled) && <Badge tone="amber">Dry-run</Badge>}
            {preview.testMode ? <Badge tone="blue">Test mode</Badge> : null}
          </div>
          <CardDescription>
            {googleWritesEnabled && !dryRun
              ? "This run will append the Master Project Log row and create the Drive folder and charter. Slack steps stay planned only until Prompt 3."
              : "Review details below. This run records the plan only — Drive, Sheets, Slack, and GHL are not modified (or dry-run is checked)."}
          </CardDescription>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={!googleWritesEnabled ? true : dryRun}
              disabled={!googleWritesEnabled}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            <span>
              <span className="font-medium text-[var(--acton-navy)]">
                Dry run (plan only, no changes)
              </span>
              {!googleWritesEnabled ? (
                <span className="mt-0.5 block text-[var(--acton-muted)]">
                  Required until Google is reconnected with write scopes.
                </span>
              ) : null}
            </span>
          </label>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Full name" value={preview.contact.name} />
            <Field
              label="First / last"
              value={`${preview.contact.firstName ?? "—"} / ${preview.contact.lastName ?? "—"}`}
            />
            <Field label="Email" value={preview.contact.email} />
            <Field label="Phone" value={preview.contact.phone} />
            <Field label="Street address" value={preview.contact.address} />
            <Field
              label="City / zip"
              value={`${preview.contact.city ?? "—"} / ${preview.contact.postalCode ?? "—"}`}
            />
            <Field label="Jurisdiction" value={preview.jurisdiction ?? preview.contact.city} />
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">Sales rep</span>
              <Input value={salesRep} onChange={(e) => setSalesRep(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">FP paid date</span>
              <Input
                type="date"
                value={fpPaidDate}
                onChange={(e) => setFpPaidDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                Project number
              </span>
              <Input
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value.toUpperCase())}
                placeholder="L01-26018"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--acton-navy)]">Last name</span>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <div className="rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] p-3 text-sm">
            <p className="font-semibold text-[var(--acton-navy)]">Derived preview</p>
            <ul className="mt-2 space-y-1 text-[var(--acton-muted)]">
              <li>
                Folder: <span className="text-[var(--acton-fg)]">{derivedPreview?.folderName}</span>
              </li>
              <li>
                Charter:{" "}
                <span className="text-[var(--acton-fg)]">{derivedPreview?.charterName}</span>
              </li>
              <li>
                Slack channel:{" "}
                <span className="text-[var(--acton-fg)]">#{derivedPreview?.slackChannelName}</span>
              </li>
            </ul>
            <p className="mt-3 font-medium text-[var(--acton-navy)]">{preview.inviteLabel}</p>
            <p className="mt-1 text-xs text-[var(--acton-muted)]">
              {preview.inviteEmails.join(", ")}
            </p>
          </div>

          {submitError ? (
            <p className="text-sm text-red-700" role="alert">
              {submitError}
            </p>
          ) : null}

          <Button
            onClick={() => void handleBegin()}
            disabled={submitting || !salesRep.trim() || !projectNumber.trim() || !lastName.trim()}
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Begin project setup
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-[var(--acton-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[var(--acton-fg)]">{value?.trim() || "—"}</dd>
    </div>
  );
}
