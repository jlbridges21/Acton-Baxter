"use client";

/**
 * BambooHR in Sam Operations: the connection card (Integrations tab) and the read-only
 * Employees tab. Everything shown from BambooHR carries a source badge and freshness.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  Field,
  Notice,
  aiFetch,
  errorMessage,
  formatDateTime,
  useLoad,
} from "@/components/ai/ui";
import { SourceBadge, SourceFootnote } from "@/components/sources/source-badge";
import type { loadBambooState } from "@/lib/bamboohr/http";
import type { Capability } from "@/lib/bamboohr/capabilities";
import type { EmployeeView } from "@/lib/bamboohr/views";
import { cn } from "@/lib/utils";
import { PersonSelect, SectionHeader, Table, TonePill, td, useFullOps } from "./shared";

type BambooState = Awaited<ReturnType<typeof loadBambooState>>;

function useBamboo() {
  const [state, setState] = useState<BambooState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await aiFetch<BambooState>("/api/integrations/bamboohr"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(reload);
  const run = useCallback(
    async <T,>(cmd: Record<string, unknown>, success?: string): Promise<T | null> => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await aiFetch<{ result: T }>("/api/integrations/bamboohr", {
          method: "POST",
          body: JSON.stringify(cmd),
        });
        if (success) setMessage({ tone: "success", text: success });
        await reload();
        return r.result;
      } catch (e) {
        setMessage({ tone: "error", text: errorMessage(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  return { state, error, busy, message, run, reload };
}

const CAP_TONE: Record<string, "green" | "amber" | "red" | "gray" | "violet"> = {
  working: "green",
  no_permission: "amber",
  scope_not_granted: "amber",
  no_data: "gray",
  unsupported: "violet",
  error: "red",
  disabled: "gray",
};
const CAP_LABEL: Record<string, string> = {
  working: "Working",
  no_permission: "No permission",
  scope_not_granted: "Scope not granted",
  no_data: "No data",
  unsupported: "No public API",
  error: "Error",
  disabled: "Off by design",
};

// ---------------------------------------------------------------------------
// Connection card (Integrations tab)
// ---------------------------------------------------------------------------
export function BambooHRCard() {
  const { state, error, busy, message, run } = useBamboo();
  const params = useSearchParams();
  const [groups, setGroups] = useState<string[]>([]);
  const [custom, setCustom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const connectedParam = params.get("bamboohr_connected");
  const errorParam = params.get("bamboohr_error");
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!state) return <p className="text-sm text-[var(--acton-muted)]">Loading BambooHR…</p>;
  const admin = state.admin;
  if (!admin) return null;
  const conn = admin.connection;
  const live = conn && conn.status !== "disconnected";
  const caps = ((conn?.capabilities as { list?: Capability[] } | undefined)?.list ??
    []) as Capability[];
  const optional = admin.scopeGroups.filter((g) => g.optional);
  const connectHref = `/api/integrations/bamboohr/oauth/start${groups.length ? `?groups=${encodeURIComponent(groups.join(","))}` : ""}`;
  return (
    <section className="space-y-4">
      <SectionHeader
        title="BambooHR"
        description="Read-only connection through the Baxter developer app (OAuth). BambooHR stays the authoritative HR record. Baxter never stores employee records here and cannot change them; everything it shows is labelled as coming from BambooHR."
      />
      {connectedParam ? (
        <Notice tone="success">
          BambooHR connected ({connectedParam}). Run diagnostics to confirm what Baxter can read.
        </Notice>
      ) : null}
      {errorParam ? <Notice tone="error">{errorParam}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              {live ? (
                <>
                  {conn!.companyName ?? conn!.companyDomain}.bamboohr.com · authorized by{" "}
                  {conn!.connectedEmail ?? "the COO"}
                </>
              ) : (
                "Not connected."
              )}
            </CardDescription>
          </div>
          <TonePill
            tone={
              !live
                ? "gray"
                : conn!.status === "connected"
                  ? conn!.missingScopes.length
                    ? "amber"
                    : "green"
                  : "red"
            }
          >
            {!live
              ? "Not connected"
              : conn!.status === "connected"
                ? conn!.missingScopes.length
                  ? "Connected — missing permissions"
                  : "Connected"
                : conn!.status === "reauthorization_required"
                  ? "Needs reauthorization"
                  : "Error"}
          </TonePill>
        </div>

        {admin.configProblems.length ? (
          <Notice tone="warning">
            Set these in Vercel (server environment), then redeploy:{" "}
            <strong>{admin.configProblems.join(", ")}</strong>.
          </Notice>
        ) : null}

        <div className="rounded-md bg-[var(--acton-gray-50)] p-3 text-sm">
          <p className="font-semibold text-[var(--acton-navy)]">
            Redirect URI for the BambooHR Developer Portal
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-xs break-all">
              {admin.redirectUri || "Set APP_BASE_URL or BAMBOOHR_REDIRECT_URI"}
            </code>
            {admin.redirectUri ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(admin.redirectUri);
                  setCopied(true);
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? "Copied" : "Copy"}
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            It must match exactly — no extra slash, same capitalization.
          </p>
        </div>

        {live ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-[var(--acton-muted)] uppercase">
                Granted scopes
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {conn!.grantedScopes.map((s) => (
                  <code
                    key={s}
                    className="rounded bg-[var(--acton-gray-100)] px-1.5 py-0.5 text-xs"
                  >
                    {s}
                  </code>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--acton-muted)] uppercase">
                Missing scopes
              </dt>
              <dd className="mt-1 text-sm">
                {conn!.missingScopes.length ? conn!.missingScopes.join(", ") : "None"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--acton-muted)] uppercase">
                Stays connected
              </dt>
              <dd className="mt-1">
                {conn!.hasRefreshToken
                  ? `Yes — token refreshed ${formatDateTime(conn!.lastRefreshAt)}`
                  : "No refresh token (offline_access not granted)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--acton-muted)] uppercase">
                Last successful request
              </dt>
              <dd className="mt-1">{formatDateTime(conn!.lastSuccessAt)}</dd>
            </div>
            {conn!.lastError ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-[var(--acton-muted)] uppercase">
                  Last error
                </dt>
                <dd className="mt-1 text-red-800">
                  {conn!.lastError}{" "}
                  {conn!.lastErrorAt ? `(${formatDateTime(conn!.lastErrorAt)})` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {state.access.canManageConnection ? (
          <div className="space-y-3">
            <fieldset>
              <legend className="text-sm font-semibold text-[var(--acton-navy)]">
                Optional permissions to request
              </legend>
              <p className="text-xs text-[var(--acton-muted)]">
                Least privilege: core read scopes are always requested; add these only if needed. No
                write, pay, ID, or protected-information scopes are ever requested.
              </p>
              <div className="mt-2 space-y-1">
                {optional.map((g) => (
                  <label key={g.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={groups.includes(g.key)}
                      onChange={(e) =>
                        setGroups((p) =>
                          e.target.checked ? [...p, g.key] : p.filter((x) => x !== g.key),
                        )
                      }
                    />
                    <span>
                      <strong>{g.label}</strong>{" "}
                      <code className="text-xs">{g.scopes.join(" ")}</code> — {g.why}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              {admin.configProblems.length ? (
                <Button disabled>{live ? "Reconnect" : "Connect BambooHR"}</Button>
              ) : (
                <a
                  href={connectHref}
                  className="inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--acton-navy-dark)]"
                >
                  {live ? "Reconnect / change permissions" : "Connect BambooHR"}
                </a>
              )}
              {live ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run({ op: "diagnostics" }, "Diagnostics finished.")}
                  >
                    Test & diagnose
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !conn!.hasRefreshToken}
                    onClick={() => run({ op: "refresh" }, "Access token refreshed.")}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden /> Refresh token
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Disconnect BambooHR? Stored tokens are deleted and Sam loses access until the COO reconnects.",
                        )
                      )
                        void run({ op: "disconnect" }, "BambooHR disconnected.");
                    }}
                  >
                    Disconnect
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--acton-muted)]">
            Only the COO connects or disconnects BambooHR (the COO controls system access).
          </p>
        )}
        {!state.access.canManageConnection && live && state.access.canViewAll ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => run({ op: "diagnostics" }, "Diagnostics finished.")}
          >
            Test & diagnose
          </Button>
        ) : null}
      </Card>

      {live ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>What Baxter can read</CardTitle>
            <span className="text-xs text-[var(--acton-muted)]">
              {conn!.capabilitiesCheckedAt
                ? `Checked ${formatDateTime(conn!.capabilitiesCheckedAt)}`
                : "Not checked yet — run Test & diagnose"}
            </span>
          </div>
          <Table
            head={["Capability", "Status", "Endpoint", "Detail"]}
            empty="Run Test & diagnose to check each capability with a safe read-only request."
          >
            {caps.map((c) => (
              <tr key={c.key}>
                <td className={td}>{c.label}</td>
                <td className={td}>
                  <TonePill tone={CAP_TONE[c.status] ?? "gray"}>
                    {CAP_LABEL[c.status] ?? c.status}
                  </TonePill>
                </td>
                <td className={cn(td, "text-xs whitespace-nowrap")}>
                  <code>{c.endpoint}</code>
                  {c.scope ? (
                    <span className="block text-[var(--acton-muted)]">{c.scope}</span>
                  ) : null}
                </td>
                <td className={cn(td, "text-xs")}>{c.detail}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}

      {live ? (
        <Card className="space-y-3">
          <CardTitle>Custom fields Baxter may read</CardTitle>
          <CardDescription>
            Chosen by the COO. Use BambooHR field names or aliases (see the Fields capability).
            Sensitive-looking fields — pay, IDs, birth dates, home address, medical, demographics —
            are always refused.
          </CardDescription>
          <Field label="Allowed custom fields (comma separated)" htmlFor="bh-custom">
            <Input
              id="bh-custom"
              value={custom ?? admin.readableCustomFields.join(", ")}
              disabled={!state.access.canManageConnection}
              onChange={(e) => setCustom(e.target.value)}
            />
          </Field>
          {state.access.canManageConnection ? (
            <Button
              size="sm"
              disabled={busy || custom === null}
              onClick={async () =>
                (await run(
                  {
                    op: "custom_fields",
                    fields: (custom ?? "")
                      .split(",")
                      .map((f) => f.trim())
                      .filter(Boolean),
                  },
                  "Saved.",
                )) !== null && setCustom(null)
              }
            >
              Save
            </Button>
          ) : null}
        </Card>
      ) : null}

      {live && state.access.canManageMappings ? (
        <IdentityLinks state={state} busy={busy} run={run} />
      ) : null}

      <Card className="space-y-2">
        <CardTitle>BambooHR updates</CardTitle>
        <CardDescription>
          Off. Writing to BambooHR will be enabled only after leadership approves the onboarding
          SOPs — and every write will then need a CEO/COO approval bound to the exact change, a
          preview, idempotent execution, read-back verification, and audit logging.
        </CardDescription>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {admin.plannedWrites.map((w) => (
            <li key={w.key} className="flex items-center gap-2">
              <TonePill tone="gray">Off</TonePill> {w.label}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function IdentityLinks({
  state,
  busy,
  run,
}: {
  state: BambooState;
  busy: boolean;
  run: (cmd: Record<string, unknown>, success?: string) => Promise<unknown>;
}) {
  const { full } = useFullOps();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const links = state.admin?.links ?? [];
  const open = links.filter((l) => l.status === "suggested");
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Baxter ↔ BambooHR identity links</CardTitle>
          <CardDescription>
            Employees can see their own BambooHR record only after a link is confirmed. Links are
            suggested from exact work-email matches — never from names — and a person must confirm
            each one.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => run({ op: "suggest_links" }, "Suggestions updated.")}
        >
          Suggest from work emails
        </Button>
      </div>
      {open.some((l) => l.note.startsWith("Ambiguous")) ? (
        <Notice tone="warning">
          Some Baxter accounts match more than one BambooHR record. Confirm the right one; the
          others will be rejected.
        </Notice>
      ) : null}
      <Table
        head={["Baxter account", "BambooHR employee", "Match", "Status", ""]}
        empty="No links yet. Use “Suggest from work emails” or link someone manually below."
      >
        {links
          .filter((l) => l.status !== "rejected")
          .map((l) => (
            <tr key={l.id}>
              <td className={td}>{l.profileName ?? "Unknown account"}</td>
              <td className={td}>
                #{l.employeeId}
                {l.workEmail ? (
                  <span className="block text-xs text-[var(--acton-muted)]">{l.workEmail}</span>
                ) : null}
              </td>
              <td className={cn(td, "text-xs")}>
                {l.method === "email" ? "Work email" : "Manual"}
                {l.note ? <span className="block text-[var(--acton-muted)]">{l.note}</span> : null}
              </td>
              <td className={td}>
                <TonePill tone={l.status === "confirmed" ? "green" : "amber"}>
                  {l.status === "confirmed" ? "Confirmed" : "Suggested"}
                </TonePill>
              </td>
              <td className={td}>
                <span className="flex gap-1">
                  {l.status === "suggested" ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => run({ op: "confirm_link", linkId: l.id }, "Link confirmed.")}
                    >
                      Confirm
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { op: "reject_link", linkId: l.id },
                        l.status === "confirmed" ? "Unlinked." : "Rejected.",
                      )
                    }
                  >
                    {l.status === "confirmed" ? "Unlink" : "Reject"}
                  </Button>
                </span>
              </td>
            </tr>
          ))}
      </Table>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <Field label="Baxter account" htmlFor="bh-link-profile">
          <PersonSelect
            id="bh-link-profile"
            profiles={full?.profiles ?? []}
            value={profileId}
            onChange={setProfileId}
          />
        </Field>
        <Field label="BambooHR employee id" htmlFor="bh-link-emp">
          <Input
            id="bh-link-emp"
            inputMode="numeric"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Button
          disabled={busy || !profileId || !employeeId}
          onClick={async () =>
            (await run(
              { op: "confirm_link", profileId, employeeId, note: "Linked manually" },
              "Linked.",
            )) !== null && setEmployeeId("")
          }
        >
          Link
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Employees tab
// ---------------------------------------------------------------------------
type SearchResult = {
  data: {
    employees: Array<{ id: string; name: string; jobTitle: string | null; status: string | null }>;
    total: number | null;
    nextCursor: string | null;
  };
  source: EmployeeView["profile"]["source"];
};

export function EmployeesTab() {
  const { state } = useBamboo();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get("employee"));
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setSearching(true);
    setError(null);
    try {
      setResults(
        await aiFetch<SearchResult>(
          `/api/integrations/bamboohr/employees?q=${encodeURIComponent(q.trim())}`,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  if (!state) return <p className="text-sm text-[var(--acton-muted)]">Loading…</p>;
  if (!state.connection || state.connection.status !== "connected") {
    return (
      <EmptyState title="BambooHR isn't connected">
        {state.connection?.status === "reauthorization_required"
          ? "The connection needs to be reauthorized by the COO (Integrations tab)."
          : "The COO connects BambooHR on the Integrations tab. Until then, no employee records are shown."}
      </EmptyState>
    );
  }
  if (!state.access.canViewAll) {
    return (
      <div className="space-y-4">
        <SectionHeader
          title="My BambooHR record"
          description="Your own record only. Other employees' information is restricted."
        />
        {state.access.linked ? (
          <EmployeePanel id="me" />
        ) : (
          <Notice tone="info">
            Your Baxter account isn&apos;t linked to a BambooHR record yet. HR confirms links on the
            Integrations tab.
          </Notice>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Employees"
        description="Read-only view of permitted BambooHR fields. Every lookup is logged. Pay, IDs, birth dates, home address, and other sensitive fields are never retrieved."
        actions={<SourceBadge provider="bamboohr" />}
      />
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input
          aria-label="Search employees by first or last name"
          placeholder="First or last name"
          className="w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" disabled={searching}>
          <Search className="h-4 w-4" aria-hidden />{" "}
          {searching ? "Searching…" : q.trim() ? "Search" : "List employees"}
        </Button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div>
          {results ? (
            <>
              <ul className="divide-y divide-[var(--acton-border)] overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white">
                {results.data.employees.length === 0 ? (
                  <li className="p-3 text-sm text-[var(--acton-muted)]">No employees match.</li>
                ) : null}
                {results.data.employees.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(e.id)}
                      aria-current={selected === e.id ? "true" : undefined}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-[var(--acton-gray-50)]",
                        selected === e.id && "bg-[var(--acton-gray-50)]",
                      )}
                    >
                      <span className="font-medium text-[var(--acton-navy)]">{e.name}</span>
                      <span className="block text-xs text-[var(--acton-muted)]">
                        {e.jobTitle ?? "—"}
                        {e.status && e.status !== "Active" ? ` · ${e.status}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <SourceFootnote source={results.source} />
            </>
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">Search or list employees to begin.</p>
          )}
        </div>
        <div>
          {selected ? (
            <EmployeePanel id={selected} key={selected} />
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              Select an employee to see their permitted BambooHR details.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeePanel({ id }: { id: string }) {
  const [view, setView] = useState<EmployeeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setView(
        await aiFetch<EmployeeView>(
          `/api/integrations/bamboohr/employees/${encodeURIComponent(id)}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!view) return <p className="text-sm text-[var(--acton-muted)]">Loading from BambooHR…</p>;
  const name =
    view.profile.data.groups
      .find((g) => g.key === "basic")
      ?.fields.find((f) => f.id === "displayName")?.value ?? `Employee #${view.employeeId}`;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {view.self ? "Your record" : `BambooHR employee #${view.employeeId}`}
          </CardDescription>
        </div>
        <SourceBadge
          provider="bamboohr"
          recordType="Employee profile"
          freshness={view.profile.source.freshness}
          retrievedAt={view.profile.source.retrievedAt}
          detailed
        />
      </div>
      {view.profile.data.groups
        .filter((g) => g.key !== "basic" || g.fields.length > 1)
        .map((g) => (
          <section key={g.key}>
            <h3 className="mb-1 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
              {g.label}
            </h3>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {g.fields.map((f) => (
                <div
                  key={f.id}
                  className="flex justify-between gap-2 border-b border-[var(--acton-border)] py-1"
                >
                  <dt className="text-[var(--acton-muted)]">{f.label}</dt>
                  <dd className="text-right text-[var(--acton-navy)]">
                    {f.value ?? <span className="text-[var(--acton-muted)]">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      {view.profile.data.notReturned.length ? (
        <p className="text-xs text-[var(--acton-muted)]">
          {view.profile.data.notReturned.length} field(s) weren&apos;t returned by BambooHR —
          they&apos;re either empty or restricted for the connected account (BambooHR doesn&apos;t
          say which).
        </p>
      ) : null}
      <SourceFootnote source={view.profile.source} />
      {view.onboarding ? (
        <section>
          <h3 className="mb-1 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
            Onboarding (BambooHR)
          </h3>
          {view.onboarding.data ? (
            view.onboarding.data.experiences.length ? (
              <ul className="space-y-1 text-sm">
                {view.onboarding.data.experiences.map((e) => (
                  <li key={e.id}>
                    Onboarding experience #{e.id}:{" "}
                    <TonePill
                      tone={
                        e.status === "completed"
                          ? "green"
                          : e.status === "cancelled"
                            ? "gray"
                            : "amber"
                      }
                    >
                      {e.status}
                    </TonePill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--acton-muted)]">
                No onboarding experiences are visible for this employee.
              </p>
            )
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              {"problem" in view.onboarding ? view.onboarding.problem : "Unavailable."}
            </p>
          )}
          <SourceFootnote source={view.onboarding.source} />
        </section>
      ) : null}
      {view.files ? (
        <section>
          <h3 className="mb-1 text-xs font-bold tracking-wide text-[var(--acton-muted)] uppercase">
            Files in BambooHR (names only)
          </h3>
          {view.files.data ? (
            view.files.data.categories.filter((c) => c.files.length).length ? (
              <ul className="space-y-2 text-sm">
                {view.files.data.categories
                  .filter((c) => c.files.length)
                  .map((c) => (
                    <li key={c.name}>
                      <span className="font-medium">{c.name}</span>
                      <ul className="ml-4 list-disc text-[var(--acton-muted)]">
                        {c.files.map((f, i) => (
                          <li key={`${f.name}-${i}`}>
                            {f.name}
                            {f.dateCreated ? ` · ${f.dateCreated.slice(0, 10)}` : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--acton-muted)]">No files visible.</p>
            )
          ) : (
            <p className="text-sm text-[var(--acton-muted)]">
              {"problem" in view.files ? view.files.problem : "Unavailable."}
            </p>
          )}
          <SourceFootnote source={view.files.source} />
        </section>
      ) : null}
    </Card>
  );
}
