"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { AddressAutocomplete } from "@/components/address/address-autocomplete";
import { SelectedAddressCard } from "@/components/address/selected-address-card";
import type { AddressResolveResult, SelectedAddress } from "@/lib/address/types";

function NewReportFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefill = searchParams.get("address") ?? "";

  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [query, setQuery] = useState(prefill);
  const [pendingConfirm, setPendingConfirm] = useState<SelectedAddress | null>(null);
  const [ambiguous, setAmbiguous] = useState<SelectedAddress[]>([]);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolving, setResolving] = useState(false);

  async function createReport(address: SelectedAddress) {
    setSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const payload = (await response.json()) as {
        reportId?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.reportId) {
        throw new Error(payload.error?.message ?? "Unable to create report");
      }
      router.push(`/reports/${payload.reportId}/processing`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Unable to create report");
      setSubmitting(false);
    }
  }

  async function resolveTypedAddress() {
    const trimmed = query.trim();
    if (trimmed.length < 5) {
      setServerError("Enter a full California property address");
      return;
    }

    setResolving(true);
    setServerError(null);
    setResolveMessage(null);
    setAmbiguous([]);
    setPendingConfirm(null);

    try {
      const response = await fetch("/api/address/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const payload = (await response.json()) as AddressResolveResult & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to resolve address");
      }

      if (payload.status === "confirmed") {
        setPendingConfirm(payload.address);
        setResolveMessage("Confirm this property address to continue.");
        return;
      }
      if (payload.status === "ambiguous") {
        setAmbiguous(payload.candidates);
        setResolveMessage(payload.message);
        return;
      }
      setResolveMessage(
        payload.message ||
          "We could not confidently identify this property. Please select an address from the suggestions.",
      );
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Unable to resolve address");
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (selected) {
      await createReport(selected);
      return;
    }

    await resolveTypedAddress();
  }

  function confirmResolved(address: SelectedAddress) {
    setSelected(address);
    setPendingConfirm(null);
    setAmbiguous([]);
    setResolveMessage(null);
    setQuery(address.formattedAddress);
  }

  const hasTypedQuery = query.trim().length >= 5;
  const researchEnabled = Boolean(selected) && !submitting && !resolving;
  const resolveEnabled = !selected && hasTypedQuery && !submitting && !resolving;

  return (
    <Card className="mx-auto max-w-2xl">
      <CardTitle>New property research</CardTitle>
      <CardDescription className="mt-2">
        Enter a property address to research public property, parcel, zoning, and planning
        information.
      </CardDescription>
      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label
            htmlFor="property-address"
            className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
          >
            Property address
          </label>
          <AddressAutocomplete
            id="property-address"
            value={selected}
            query={query}
            onChange={(address) => {
              setSelected(address);
              setPendingConfirm(null);
              setAmbiguous([]);
              setResolveMessage(null);
            }}
            onQueryChange={setQuery}
            disabled={submitting || resolving}
          />
        </div>

        {selected ? (
          <SelectedAddressCard
            address={selected}
            onClear={() => {
              setSelected(null);
            }}
          />
        ) : null}

        {pendingConfirm && !selected ? (
          <div className="space-y-3">
            {resolveMessage ? (
              <p className="text-sm text-[var(--acton-muted)]">{resolveMessage}</p>
            ) : null}
            <SelectedAddressCard address={pendingConfirm} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="accent"
                onClick={() => confirmResolved(pendingConfirm)}
              >
                Confirm address
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPendingConfirm(null);
                  setResolveMessage(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {ambiguous.length > 0 && !selected ? (
          <div className="space-y-3">
            {resolveMessage ? (
              <p className="text-sm text-[var(--acton-muted)]">{resolveMessage}</p>
            ) : null}
            <ul className="space-y-2">
              {ambiguous.map((candidate) => (
                <li
                  key={`${candidate.placeId ?? candidate.formattedAddress}-${candidate.latitude}`}
                >
                  <button
                    type="button"
                    className="w-full rounded-md border border-[var(--acton-border)] px-4 py-3 text-left hover:bg-[var(--acton-gray-50)]"
                    onClick={() => confirmResolved(candidate)}
                  >
                    <span className="block text-sm font-semibold text-[var(--acton-navy)]">
                      {candidate.formattedAddress}
                    </span>
                    {candidate.county ? (
                      <span className="mt-1 block text-xs text-[var(--acton-muted)]">
                        {candidate.county} County
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {resolveMessage && !pendingConfirm && ambiguous.length === 0 && !selected ? (
          <p className="text-sm text-red-700">{resolveMessage}</p>
        ) : null}

        {serverError ? <p className="text-sm text-red-700">{serverError}</p> : null}

        <div className="flex flex-wrap gap-2">
          {selected ? (
            <Button type="submit" variant="accent" disabled={!researchEnabled}>
              {submitting ? "Starting research..." : "Research Property"}
            </Button>
          ) : (
            <Button type="submit" variant="accent" disabled={!resolveEnabled}>
              {resolving ? "Resolving address..." : "Research Property"}
            </Button>
          )}
        </div>
        {!selected ? (
          <p className="text-xs text-[var(--acton-muted)]">
            Select a suggestion, or continue with a typed address to confirm it before research
            starts.
          </p>
        ) : null}
      </form>
    </Card>
  );
}

export function NewReportForm() {
  return (
    <Suspense
      fallback={
        <Card className="mx-auto max-w-2xl">
          <CardTitle>New property research</CardTitle>
          <CardDescription className="mt-2">Loading address form...</CardDescription>
        </Card>
      }
    >
      <NewReportFormInner />
    </Suspense>
  );
}
