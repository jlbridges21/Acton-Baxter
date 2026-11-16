"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { countFilledGhlFields, PEM_NEAT_GHL_FIELD_MAP } from "@/lib/pem-neat/ghl-sync-payload";
import type { BuildertrendFields } from "@/lib/pem-neat/schemas";
import { cn } from "@/lib/utils";

type ContactHit = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

type SyncResult = {
  syncedAt: string;
  filledFields: number;
  contactLabel: string;
};

export function SyncToGhlButton({
  pemNeatId,
  prospectName,
  fields,
  disabled,
}: {
  pemNeatId: string;
  prospectName: string;
  fields: BuildertrendFields;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(prospectName);
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactHit | null>(null);
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const filled = countFilledGhlFields(fields);
  const total = PEM_NEAT_GHL_FIELD_MAP.length;
  const hasManual = Boolean(manualEmail.trim() || manualPhone.replace(/\D/g, ""));
  const canPush = !pushing && filled > 0 && (Boolean(selected) || hasManual);

  async function runSearch(q: string) {
    if (q.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(
        `/api/projects/setup/contacts?q=${encodeURIComponent(q.trim())}`,
      );
      const payload = (await response.json()) as {
        contacts?: ContactHit[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? "Search failed");
      const contacts = payload.contacts ?? [];
      setHits(contacts);
      setSelected(contacts.length === 1 ? contacts[0]! : null);
    } catch {
      setHits([]);
      setSearchError(
        "Couldn't search GoHighLevel contacts right now. Enter the customer's email or phone below instead.",
      );
    } finally {
      setSearching(false);
    }
  }

  function openDialog() {
    setError(null);
    setOpen(true);
    // Search once on open (if not already searched); later searches are user-driven.
    if (hits.length === 0) void runSearch(query);
  }

  async function onPush() {
    setPushing(true);
    setError(null);
    try {
      const body = selected
        ? { contactId: selected.id }
        : { email: manualEmail.trim() || undefined, phone: manualPhone.trim() || undefined };
      const response = await fetch(`/api/pem-neats/${pemNeatId}/ghl-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        syncedAt?: string;
        filledFields?: number;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(data.error?.message ?? "Sync failed");
      setLastSync({
        syncedAt: data.syncedAt ?? new Date().toISOString(),
        filledFields: data.filledFields ?? filled,
        contactLabel: selected
          ? selected.name
          : [manualEmail.trim(), manualPhone.trim()].filter(Boolean).join(" · "),
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={openDialog}
        disabled={disabled}
        data-testid="pem-neat-sync-ghl"
        title={lastSync ? `Last synced to ${lastSync.contactLabel}` : undefined}
      >
        {lastSync ? "Synced to GHL ✓" : "Sync to GHL"}
      </Button>

      <Dialog open={open} onClose={() => !pushing && setOpen(false)} size="lg">
        <DialogHeader>
          <DialogTitle>Push to GoHighLevel</DialogTitle>
          <DialogDescription>
            Writes the BuilderTrend custom fields to the contact&apos;s &ldquo;JT -&rdquo; custom
            fields in GoHighLevel. {filled} of {total} fields have values; empty fields are sent
            blank.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query);
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GoHighLevel contacts by name, email, or phone"
              aria-label="Search GoHighLevel contacts"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={searching || query.trim().length < 2}
            >
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          {searchError ? <p className="text-sm text-amber-800">{searchError}</p> : null}

          {hits.length > 0 ? (
            <ul
              className="max-h-64 space-y-2 overflow-y-auto"
              role="radiogroup"
              aria-label="Contacts"
            >
              {hits.map((hit) => {
                const isSelected = selected?.id === hit.id;
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelected(isSelected ? null : hit)}
                      className={cn(
                        "w-full rounded-md border p-3 text-left text-sm",
                        isSelected
                          ? "border-[var(--acton-navy)] bg-[var(--acton-gray-50)]"
                          : "border-[var(--acton-border)] hover:bg-[var(--acton-gray-50)]",
                      )}
                    >
                      <span className="font-semibold text-[var(--acton-navy)]">{hit.name}</span>
                      <span className="block text-xs text-[var(--acton-muted)]">
                        {[hit.email, hit.phone, hit.address].filter(Boolean).join(" · ") ||
                          "No email or phone on file"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : !searching && !searchError ? (
            <p className="text-sm text-[var(--acton-muted)]">No matching contacts yet.</p>
          ) : null}

          {!selected ? (
            <fieldset className="space-y-2 rounded-md border border-[var(--acton-border)] p-3">
              <legend className="px-1 text-xs font-semibold text-[var(--acton-muted)] uppercase">
                Or identify the contact directly
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="email"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="Customer email"
                  aria-label="Customer email"
                />
                <Input
                  type="tel"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="Customer phone"
                  aria-label="Customer phone"
                />
              </div>
            </fieldset>
          ) : null}

          {filled === 0 ? (
            <p className="text-sm text-red-800">
              This PEM NEAT has no BuilderTrend field values yet. Generate it first.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton />
          <Button type="button" onClick={onPush} disabled={!canPush}>
            {pushing ? "Pushing…" : "Push to GoHighLevel"}
          </Button>
        </DialogFooter>
      </Dialog>

      {lastSync ? (
        <span className="sr-only" role="status">
          Synced {lastSync.filledFields} fields to GoHighLevel for {lastSync.contactLabel}.
        </span>
      ) : null}
    </>
  );
}
