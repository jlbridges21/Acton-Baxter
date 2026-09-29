"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InventoryVocabKind, InventoryVocabValue } from "@/lib/inventory/types";

type Props = {
  statuses: InventoryVocabValue[];
  storageStates: InventoryVocabValue[];
};

export function InventorySettingsClient({ statuses, storageStates }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--acton-navy)]">Inventory settings</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Statuses and out-of-storage values used on the inventory table. Deleting a value that
          items still use asks for a replacement first.
        </p>
      </div>
      <VocabEditor kind="status" title="Statuses" values={statuses} />
      <VocabEditor kind="storage" title="Out of storage" values={storageStates} />
    </div>
  );
}

function VocabEditor({
  kind,
  title,
  values,
}: {
  kind: InventoryVocabKind;
  title: string;
  values: InventoryVocabValue[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sorted = [...values].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  async function send(url: string, method: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? "Something went wrong");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-md border border-[var(--acton-border)] bg-white">
      <h2 className="border-b border-[var(--acton-border)] px-4 py-3 text-lg font-semibold text-[var(--acton-navy)]">
        {title}
      </h2>
      <ul>
        {sorted.map((value, index) => (
          <li
            key={value.id}
            className="flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] px-4 py-2 text-sm"
          >
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "PATCH", {
                  label: String(data.get("label") ?? ""),
                });
              }}
            >
              <Input
                name="label"
                defaultValue={value.label}
                aria-label={`${title} label`}
                className="h-9"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                Save
              </Button>
            </form>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending || index === 0}
              onClick={() =>
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "PATCH", {
                  direction: "up",
                })
              }
            >
              Up
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending || index === sorted.length - 1}
              onClick={() =>
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "PATCH", {
                  direction: "down",
                })
              }
            >
              Down
            </Button>
            <Button
              type="button"
              size="sm"
              variant={value.isDefault ? "primary" : "secondary"}
              disabled={pending || value.isDefault}
              onClick={() =>
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "PATCH", {
                  isDefault: true,
                })
              }
            >
              {value.isDefault ? "Default" : "Make default"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "PATCH", {
                  isActive: !value.isActive,
                })
              }
            >
              {value.isActive ? "Active" : "Hidden"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => {
                const others = sorted.filter((candidate) => candidate.id !== value.id);
                const replacement = window.prompt(
                  `Delete “${value.label}”? If items use it, enter the label to move them to. Leave blank to delete only when nothing uses it.`,
                  others[0]?.label ?? "",
                );
                if (replacement === null) return;
                const match = others.find(
                  (candidate) => candidate.label.toLowerCase() === replacement.trim().toLowerCase(),
                );
                void send(`/api/admin/inventory-vocab/${kind}/${value.id}`, "DELETE", {
                  reassignToId: match?.id,
                });
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2 border-t border-[var(--acton-border)] px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = label.trim();
          if (!next) return;
          void send("/api/admin/inventory-vocab", "POST", { kind, label: next }).then(() =>
            setLabel(""),
          );
        }}
      >
        <Input
          aria-label={`New ${title} label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="New label"
          className="h-9 max-w-xs"
        />
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </form>
    </section>
  );
}
