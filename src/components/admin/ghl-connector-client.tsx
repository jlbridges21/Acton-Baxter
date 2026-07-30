"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { GhlAdminOverview } from "@/lib/connectors/ghl/diagnostics";
import { GhlPipelineBoardClient } from "@/components/admin/ghl-pipeline-board-client";

type Tab = "overview" | "contacts" | "opportunities" | "conversations" | "actions" | "advanced";

type BrowseTab = "contacts" | "opportunities" | "conversations";

type ContactRow = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  addressFormatted?: string | null;
  ownerName?: string | null;
  tags?: string[];
  updatedLabel?: string | null;
};

type ConversationRow = {
  id: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  channel?: string;
  direction?: string;
  preview?: string;
  unreadCount?: number;
  lastActivityLabel?: string | null;
};

type BrowsePayload = {
  type: string;
  rows: unknown[];
  total: number | null;
  page: number;
  pageLimit: number;
  hasMore: boolean;
  filters?: Record<string, unknown>;
  statusMessage?: string | null;
  searchMode?: string | null;
  contactsMatched?: number | null;
};

type PipelineCard = {
  id: string;
  name: string;
  stageCount: number;
};

type AuditRow = Record<string, unknown>;
type PendingRow = Record<string, unknown>;

type ActionsPayload = {
  type: "actions";
  audit: AuditRow[];
  pending: PendingRow[];
};

type LoadError = {
  message: string;
  technical?: string;
};

const PAGE_LIMIT = 25;
/** Acton Feasibility Package pipeline — default Opportunities board. */
const DEFAULT_FEASIBILITY_PIPELINE_ID = "11xV4ZJU0JotklCTFpgw";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "contacts", label: "Contacts" },
  { id: "opportunities", label: "Opportunities" },
  { id: "conversations", label: "Conversations" },
  { id: "actions", label: "Actions" },
  { id: "advanced", label: "Advanced" },
];

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function asString(value: unknown, fallback = "—") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function summarizeState(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, 4);
    if (keys.length === 0) return "—";
    return keys
      .map((k) => {
        const v = obj[k];
        const shown =
          typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : "…";
        return `${k}: ${shown}`;
      })
      .join(" · ");
  }
  return "—";
}

function normalizeBrowseData(
  data: Record<string, unknown> | null | undefined,
): BrowsePayload | null {
  if (!data || typeof data !== "object") return null;
  const type = asString(data.type, "unknown");
  const rowsCandidate = Array.isArray(data.rows)
    ? data.rows
    : Array.isArray(data.contacts)
      ? data.contacts
      : Array.isArray(data.opportunities)
        ? data.opportunities
        : Array.isArray(data.conversations)
          ? data.conversations
          : [];
  return {
    type,
    rows: rowsCandidate,
    total: typeof data.total === "number" ? data.total : null,
    page: typeof data.page === "number" ? data.page : 1,
    pageLimit: typeof data.pageLimit === "number" ? data.pageLimit : PAGE_LIMIT,
    hasMore: Boolean(data.hasMore),
    filters:
      data.filters && typeof data.filters === "object"
        ? (data.filters as Record<string, unknown>)
        : undefined,
    statusMessage: typeof data.statusMessage === "string" ? data.statusMessage : null,
    searchMode: typeof data.searchMode === "string" ? data.searchMode : null,
    contactsMatched: typeof data.contactsMatched === "number" ? data.contactsMatched : null,
  };
}

function normalizeActionsData(payload: Record<string, unknown> | null | undefined): ActionsPayload {
  const nested =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;
  const audit = Array.isArray(nested?.audit)
    ? (nested.audit as AuditRow[])
    : Array.isArray(nested?.entries)
      ? (nested.entries as AuditRow[])
      : Array.isArray(payload?.entries)
        ? (payload.entries as AuditRow[])
        : [];
  const pending = Array.isArray(nested?.pending) ? (nested.pending as PendingRow[]) : [];
  return { type: "actions", audit, pending };
}

function locationLine(
  connection: GhlAdminOverview["connection"],
  health: GhlAdminOverview["health"],
) {
  const name = connection?.location_name || null;
  const id = connection?.location_id || health.locationId || null;
  if (name && id && name !== id) return `${name} (${id})`;
  return name || id || null;
}

function connectionStatusLabel(overall: string, coreCrmOk: boolean) {
  if (overall === "connected" || overall === "healthy") return "Connected";
  // Optional-only gaps (e.g. locations.readonly) should not dominate the CRM header.
  if (overall === "connected_limited" && coreCrmOk) return "Connected";
  if (overall === "connected_limited") return "Connected";
  if (overall === "warning" || overall === "needs_attention") return "Needs Attention";
  if (overall === "reauthorization_required") return "Reauthorization Required";
  if (overall === "not_configured" || overall === "disabled") return "Not Configured";
  return "Offline";
}

function connectionStatusClass(overall: string) {
  if (overall === "connected" || overall === "healthy") return "text-emerald-700";
  if (overall === "connected_limited" || overall === "warning" || overall === "needs_attention") {
    return "text-amber-700";
  }
  if (overall === "not_configured" || overall === "disabled") {
    return "text-[var(--acton-muted)]";
  }
  return "text-red-700";
}

