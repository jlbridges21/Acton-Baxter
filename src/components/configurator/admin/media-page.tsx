"use client";

/* eslint-disable @next/next/no-img-element -- full-size preview */

import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { classifyFilename } from "@/lib/configurator/filename-classifier";
import { parseSlotKey, ROLE_LABELS } from "@/lib/configurator/render";
import type { AdminAsset } from "@/lib/configurator/server";
import { INTERIOR_ROLES, type AssetClassification, type Catalog } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Field, Panel, Pill, TextInput, Thumb, UploadButton, inputClass } from "./admin-ui";

type ReportEntry = { model?: string; message: string; file?: string };
type ImportReport = {
  generatedAt: string;
  models?: {
    id: string;
    name: string;
    folder: string;
    images: { required: number; mapped: number; missing: number };
  }[];
  images?: {
    localFiles: number;
    legacyFiles: number;
    mappedSlots: number;
    floorplans: number;
    unusedButImported: number;
    duplicates: ReportEntry[];
  };
  missingRenders?: ReportEntry[];
  uncertainMappings?: ReportEntry[];
  pricing?: {
    itemsImported: number;
    itemsWithoutLegacyPrice: ReportEntry[];
    inconsistencies: ReportEntry[];
    note: string;
  };
  regions?: { cities: number; note: string; flags: string[] };
  legacyDataIssues?: ReportEntry[];
  integrations?: string[];
};

function usageOf(catalog: Catalog, assetId: string): string[] {
  const out: string[] = [];
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  for (const m of catalog.models) {
    for (const [key, id] of Object.entries(m.renders)) {
      if (id !== assetId) continue;
      const slot = parseSlotKey(key);
      if (!slot) continue;
      out.push(
        slot.type === "ext"
          ? `${m.name} · ${styleName(slot.styleId)} exterior · ${slot.variant === "porch" ? "porch · " : ""}${slot.ceiling} ft`
          : slot.type === "int"
            ? `${m.name} · ${styleName(slot.styleId)} · ${ROLE_LABELS[slot.role]} · ${slot.ceiling} ft`
            : `${m.name} · ${styleName(slot.styleId)} · ${m.bathrooms.find((b) => b.id === slot.bathroomId)?.name ?? "bathroom"}`,
      );
    }
    if (m.floorplans.standard === assetId) out.push(`${m.name} · floorplan`);
    if (m.floorplans.mirror === assetId) out.push(`${m.name} · mirrored floorplan`);
  }
  for (const s of catalog.styles)
    if (s.detailsAssetId === assetId) out.push(`${s.name} · style details board`);
  return out;
}

