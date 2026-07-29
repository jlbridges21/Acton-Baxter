"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

type DetailResponse = {
  result?: {
    pass?: boolean;
    message?: string;
    data?: {
      contact: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address1?: string | null;
        city: string | null;
        state: string | null;
        postalCode?: string | null;
        country?: string | null;
        addressFormatted?: string | null;
        addressMultiline?: string | null;
        addressStatus?: string | null;
        source?: string | null;
        dateAddedLabel?: string | null;
        ownerName: string | null;
        tags: string[];
        updatedLabel: string | null;
        customFields: Array<{ id: string; name: string; value: string }>;
      };
      opportunities: Array<{
        id: string;
        name: string;
        pipelineName: string | null;
        stageName: string | null;
        valueLabel: string | null;
        ownerName: string | null;
        status: string;
      }>;
      appointments: Array<{
        id: string;
        title: string;
        startLabel: string | null;
        assigneeName: string | null;
      }>;
      conversations: Array<{
        id: string;
        channel: string;
        preview: string;
        lastActivityLabel: string | null;
      }>;
      pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
    };
  };
};

export function GhlContactDetailClient({ canWrite }: { canWrite: boolean }) {
  const params = useParams<{ contactId: string }>();
  const contactId = params.contactId;
  const [data, setData] = useState<NonNullable<
    NonNullable<DetailResponse["result"]>["data"]
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<{
    id: string;
    summary: string;
  } | null>(null);
  const [editCity, setEditCity] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_contact_detail", contactId }),
      });
      const json = (await response.json()) as DetailResponse;
      if (!json.result?.pass || !json.result.data) {
        setError(json.result?.message || "Couldn't load contact.");
        setData(null);
        return;
      }
      setData(json.result.data);
      setEditCity(json.result.data.contact.city || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load contact.");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const proposeCityUpdate = async () => {
    if (!data || !canWrite) return;
    setBusy("propose");
    setBanner(null);
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose_admin_action",
          actionType: "update_contact_fields",
          resourceId: data.contact.id,
          resourceName: data.contact.name,
          proposedChanges: { city: editCity },
        }),
      });
      const json = await response.json();
      if (json.result?.pass && json.result.pending) {
        setPendingPreview({
          id: json.result.pending.id,
          summary: `City: ${data.contact.city || "(empty)"} → ${editCity || "(empty)"}`,
        });
        setBanner("Confirm the GoHighLevel update below.");
      } else {
        setBanner(json.result?.message || "Could not prepare update.");
      }
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not prepare update.");
    } finally {
      setBusy(null);
    }
  };

  const confirmPending = async () => {
    if (!pendingPreview) return;
    setBusy("confirm");
    try {
      const response = await fetch("/api/admin/connectors/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_admin_action",
          pendingActionId: pendingPreview.id,
        }),
      });
      const json = await response.json();
      setBanner(json.result?.message || (json.result?.pass ? "Updated." : "Update failed."));
      if (json.result?.pass) {
        setPendingPreview(null);
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  const cancelPending = async () => {
    if (!pendingPreview) return;
    await fetch("/api/admin/connectors/ghl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel_admin_action",
        pendingActionId: pendingPreview.id,
      }),
    });
    setPendingPreview(null);
    setBanner("Cancelled. No GoHighLevel changes were made.");
  };

  if (loading) {
    return <p className="p-6 text-sm text-[var(--acton-muted)]">Loading contact…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-700">{error || "Contact not found."}</p>
        <Button onClick={() => void load()} variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  const c = data.contact;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link
          href="/admin/connectors/ghl"
          className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
        >
          ← Acton CRM
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-fg)]">{c.name}</h1>
        <p className="text-sm text-[var(--acton-muted)]">
          Contact · Updated {c.updatedLabel || "—"}
        </p>
      </div>

      {banner ? (
        <Card className="border-l-4 border-sky-600 bg-sky-50 p-4">
          <p className="text-sm text-sky-900">{banner}</p>
        </Card>
      ) : null}

      {pendingPreview ? (
        <Card className="space-y-3 p-4">
          <CardTitle>Confirm GoHighLevel update</CardTitle>
          <CardDescription>{c.name}</CardDescription>
          <p className="text-sm text-[var(--acton-fg)]">{pendingPreview.summary}</p>
          <div className="flex gap-2">
            <Button onClick={() => void confirmPending()} disabled={busy === "confirm"}>
              Confirm
            </Button>
            <Button variant="secondary" onClick={() => void cancelPending()}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <CardTitle>Contact</CardTitle>
          {c.email ? <Field label="Email" value={c.email} /> : null}
          {c.phone ? <Field label="Phone" value={c.phone} /> : null}
          <AddressBlock
            multiline={c.addressMultiline ?? null}
            formatted={c.addressFormatted ?? null}
            status={c.addressStatus ?? null}
          />
        </Card>

        <Card className="space-y-2 p-4">
          <CardTitle>CRM</CardTitle>
          <Field label="Owner" value={c.ownerName || "Unassigned"} />
          <Field label="Source" value={c.source || "—"} />
          {c.tags.length ? <Field label="Tags" value={c.tags.join(", ")} /> : null}
          <Field label="Created" value={c.dateAddedLabel || "—"} />
          <Field label="Updated" value={c.updatedLabel || "—"} />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <CardTitle>Edit</CardTitle>
          {canWrite ? (
            <>
              <label className="block text-sm">
                <span className="text-[var(--acton-muted)]">City</span>
                <input
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--acton-border)] px-3 py-2 text-sm"
                />
              </label>
              <Button
                size="sm"
                onClick={() => void proposeCityUpdate()}
                disabled={busy === "propose" || editCity === (c.city || "")}
              >
                Propose city update
              </Button>
            </>
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              CRM updates through Baxter are currently restricted to admins.
            </p>
          )}
        </Card>
      </div>

      {data.contact.customFields.length > 0 ? (
        <Card className="p-4">
          <CardTitle className="mb-3">Custom fields</CardTitle>
          <div className="grid gap-2 md:grid-cols-2">
            {data.contact.customFields.map((f) => (
              <Field key={f.id} label={f.name} value={f.value} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <CardTitle className="mb-3">Opportunities</CardTitle>
        {data.opportunities.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No opportunities.</p>
        ) : (
          <ul className="space-y-3">
            {data.opportunities.map((o) => (
              <li key={o.id} className="rounded border border-[var(--acton-border)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--acton-fg)]">{o.name}</p>
                    <p className="text-[var(--acton-muted)]">
                      {[o.pipelineName, o.stageName].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="text-[var(--acton-muted)]">
                      {[o.valueLabel, o.ownerName ? `Owner: ${o.ownerName}` : null, o.status]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Link
                    href={`/admin/connectors/ghl/opportunities/${o.id}`}
                    className="text-[var(--acton-navy)] hover:underline"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <CardTitle className="mb-3">Upcoming appointments</CardTitle>
        {data.appointments.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No upcoming appointments.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.appointments.map((a) => (
              <li key={a.id}>
                <span className="font-medium text-[var(--acton-fg)]">{a.title}</span>
                <span className="text-[var(--acton-muted)]">
                  {" "}
                  · {a.startLabel || "—"}
                  {a.assigneeName ? ` · ${a.assigneeName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <CardTitle className="mb-3">Conversations</CardTitle>
        {data.conversations.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No recent conversations.</p>
        ) : (
          <ul className="space-y-3">
            {data.conversations.map((conv) => (
              <li key={conv.id} className="text-sm">
                <Link
                  href={`/admin/connectors/ghl/conversations/${conv.id}`}
                  className="font-medium text-[var(--acton-navy)] hover:underline"
                >
                  {conv.channel}
                </Link>
                <p className="text-[var(--acton-muted)]">{conv.preview || "No preview"}</p>
                <p className="text-xs text-[var(--acton-muted)]">{conv.lastActivityLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddressBlock({
  multiline,
  formatted,
  status,
}: {
  multiline: string | null;
  formatted: string | null;
  status: string | null;
}) {
  const text = multiline || formatted;
  const copyValue = formatted || multiline?.replace(/\n/g, ", ") || "";

  if (!text) {
    return (
      <div className="text-sm">
        <div className="text-[var(--acton-muted)]">Address</div>
        <div className="text-[var(--acton-fg)]">No address saved in GoHighLevel.</div>
        {status ? (
          <div className="mt-0.5 text-xs text-[var(--acton-muted)]">Status: {status}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[var(--acton-muted)]">Address</div>
        <button
          type="button"
          className="text-xs text-[var(--acton-navy)] hover:underline"
          onClick={() => {
            void navigator.clipboard.writeText(copyValue);
          }}
        >
          Copy
        </button>
      </div>
      <div className="whitespace-pre-line text-[var(--acton-fg)]">{text}</div>
      {status === "loaded_missing_street" ? (
        <div className="mt-0.5 text-xs text-[var(--acton-muted)]">
          City/region present; no street address saved.
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-[var(--acton-muted)]">{label}</div>
      <div className="text-[var(--acton-fg)]">{value}</div>
    </div>
  );
}