function isBrowseConnected(overall: string) {
  return (
    overall === "connected" ||
    overall === "healthy" ||
    overall === "connected_limited" ||
    overall === "warning" ||
    overall === "needs_attention"
  );
}

function checkOk(checks: GhlAdminOverview["health"]["checks"], name: string) {
  return Boolean(checks.find((c) => c.check === name && c.ok));
}

function ErrorPanel({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: LoadError;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-5">
      <p className="text-sm font-medium text-red-900">{title}</p>
      <div className="mt-3">
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
      {error.technical ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-red-800/80">Technical details</summary>
          <p className="mt-2 text-xs break-words text-red-800/70">{error.technical}</p>
        </details>
      ) : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--acton-border)] px-4 py-10 text-center">
      <p className="text-sm text-[var(--acton-muted)]">{message}</p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="py-10 text-center text-sm text-[var(--acton-muted)]">{label}</div>;
}

function PaginationBar({
  page,
  hasMore,
  total,
  busy,
  onPrev,
  onNext,
}: {
  page: number;
  hasMore: boolean;
  total: number | null;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <p className="text-xs text-[var(--acton-muted)]">
        Page {page}
        {typeof total === "number" ? ` · ${total.toLocaleString()} total` : ""}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={busy || page <= 1} onClick={onPrev}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || !hasMore} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

const VALID_TABS = new Set<Tab>([
  "overview",
  "contacts",
  "opportunities",
  "conversations",
  "actions",
  "advanced",
]);

function shortPipelineLabel(name: string) {
  return (
    name
      .replace(/\s*Pipeline\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

export function GhlConnectorClient({
  initialOverview,
  canWrite = false,
  oauthNotice,
}: {
  initialOverview: GhlAdminOverview;
  canWrite?: boolean;
  oauthNotice?: {
    success?: boolean;
    connectedLocation?: string | null;
    reconnectSuccess?: boolean;
    error?: string | null;
    message?: string | null;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState(initialOverview);
  const initialTab = (() => {
    const t = searchParams.get("tab");
    return t && VALID_TABS.has(t as Tab) ? (t as Tab) : "overview";
  })();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(() =>
    searchParams.get("pipeline"),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(() => {
    if (oauthNotice?.success) {
      return oauthNotice.connectedLocation
        ? `Connected to ${oauthNotice.connectedLocation}.`
        : "GoHighLevel connected successfully.";
    }
    if (oauthNotice?.reconnectSuccess) {
      return "GoHighLevel reconnected successfully.";
    }
    if (oauthNotice?.error) {
      return oauthNotice.message || "OAuth error.";
    }
    return null;
  });
  const [bannerTone, setBannerTone] = useState<"info" | "error">(() =>
    oauthNotice?.error ? "error" : "info",
  );

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [browse, setBrowse] = useState<BrowsePayload | null>(null);
  const [pipelines, setPipelines] = useState<PipelineCard[] | null>(null);
  const [actions, setActions] = useState<ActionsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const requestSeq = useRef(0);
  const health = overview.health;
  const config = overview.config;
  const connection = overview.connection;
  const connected = isBrowseConnected(health.overall);
  const crmAccess = [
    { label: "Contacts", ok: checkOk(health.checks, "contacts") },
    { label: "Opportunities", ok: checkOk(health.checks, "opportunities") },
    { label: "Conversations", ok: checkOk(health.checks, "conversations") },
    { label: "Pipelines", ok: checkOk(health.checks, "pipelines") },
    { label: "Location", ok: checkOk(health.checks, "location") },
    { label: "Calendars", ok: checkOk(health.checks, "calendars") },
  ];
  const statusLabel = connectionStatusLabel(
    health.overall,
    crmAccess.filter((c) => c.label !== "Pipelines").every((c) => c.ok) ||
      checkOk(health.checks, "contacts") ||
      checkOk(health.checks, "opportunities"),
  );
  const statusClass = connectionStatusClass(health.overall);
  const location = locationLine(connection, health);

  const showBanner = useCallback((text: string, tone: "info" | "error" = "info") => {
    setBanner(text);
    setBannerTone(tone);
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const refreshOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/connectors/ghl");
      if (!response.ok) return;
      const data = await response.json();
      setOverview(data);
    } catch (error) {
      console.error("Failed to refresh overview:", error);
    }
  }, []);

  const postAction = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/admin/connectors/ghl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }, []);

  const loadBrowse = useCallback(
    async (tab: BrowseTab, opts?: { page?: number; query?: string; status?: string }) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setLoadError(null);
      try {
        const nextPage = opts?.page ?? 1;
        const body: Record<string, unknown> = {
          action: "browse",
          tab,
          page: nextPage,
          limit: PAGE_LIMIT,
        };
        const q = opts?.query ?? "";
        if (q) body.query = q;
        if (tab === "opportunities") {
          body.status = opts?.status ?? "open";
        }

        const { data } = await postAction(body);
        if (seq !== requestSeq.current) return;

        if (data.result?.pass) {
          const normalized = normalizeBrowseData(data.result.data);
          setBrowse(normalized);
          setPage(normalized?.page ?? nextPage);
        } else {
          setBrowse(null);
          setLoadError({
            message: `Couldn't load ${tab}.`,
            technical: data.result?.message || data.result?.code || undefined,
          });
        }
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setBrowse(null);
        setLoadError({
          message: `Couldn't load ${tab}.`,
          technical: error instanceof Error ? error.message : "Request failed",
        });
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [postAction],
  );

  const loadPipelines = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await postAction({ action: "list_pipelines_for_opportunities" });
      if (seq !== requestSeq.current) return;
      if (data.result?.pass) {
        const list = (data.result.pipelines || []) as PipelineCard[];
        setPipelines(list);
        const urlPipeline = searchParams.get("pipeline");
        const valid = Boolean(urlPipeline && list.some((p) => p.id === urlPipeline));
        if (list.length > 0 && !valid) {
          const first =
            list.find((p) => p.id === DEFAULT_FEASIBILITY_PIPELINE_ID)?.id ?? list[0]!.id;
          setSelectedPipelineId(first);
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", "opportunities");
          params.set("pipeline", first);
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        } else if (urlPipeline && valid) {
          setSelectedPipelineId(urlPipeline);
        }
      } else {
        setPipelines(null);
        setLoadError({
          message: "Couldn't load pipelines.",
          technical: data.result?.message || data.result?.code || undefined,
        });
      }
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setPipelines(null);
      setLoadError({
        message: "Couldn't load pipelines.",
        technical: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [postAction, searchParams, pathname, router]);

  const loadActions = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await postAction({ action: "list_recent_actions", limit: 50 });
      if (seq !== requestSeq.current) return;
      if (data.result?.pass) {
        setActions(normalizeActionsData(data.result));
      } else {
        setActions(null);
        setLoadError({
          message: "Couldn't load actions.",
          technical: data.result?.message || data.result?.code || undefined,
        });
      }
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setActions(null);
      setLoadError({
        message: "Couldn't load actions.",
        technical: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [postAction]);

  const pushCrmUrl = useCallback(
    (tab: Tab, pipelineId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      // Drop oauth flash params from ongoing navigation
      for (const key of [
        "oauth_success",
        "connected_location",
        "reconnect_success",
        "oauth_error",
        "oauth_message",
      ]) {
        params.delete(key);
      }
      if (tab === "overview") params.delete("tab");
      else params.set("tab", tab);
      if (tab === "opportunities" && pipelineId) params.set("pipeline", pipelineId);
      else params.delete("pipeline");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const selectTab = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      setLoadError(null);
      setPage(1);
      if (tab === "overview" || tab === "advanced") {
        setBrowse(null);
        setPipelines(null);
        setActions(null);
      } else if (tab === "actions") {
        setBrowse(null);
        setPipelines(null);
      } else if (tab === "opportunities") {
        setBrowse(null);
        setActions(null);
      } else {
        setPipelines(null);
        setActions(null);
      }
      pushCrmUrl(
        tab,
        tab === "opportunities" ? selectedPipelineId || DEFAULT_FEASIBILITY_PIPELINE_ID : null,
      );
    },
    [pushCrmUrl, selectedPipelineId],
  );

  const selectPipeline = useCallback(
    (pipelineId: string) => {
      setSelectedPipelineId(pipelineId);
      pushCrmUrl("opportunities", pipelineId);
    },
    [pushCrmUrl],
  );

  const effectivePipelineId =
    pipelines && pipelines.length > 0
      ? selectedPipelineId && pipelines.some((p) => p.id === selectedPipelineId)
        ? selectedPipelineId
        : pipelines.some((p) => p.id === DEFAULT_FEASIBILITY_PIPELINE_ID)
          ? DEFAULT_FEASIBILITY_PIPELINE_ID
          : pipelines[0]!.id
      : selectedPipelineId || DEFAULT_FEASIBILITY_PIPELINE_ID;

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (activeTab === "actions") {
        void loadActions();
        return;
      }
      if (activeTab === "opportunities") {
        void loadPipelines();
        return;
      }
      if (activeTab === "contacts" || activeTab === "conversations") {
        setPage(1);
        void loadBrowse(activeTab, {
          page: 1,
          query: debouncedQuery,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, debouncedQuery, loadActions, loadBrowse, loadPipelines]);

  const testConnection = useCallback(async () => {
    setBusy("test_connection");
    try {
      const { data } = await postAction({ action: "test_connection" });
      if (data.result?.pass) {
        const name = data.result.locationName || data.result.locationId || "location verified";
        showBanner(`Connected: ${name}`);
      } else {
        showBanner(data.result?.message || "Connection test failed.", "error");
      }
      await refreshOverview();
    } catch (error) {
      showBanner(error instanceof Error ? error.message : "Connection test failed", "error");
    } finally {
      setBusy(null);
    }
  }, [postAction, refreshOverview, showBanner]);

  const refreshData = useCallback(async () => {
    setBusy("refresh_data");
    try {
      let { data } = await postAction({ action: "refresh_data" });
      const message = String(data.result?.message ?? data.error?.message ?? data.error ?? "");
      const unsupported =
        !data.result ||
        (data.result.pass === false &&
          /unknown|invalid|unsupported|enum|Unrecognized/i.test(message));
      if (unsupported) {
        ({ data } = await postAction({ action: "refresh_reference_cache" }));
      }
      if (data.result?.pass) {
        showBanner(data.result.message || "CRM data refreshed.");
      } else {
        showBanner(data.result?.message || "Refresh failed.", "error");
      }
      await refreshOverview();
    } catch (error) {
      showBanner(error instanceof Error ? error.message : "Refresh failed", "error");
    } finally {
      setBusy(null);
    }
  }, [postAction, refreshOverview, showBanner]);

  const refreshCache = useCallback(async () => {
    setBusy("refresh_cache");
    try {
      const { data } = await postAction({ action: "refresh_reference_cache" });
      if (data.result?.pass) {
        showBanner(data.result.message || "Reference cache refreshed.");
      } else {
        showBanner(data.result?.message || "Cache refresh failed.", "error");
      }
      await refreshOverview();
    } catch (error) {
      showBanner(error instanceof Error ? error.message : "Cache refresh failed", "error");
    } finally {
      setBusy(null);
    }
  }, [postAction, refreshOverview, showBanner]);

  const confirmPending = useCallback(
    async (pendingActionId: string) => {
      setBusy(`confirm:${pendingActionId}`);
      try {
        const { data } = await postAction({
          action: "confirm_admin_action",
          pendingActionId,
        });
        if (data.result?.pass) {
          showBanner(data.result.message || "Action confirmed.");
          await loadActions();
        } else {
          showBanner(data.result?.message || "Could not confirm action.", "error");
        }
      } catch (error) {
        showBanner(error instanceof Error ? error.message : "Confirm failed", "error");
      } finally {
        setBusy(null);
      }
    },
    [loadActions, postAction, showBanner],
  );

  const cancelPending = useCallback(
    async (pendingActionId: string) => {
      setBusy(`cancel:${pendingActionId}`);
      try {
        const { data } = await postAction({
          action: "cancel_admin_action",
          pendingActionId,
        });
        if (data.result?.pass) {
          showBanner(data.result.message || "Action cancelled.");
          await loadActions();
        } else {
          showBanner(data.result?.message || "Could not cancel action.", "error");
        }
      } catch (error) {
        showBanner(error instanceof Error ? error.message : "Cancel failed", "error");
      } finally {
        setBusy(null);
      }
    },
    [loadActions, postAction, showBanner],
  );

  const disconnect = useCallback(async () => {
    if (
      !confirm("Disconnect GoHighLevel? This will require reconnecting to use the integration.")
    ) {
      return;
    }
    setBusy("disconnect");
    try {
      const response = await fetch("/api/admin/connectors/ghl/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (response.ok) {
        showBanner("GoHighLevel disconnected successfully.");
        await refreshOverview();
      } else {
        const data = await response.json().catch(() => ({}));
        showBanner(data.error?.message || "Disconnect failed.", "error");
      }
    } catch (error) {
      showBanner(error instanceof Error ? error.message : "Disconnect failed", "error");
    } finally {
      setBusy(null);
    }
  }, [refreshOverview, showBanner]);

  const retryActive = () => {
    if (activeTab === "actions") {
      void loadActions();
      return;
    }
    if (activeTab === "opportunities") {
      void loadPipelines();
      return;
    }
    if (activeTab === "contacts" || activeTab === "conversations") {
      void loadBrowse(activeTab, {
        page,
        query: debouncedQuery,
      });
    }
  };

  const contactRows = (browse?.rows ?? []) as ContactRow[];
  const conversationRows = (browse?.rows ?? []) as ConversationRow[];

  return (
    <div className="min-h-screen bg-[var(--acton-bg)]">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div>
          <Link
            href="/admin/connectors"
            className="text-sm text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
          >
            ← Connectors
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--acton-fg)]">Acton CRM</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Browse contacts, opportunities, and conversations connected through GoHighLevel.
          </p>
        </div>

        {banner ? (
          <Card
            className={`border-l-4 p-4 ${
              bannerTone === "error" ? "border-red-600 bg-red-50" : "border-sky-600 bg-sky-50"
            }`}
          >
            <p className={`text-sm ${bannerTone === "error" ? "text-red-900" : "text-sky-900"}`}>
              {banner}
            </p>
          </Card>
        ) : null}

        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Connection</CardTitle>
              <CardDescription>
                {config.authMode === "private_integration" ? "Private Integration Token" : "OAuth"}
                {location ? ` · ${location}` : ""}
              </CardDescription>
            </div>
            <div className={`text-sm font-semibold ${statusClass}`}>{statusLabel}</div>
          </div>

          <p className="mt-3 text-sm text-[var(--acton-muted)]">
            Last verified: {formatWhen(health.lastVerifiedAt || connection?.last_verified_at)}
          </p>

          {health.overall === "connected_limited" && health.details ? (
            <p className="mt-1 text-xs text-[var(--acton-muted)]">{health.details}</p>
          ) : null}

          {overview.missingOptionalScopes?.length > 0 ? (
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              Some optional scopes are missing — limited features may be unavailable.
            </p>
          ) : null}

          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium tracking-wide text-[var(--acton-muted)] uppercase">
              CRM Access
            </p>
            <p className="text-sm text-[var(--acton-fg)]">
              {crmAccess.map((item) => (
                <span key={item.label} className="mr-4 inline-flex items-center gap-1">
                  <span>{item.label}</span>
                  <span className={item.ok ? "text-emerald-700" : "text-amber-700"}>
                    {item.ok ? "✓" : "—"}
                  </span>
                </span>
              ))}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={testConnection} disabled={busy === "test_connection"}>
              {busy === "test_connection" ? "Testing…" : "Test Connection"}
            </Button>
            {connected ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => selectTab("contacts")}>
                  Browse Contacts
                </Button>
                <Button size="sm" variant="secondary" onClick={() => selectTab("opportunities")}>
                  Opportunities
                </Button>
                <Button size="sm" variant="secondary" onClick={() => selectTab("conversations")}>
                  Conversations
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={refreshData}
                  disabled={busy === "refresh_data"}
                >
                  {busy === "refresh_data" ? "Refreshing…" : "Refresh Data"}
                </Button>
              </>
            ) : null}

            {config.authMode === "oauth" ? (
              <>
                {!connection ? (
                  <Link href="/api/admin/connectors/ghl/oauth/start">
                    <Button size="sm">Connect GoHighLevel</Button>
                  </Link>
                ) : (
                  <>
                    <Link href="/api/admin/connectors/ghl/reconnect">
                      <Button size="sm" variant="secondary">
                        Reconnect
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={disconnect}
                      disabled={busy === "disconnect"}
                    >
                      {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </>
                )}
              </>
            ) : null}
          </div>

          {overview.guidance.length > 0 ? (
            <div className="mt-4 space-y-1 border-t border-[var(--acton-border)] pt-4">
              <p className="text-xs font-medium text-[var(--acton-muted)]">Guidance</p>
              {overview.guidance.map((item) => (
                <p key={item} className="text-xs text-[var(--acton-muted)]">
                  • {item}
                </p>
              ))}
            </div>
          ) : null}
        </Card>

        {connected ? (
          <Card className="p-6">
            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--acton-border)]">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? "border-sky-600 text-sky-700"
                      : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "overview" ? (
              <div className="space-y-4">
                <p className="text-sm text-[var(--acton-muted)]">
                  Use the tabs to browse Acton CRM records. Open a row for detail pages when you
                  need to review or edit later.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["contacts", "Contacts", "People and owners"],
                      ["opportunities", "Opportunities", "Pipeline deals"],
                      ["conversations", "Conversations", "Inbox threads"],
                    ] as const
                  ).map(([tab, title, desc]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => selectTab(tab)}
                      className="rounded-md border border-[var(--acton-border)] px-4 py-4 text-left transition-colors hover:bg-[var(--acton-bg)]"
                    >
                      <p className="text-sm font-medium text-[var(--acton-fg)]">{title}</p>
                      <p className="mt-1 text-xs text-[var(--acton-muted)]">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "contacts" || activeTab === "conversations" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-[220px] flex-1 text-sm">
                    <span className="mb-1 block text-xs text-[var(--acton-muted)]">Search</span>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={
                        activeTab === "contacts"
                          ? "Name, email, phone, address, city, ZIP…"
                          : "Name, email, phone, or message keyword…"
                      }
                      className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-fg)] outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
                    />
                  </label>
                </div>

                {loading ? (
                  <LoadingState
                    label={
                      activeTab === "conversations" && debouncedQuery
                        ? "Searching GoHighLevel…"
                        : `Loading ${activeTab}…`
                    }
                  />
                ) : null}

                {!loading && loadError ? (
                  <ErrorPanel title={loadError.message} error={loadError} onRetry={retryActive} />
                ) : null}

                {!loading &&
                !loadError &&
                activeTab === "conversations" &&
                browse?.statusMessage ? (
                  <p className="text-xs text-[var(--acton-muted)]">{browse.statusMessage}</p>
                ) : null}

                {!loading && !loadError && activeTab === "contacts" ? (
                  contactRows.length === 0 ? (
                    <EmptyState message="No contacts found." />
                  ) : (
                    <div className="space-y-3">
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[880px] text-left text-sm">
                          <thead className="border-b border-[var(--acton-border)] text-xs text-[var(--acton-muted)]">
                            <tr>
                              <th className="py-2 pr-3 font-medium">Name</th>
                              <th className="py-2 pr-3 font-medium">Email</th>
                              <th className="py-2 pr-3 font-medium">Phone</th>
                              <th className="py-2 pr-3 font-medium">Address</th>
                              <th className="py-2 pr-3 font-medium">Owner</th>
                              <th className="py-2 pr-3 font-medium">Updated</th>
                              <th className="py-2 font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {contactRows.map((row) => (
                              <tr key={row.id} className="border-b border-[var(--acton-border)]/70">
                                <td className="py-3 pr-3 font-medium text-[var(--acton-fg)]">
                                  {row.name || "Untitled"}
                                  {row.tags && row.tags.length > 0 ? (
                                    <span className="mt-1 block text-xs font-normal text-[var(--acton-muted)]">
                                      {row.tags.slice(0, 3).join(", ")}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-3 pr-3 text-[var(--acton-muted)]">
                                  {row.email || "—"}
                                </td>
                                <td className="py-3 pr-3 text-[var(--acton-muted)]">
                                  {row.phone || "—"}
                                </td>
                                <td className="max-w-[240px] py-3 pr-3 text-[var(--acton-muted)]">
                                  {row.addressFormatted ||
                                    [row.city, row.state].filter(Boolean).join(", ") ||
                                    "—"}
                                </td>
                                <td className="py-3 pr-3 text-[var(--acton-muted)]">
                                  {row.ownerName || "—"}
                                </td>
                                <td className="py-3 pr-3 text-[var(--acton-muted)]">
                                  {row.updatedLabel || "—"}
                                </td>
                                <td className="py-3 text-right">
                                  <Link
                                    href={`/admin/connectors/ghl/contacts/${row.id}`}
                                    className="text-sm font-medium text-sky-700 hover:underline"
                                  >
                                    Open
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-2 md:hidden">
                        {contactRows.map((row) => (
                          <div
                            key={row.id}
                            className="rounded-md border border-[var(--acton-border)] px-3 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-[var(--acton-fg)]">
                                  {row.name || "Untitled"}
                                </p>
                                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                                  {row.email || row.phone || "No contact info"}
                                </p>
                                {row.addressFormatted ? (
                                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                                    {row.addressFormatted}
                                  </p>
                                ) : null}
                              </div>
                              <Link
                                href={`/admin/connectors/ghl/contacts/${row.id}`}
                                className="text-sm font-medium text-sky-700"
                              >
                                Open
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                      <PaginationBar
                        page={page}
                        hasMore={Boolean(browse?.hasMore)}
                        total={browse?.total ?? null}
                        busy={loading}
                        onPrev={() => {
                          const next = Math.max(1, page - 1);
                          setPage(next);
                          void loadBrowse("contacts", {
                            page: next,
                            query: debouncedQuery,
                          });
                        }}
                        onNext={() => {
                          const next = page + 1;
                          setPage(next);
                          void loadBrowse("contacts", {
                            page: next,
                            query: debouncedQuery,
                          });
                        }}
                      />
                    </div>
                  )
                ) : null}

                {!loading && !loadError && activeTab === "conversations" ? (
                  conversationRows.length === 0 ? (
                    <EmptyState
                      message={
                        debouncedQuery
                          ? browse?.statusMessage || "No matching conversations."
                          : "No conversations found."
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      <ul className="divide-y divide-[var(--acton-border)] rounded-md border border-[var(--acton-border)]">
                        {conversationRows.map((row) => (
                          <li key={row.id} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-[var(--acton-fg)]">
                                    {row.contactName || "Unknown contact"}
                                  </p>
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                                    {row.channel || "Message"}
                                  </span>
                                  {(row.unreadCount ?? 0) > 0 ? (
                                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">
                                      {row.unreadCount} unread
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 text-xs text-[var(--acton-muted)]">
                                  {[row.contactEmail, row.contactPhone]
                                    .filter(Boolean)
                                    .join(" · ") || "No email/phone on contact"}
                                </p>
                                <p className="mt-1 line-clamp-2 text-sm text-[var(--acton-muted)]">
                                  {row.preview || "No preview"}
                                </p>
                                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                                  {row.lastActivityLabel || "—"}
                                </p>
                              </div>
                              <Link
                                href={`/admin/connectors/ghl/conversations/${row.id}`}
                                className="shrink-0 text-sm font-medium text-sky-700 hover:underline"
                              >
                                Open
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <PaginationBar
                        page={page}
                        hasMore={Boolean(browse?.hasMore)}
                        total={browse?.total ?? null}
                        busy={loading}
                        onPrev={() => {
                          const next = Math.max(1, page - 1);
                          setPage(next);
                          void loadBrowse("conversations", {
                            page: next,
                            query: debouncedQuery,
                          });
                        }}
                        onNext={() => {
                          const next = page + 1;
                          setPage(next);
                          void loadBrowse("conversations", {
                            page: next,
                            query: debouncedQuery,
                          });
                        }}
                      />
                    </div>
                  )
                ) : null}
              </div>
            ) : null}

            {activeTab === "opportunities" ? (
              <div className="space-y-4">
                {loading && !pipelines ? <LoadingState label="Loading pipelines…" /> : null}

                {!loading && loadError && !pipelines ? (
                  <ErrorPanel title={loadError.message} error={loadError} onRetry={retryActive} />
                ) : null}

                {pipelines && pipelines.length === 0 ? (
                  <EmptyState message="No pipelines found." />
                ) : null}

                {pipelines && pipelines.length > 0 ? (
                  <>
                    <div className="flex gap-1 overflow-x-auto border-b border-[var(--acton-border)]">
                      {pipelines.map((pipeline) => (
                        <button
                          key={pipeline.id}
                          type="button"
                          onClick={() => selectPipeline(pipeline.id)}
                          className={`border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                            effectivePipelineId === pipeline.id
                              ? "border-sky-600 text-sky-700"
                              : "border-transparent text-[var(--acton-muted)] hover:text-[var(--acton-fg)]"
                          }`}
                        >
                          {shortPipelineLabel(pipeline.name)}
                        </button>
                      ))}
                    </div>
                    {effectivePipelineId ? (
                      <GhlPipelineBoardClient
                        key={effectivePipelineId}
                        canWrite={canWrite}
                        pipelineId={effectivePipelineId}
                        embedded
                      />
                    ) : (
                      <LoadingState label="Loading pipeline board…" />
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {activeTab === "actions" ? (
              <div className="space-y-6">
                {loading ? <LoadingState label="Loading actions…" /> : null}
                {!loading && loadError ? (
                  <ErrorPanel title={loadError.message} error={loadError} onRetry={retryActive} />
                ) : null}
                {!loading && !loadError ? (
                  <>
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium text-[var(--acton-fg)]">Pending</h3>
                        <p className="text-xs text-[var(--acton-muted)]">
                          Confirm or cancel proposed writes. Detail pages can be used for edits when
                          propose actions are not available yet.
                        </p>
                      </div>
                      {(actions?.pending.length ?? 0) === 0 ? (
                        <EmptyState message="No pending actions." />
                      ) : (
                        <ul className="space-y-2">
                          {actions?.pending.map((item, index) => {
                            const id = asString(
                              item.id ?? item.pendingActionId ?? item.pending_action_id,
                              `pending-${index}`,
                            );
                            const action = asString(item.action ?? item.type, "Action");
                            const resource = asString(
                              item.resourceType ?? item.resource_type ?? item.resource,
                              "resource",
                            );
                            const resourceId = asString(item.resourceId ?? item.resource_id, "");
                            const detailHref =
                              resource === "contact" && resourceId
                                ? `/admin/connectors/ghl/contacts/${resourceId}`
                                : resource === "opportunity" && resourceId
                                  ? `/admin/connectors/ghl/opportunities/${resourceId}`
                                  : resource === "conversation" && resourceId
                                    ? `/admin/connectors/ghl/conversations/${resourceId}`
                                    : null;
                            return (
                              <li
                                key={id}
                                className="rounded-md border border-[var(--acton-border)] px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-[var(--acton-fg)]">
                                      {action}
                                    </p>
                                    <p className="mt-1 text-xs text-[var(--acton-muted)]">
                                      {resource}
                                      {resourceId ? ` · ${resourceId}` : ""}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {detailHref ? (
                                      <Link href={detailHref}>
                                        <Button size="sm" variant="secondary">
                                          Open
                                        </Button>
                                      </Link>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      onClick={() => confirmPending(id)}
                                      disabled={busy === `confirm:${id}`}
                                    >
                                      {busy === `confirm:${id}` ? "Confirming…" : "Confirm"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => cancelPending(id)}
                                      disabled={busy === `cancel:${id}`}
                                    >
                                      {busy === `cancel:${id}` ? "Cancelling…" : "Cancel"}
                                    </Button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>

                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium text-[var(--acton-fg)]">
                          Audit history
                        </h3>
                        <p className="text-xs text-[var(--acton-muted)]">
                          Recent proposed and executed CRM writes.
                        </p>
                      </div>
                      {(actions?.audit.length ?? 0) === 0 ? (
                        <EmptyState message="No audit history yet." />
                      ) : (
                        <ul className="space-y-2">
                          {actions?.audit.map((entry, index) => {
                            const id = asString(entry.id, `audit-${index}`);
                            const user = asString(
                              entry.actorLabel ??
                                entry.user ??
                                entry.actorUserId ??
                                entry.actor_user_id,
                              "System",
                            );
                            const action = asString(entry.action, "action");
                            const resource = asString(
                              entry.resourceType ?? entry.resource_type,
                              "resource",
                            );
                            const resourceId = asString(entry.resourceId ?? entry.resource_id, "");
                            const status = asString(entry.status, "—");
                            const when = formatWhen(
                              asString(
                                entry.createdAt ??
                                  entry.created_at ??
                                  entry.executedAt ??
                                  entry.executed_at ??
                                  entry.proposedAt ??
                                  entry.proposed_at,
                                "",
                              ) || null,
                            );
                            return (
                              <li
                                key={id}
                                className="rounded-md border border-[var(--acton-border)] px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-[var(--acton-fg)]">
                                      {action}{" "}
                                      <span className="font-normal text-[var(--acton-muted)]">
                                        on {resource}
                                        {resourceId ? ` ${resourceId}` : ""}
                                      </span>
                                    </p>
                                    <p className="mt-1 text-xs text-[var(--acton-muted)]">
                                      {user} · {status} · {when}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-2 grid gap-2 text-xs text-[var(--acton-muted)] sm:grid-cols-2">
                                  <p>
                                    <span className="font-medium text-[var(--acton-fg)]">
                                      Before:
                                    </span>{" "}
                                    {summarizeState(entry.beforeState ?? entry.before)}
                                  </p>
                                  <p>
                                    <span className="font-medium text-[var(--acton-fg)]">
                                      After:
                                    </span>{" "}
                                    {summarizeState(entry.afterState ?? entry.after)}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  </>
                ) : null}
              </div>
            ) : null}

            {activeTab === "advanced" ? (
              <div className="space-y-6">
                <section>
                  <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">
                    Test GHL conversation lookup
                  </h3>
                  <p className="mb-3 text-xs text-[var(--acton-muted)]">
                    Safe diagnostics only (no message bodies). Uses the same path as Baxter Q&amp;A.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-[220px] flex-1 text-sm">
                      <span className="mb-1 block text-xs text-[var(--acton-muted)]">
                        Contact name / email / phone
                      </span>
                      <input
                        value={lookupQuery}
                        onChange={(e) => setLookupQuery(e.target.value)}
                        placeholder="e.g. contact name"
                        className="h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--acton-navy)]"
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={lookupBusy || !lookupQuery.trim()}
                      onClick={() => {
                        void (async () => {
                          setLookupBusy(true);
                          setLookupResult(null);
                          try {
                            const { data } = await postAction({
                              action: "test_conversation_lookup",
                              query: lookupQuery.trim(),
                            });
                            const result = data.result as {
                              pass?: boolean;
                              message?: string;
                              data?: Record<string, unknown>;
                            };
                            setLookupResult(
                              JSON.stringify(
                                {
                                  pass: result?.pass,
                                  message: result?.message,
                                  ...(result?.data ?? {}),
                                },
                                null,
                                2,
                              ),
                            );
                          } catch (err) {
                            setLookupResult(
                              err instanceof Error ? err.message : "Lookup diagnostic failed.",
                            );
                          } finally {
                            setLookupBusy(false);
                          }
                        })();
                      }}
                    >
                      {lookupBusy ? "Testing…" : "Run lookup"}
                    </Button>
                  </div>
                  {lookupResult ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-[var(--acton-border)] bg-slate-50 p-3 text-xs text-[var(--acton-fg)]">
                      {lookupResult}
                    </pre>
                  ) : null}
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">
                    Capability checks
                  </h3>
                  <div className="space-y-2">
                    {health.checks.length === 0 ? (
                      <p className="text-sm text-[var(--acton-muted)]">No checks recorded yet.</p>
                    ) : (
                      health.checks.map((check) => (
                        <div
                          key={check.check}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="text-[var(--acton-muted)]">{check.check}</span>
                          <span className={check.ok ? "text-emerald-700" : "text-amber-700"}>
                            {check.ok ? "OK" : check.code || check.message || "Failed"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">Cache status</h3>
                  <div className="space-y-2">
                    {overview.cacheStatus.length === 0 ? (
                      <p className="text-sm text-[var(--acton-muted)]">No cache entries.</p>
                    ) : (
                      overview.cacheStatus.map((cache) => (
                        <div
                          key={cache.resourceType}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="text-[var(--acton-muted)]">{cache.resourceType}</span>
                          <span className={cache.expired ? "text-amber-700" : "text-emerald-700"}>
                            {cache.exists ? (cache.expired ? "Expired" : "Cached") : "Not cached"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={refreshCache}
                    disabled={busy === "refresh_cache"}
                  >
                    {busy === "refresh_cache" ? "Refreshing…" : "Refresh reference cache"}
                  </Button>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">
                    Recent requests
                  </h3>
                  <p className="mb-3 text-xs text-[var(--acton-muted)]">
                    Safe request metadata only — no tokens or response bodies.
                  </p>
                  {(overview.recentRequests ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--acton-muted)]">No recent requests yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(overview.recentRequests ?? []).map((req) => (
                        <div
                          key={req.id}
                          className="rounded-md border border-[var(--acton-border)] px-3 py-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-[var(--acton-fg)]">
                              {req.method} {req.path}
                            </span>
                            <span className={req.ok ? "text-emerald-700" : "text-amber-700"}>
                              {req.statusCode ?? "—"}
                            </span>
                          </div>
                          <p className="mt-1 text-[var(--acton-muted)]">
                            {formatWhen(req.at)} · {req.latencyMs}ms · API {req.apiVersion}
                            {req.errorCode ? ` · ${req.errorCode}` : ""}
                          </p>
                          {!req.ok && (req.errorSummary || req.errorCode) ? (
                            <p className="mt-1 text-[var(--acton-muted)]">
                              Error at {formatWhen(req.at)}
                              {req.errorSummary ? `: ${req.errorSummary}` : ""}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {(overview.missingRequiredScopes.length > 0 ||
                  overview.missingOptionalScopes.length > 0) && (
                  <section>
                    <h3 className="mb-2 text-sm font-medium text-[var(--acton-fg)]">
                      Optional APIs / scopes
                    </h3>
                    {overview.missingRequiredScopes.length > 0 ? (
                      <p className="text-xs text-amber-800">
                        Missing required: {overview.missingRequiredScopes.join(", ")}
                      </p>
                    ) : null}
                    {overview.missingOptionalScopes.length > 0 ? (
                      <p className="mt-1 text-xs text-[var(--acton-muted)]">
                        Missing optional: {overview.missingOptionalScopes.join(", ")}
                      </p>
                    ) : null}
                  </section>
                )}
              </div>
            ) : null}
          </Card>
        ) : (
          <Card className="p-6">
            <CardTitle>Connect Acton CRM</CardTitle>
            <CardDescription className="mt-1">
              Connect GoHighLevel to browse contacts, opportunities, and conversations here.
            </CardDescription>
            {config.authMode === "oauth" && !connection ? (
              <div className="mt-4">
                <Link href="/api/admin/connectors/ghl/oauth/start">
                  <Button size="sm">Connect GoHighLevel</Button>
                </Link>
              </div>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
}