export function MediaPage({ report }: { report: ImportReport | null }) {
  const { catalog, assets, uploadImage } = useAdmin();
  const [tab, setTab] = useState<"library" | "report">("library");
  const [query, setQuery] = useState("");
  const [modelId, setModelId] = useState("all");
  const [kind, setKind] = useState("all");
  const [usage, setUsage] = useState<"all" | "used" | "unused" | "review">("all");
  const [open, setOpen] = useState<AdminAsset | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const usedIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of catalog.models) {
      Object.values(m.renders).forEach((id) => set.add(id));
      if (m.floorplans.standard) set.add(m.floorplans.standard);
      if (m.floorplans.mirror) set.add(m.floorplans.mirror);
    }
    for (const s of catalog.styles) if (s.detailsAssetId) set.add(s.detailsAssetId);
    return set;
  }, [catalog]);

  const list = assets
    .filter(
      (a) =>
        !query || `${a.originalName} ${a.provenance}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((a) => modelId === "all" || a.classification?.modelId === modelId)
    .filter((a) => kind === "all" || a.classification?.kind === kind)
    .filter((a) =>
      usage === "all"
        ? true
        : usage === "used"
          ? usedIds.has(a.id)
          : usage === "unused"
            ? !usedIds.has(a.id)
            : a.classification?.confidence !== "high" || a.source === "legacy_site",
    );

  const styles = catalog.styles.map((s) => ({ id: s.id, name: s.name, kind: s.kind }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Media & import"
        description={`${assets.length} images in the library. Every image keeps a record of where it came from.`}
        actions={
          <>
            {uploading ? (
              <span className="flex items-center gap-2 text-sm text-[var(--acton-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> {uploading}
              </span>
            ) : null}
            <UploadButton
              label="Upload to library"
              onFiles={async (files) => {
                for (const [i, file] of files.entries()) {
                  setUploading(`Uploading ${i + 1} of ${files.length}…`);
                  const g = classifyFilename(file.name, styles);
                  await uploadImage(file, {
                    kind: g.kind === "unknown" ? "other" : g.kind,
                    modelId: null,
                    styleId: g.styleId,
                    role: g.role,
                    ceiling: g.ceiling,
                    variant: g.variant,
                    mirror: g.mirror,
                    bathroomName: null,
                    confidence: g.confidence,
                    notes: [g.reason],
                  }).catch(() => undefined);
                }
                setUploading(null);
              }}
            />
          </>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-[var(--acton-border)] bg-white p-0.5 text-sm">
        {(
          [
            ["library", "Image library"],
            ["report", "Import report"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-md px-4 py-1.5 font-semibold",
              tab === id ? "bg-[var(--acton-navy)] text-white" : "text-[var(--acton-navy)]",
            )}
            data-testid={`media-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "library" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--acton-muted)]" />
              <TextInput
                placeholder="Search file names"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              className={cn(inputClass, "w-auto")}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              aria-label="Model"
            >
              <option value="all">All models</option>
              {catalog.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className={cn(inputClass, "w-auto")}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              aria-label="Kind"
            >
              <option value="all">All kinds</option>
              {["exterior", "interior", "bathroom", "floorplan", "details", "other"].map((k) => (
                <option key={k} value={k}>
                  {k[0]!.toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
            <select
              className={cn(inputClass, "w-auto")}
              value={usage}
              onChange={(e) => setUsage(e.target.value as typeof usage)}
              aria-label="Usage"
            >
              <option value="all">Used and unused</option>
              <option value="used">Used by a model</option>
              <option value="unused">Not used</option>
              <option value="review">Needs a look (from live site or uncertain)</option>
            </select>
            <span className="text-sm text-[var(--acton-muted)]">{list.length} shown</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {list.slice(0, 300).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setOpen(a)}
                className="overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white text-left hover:ring-2 hover:ring-[#0088FF]"
              >
                <div className="relative">
                  <Thumb asset={a} className="aspect-[16/10] w-full" />
                  {!usedIds.has(a.id) ? (
                    <span className="absolute top-1 left-1">
                      <Pill tone="gray">Unused</Pill>
                    </span>
                  ) : null}
                  {a.source === "legacy_site" ? (
                    <span className="absolute top-1 right-1">
                      <Pill tone="blue">Live site</Pill>
                    </span>
                  ) : null}
                </div>
                <p
                  className="truncate px-2 py-1 text-[11px] text-[var(--acton-navy)]"
                  title={a.originalName}
                >
                  {a.originalName}
                </p>
              </button>
            ))}
          </div>
          {list.length > 300 ? (
            <p className="mt-3 text-sm text-[var(--acton-muted)]">
              Showing the first 300. Use the filters to narrow down.
            </p>
          ) : null}
        </>
      ) : (
        <ImportReportView report={report} />
      )}

      {open ? (
        <AssetDialog asset={open} usage={usageOf(catalog, open.id)} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function AssetDialog({
  asset,
  usage,
  onClose,
}: {
  asset: AdminAsset;
  usage: string[];
  onClose: () => void;
}) {
  const { catalog, reclassifyAsset } = useAdmin();
  const [c, setC] = useState<AssetClassification>(
    asset.classification ?? {
      kind: "other",
      modelId: null,
      styleId: null,
      role: null,
      ceiling: null,
      variant: null,
      mirror: null,
      bathroomName: null,
      confidence: "low",
      notes: [],
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = cn(inputClass, "h-9");
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>{asset.originalName}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <img
          src={asset.displayUrl}
          alt={asset.originalName}
          className="mb-4 max-h-[50vh] w-full rounded-lg bg-gray-100 object-contain"
        />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">Source:</span>{" "}
              {asset.source === "local_import"
                ? "Supplied Models folder"
                : asset.source === "legacy_site"
                  ? "Live design.actonadu.com"
                  : "Uploaded"}
            </p>
            <p className="break-all text-[var(--acton-muted)]">{asset.provenance}</p>
            <p>
              <span className="font-semibold">Size:</span> {asset.width ?? "?"}×
              {asset.height ?? "?"}
            </p>
            <div>
              <p className="font-semibold">Used in</p>
              {usage.length ? (
                <ul className="list-disc pl-5 text-[var(--acton-muted)]">
                  {usage.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[var(--acton-muted)]">
                  Not used by any model. Assign it from a model&apos;s Images tab.
                </p>
              )}
            </div>
            {asset.classification?.notes.length ? (
              <p className="text-xs text-amber-800">{asset.classification.notes.join(" ")}</p>
            ) : null}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[var(--acton-navy)]">What this image shows</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kind">
                <select
                  className={select}
                  value={c.kind}
                  onChange={(e) =>
                    setC({ ...c, kind: e.target.value as AssetClassification["kind"] })
                  }
                >
                  {["exterior", "interior", "bathroom", "floorplan", "details", "other"].map(
                    (k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Model">
                <select
                  className={select}
                  value={c.modelId ?? ""}
                  onChange={(e) => setC({ ...c, modelId: e.target.value || null })}
                >
                  <option value="">Any</option>
                  {catalog.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Style">
                <select
                  className={select}
                  value={c.styleId ?? ""}
                  onChange={(e) => setC({ ...c, styleId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {catalog.styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              {c.kind === "interior" ? (
                <Field label="Rendering">
                  <select
                    className={select}
                    value={c.role ?? ""}
                    onChange={(e) =>
                      setC({ ...c, role: (e.target.value || null) as AssetClassification["role"] })
                    }
                  >
                    {INTERIOR_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {c.kind === "exterior" || c.kind === "interior" ? (
                <Field label="Ceiling">
                  <select
                    className={select}
                    value={c.ceiling ?? "8"}
                    onChange={(e) => setC({ ...c, ceiling: e.target.value as "8" | "9" })}
                  >
                    <option value="8">8 ft</option>
                    <option value="9">9 ft</option>
                  </select>
                </Field>
              ) : null}
              {c.kind === "exterior" ? (
                <Field label="Porch">
                  <select
                    className={select}
                    value={c.variant ?? "standard"}
                    onChange={(e) =>
                      setC({ ...c, variant: e.target.value as "standard" | "porch" })
                    }
                  >
                    <option value="standard">Standard</option>
                    <option value="porch">With porch</option>
                  </select>
                </Field>
              ) : null}
            </div>
            <p className="text-xs text-[var(--acton-muted)]">
              This label helps find the image when choosing renderings. It does not move the image;
              assign it from a model&apos;s tabs.
            </p>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-md px-4 text-sm font-semibold text-[var(--acton-muted)] hover:bg-gray-100"
        >
          Close
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await reclassifyAsset(asset.id, {
                ...c,
                confidence: "high",
                notes: [
                  ...c.notes.filter((n) => !n.startsWith("Confirmed")),
                  "Confirmed by an admin",
                ],
              });
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
          className="h-10 rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save label
        </button>
      </DialogFooter>
    </Dialog>
  );
}

function ReportList({
  title,
  entries,
  tone,
}: {
  title: string;
  entries: ReportEntry[] | undefined;
  tone: "red" | "amber" | "gray";
}) {
  if (!entries?.length) return null;
  return (
    <Panel title={`${title} (${entries.length})`}>
      <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
        {entries.map((e, i) => (
          <li key={i} className="flex gap-2">
            <AlertTriangle
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                tone === "red"
                  ? "text-red-500"
                  : tone === "amber"
                    ? "text-amber-500"
                    : "text-gray-400",
              )}
            />
            <span>
              {e.model ? <span className="font-semibold">{e.model}: </span> : null}
              {e.message}
              {e.file ? (
                <span className="block text-xs break-all text-[var(--acton-muted)]">{e.file}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ImportReportView({ report }: { report: ImportReport | null }) {
  if (!report) {
    return (
      <Panel>
        <p className="text-sm text-[var(--acton-muted)]">
          No import has been run yet. Run scripts/configurator-import.ts to import the supplied
          Models folder.
        </p>
      </Panel>
    );
  }
  return (
    <div className="space-y-4" data-testid="import-report">
      <Panel
        title="Summary"
        description={`Imported ${new Date(report.generatedAt).toLocaleString()}`}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="Models" value={report.models?.length ?? 0} />
          <Metric label="Images from Models folder" value={report.images?.localFiles ?? 0} />
          <Metric label="Images from live site" value={report.images?.legacyFiles ?? 0} />
          <Metric label="Rendering slots mapped" value={report.images?.mappedSlots ?? 0} />
        </div>
        {report.models?.length ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--acton-muted)]">
                <th className="py-1">Model</th>
                <th>Folder</th>
                <th className="text-right">Renderings</th>
              </tr>
            </thead>
            <tbody>
              {report.models.map((m) => (
                <tr key={m.id} className="border-t border-[var(--acton-border)]">
                  <td className="py-1.5">
                    <Link
                      href={`/configurator/models/${m.id}?tab=images`}
                      className="font-semibold text-[var(--acton-navy)] hover:underline"
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td className="text-[var(--acton-muted)]">{m.folder}</td>
                  <td className="text-right">
                    {m.images.missing ? (
                      <Pill tone="red">{m.images.missing} missing</Pill>
                    ) : (
                      <Pill tone="green">
                        <CheckCircle2 className="h-3 w-3" /> complete
                      </Pill>
                    )}{" "}
                    {m.images.mapped}/{m.images.required}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Panel>
      <ReportList
        title="Uncertain mappings to confirm"
        entries={report.uncertainMappings}
        tone="amber"
      />
      <ReportList
        title="Missing renderings (at import)"
        entries={report.missingRenders}
        tone="red"
      />
      <ReportList
        title="Problems found on the live site"
        entries={report.legacyDataIssues}
        tone="gray"
      />
      {report.pricing ? (
        <Panel title="Prices requiring review">
          <p className="mb-2 text-sm">{report.pricing.note}</p>
          <p className="mb-2 text-sm text-[var(--acton-muted)]">
            {report.pricing.itemsImported} prices imported.
          </p>
          <ul className="space-y-1 text-sm">
            {[...report.pricing.inconsistencies, ...report.pricing.itemsWithoutLegacyPrice].map(
              (e, i) => (
                <li key={i}>
                  • <span className="font-semibold">{e.model}:</span> {e.message}
                </li>
              ),
            )}
          </ul>
          <Link
            href="/configurator/pricing?review=1"
            className="mt-3 inline-block text-sm font-semibold text-[#0088FF] hover:underline"
          >
            Review prices →
          </Link>
        </Panel>
      ) : null}
      {report.regions ? (
        <Panel title="Regions">
          <p className="text-sm">{report.regions.note}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {report.regions.flags.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {report.integrations?.length ? (
        <Panel title="Integrations to verify">
          <ul className="space-y-1 text-sm">
            {report.integrations.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--acton-gray-50)] p-3">
      <p className="text-2xl font-bold text-[var(--acton-navy)]">{value}</p>
      <p className="text-xs text-[var(--acton-muted)]">{label}</p>
    </div>
  );
}
