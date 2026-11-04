/**
 * Configurator persistence: the draft document, immutable releases, and the asset library.
 *
 * Supabase (service role) in production; an in-process memory store for E2E/mock mode,
 * optionally seeded from `.configurator-local/seed.json` written by the import script.
 * Route handlers enforce who may read or write; this module only stores.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/admin";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyChanges } from "./catalog-ops";
import { emptyCatalog } from "./defaults";
import { blockingIssues, validateCatalog, validateModel, type Issue } from "./validate";
import type { Asset, AssetClassification, Catalog, CatalogChange, Model } from "./types";

export const CONFIGURATOR_BUCKET = "configurator-assets";

export class ConfiguratorSetupError extends AppError {
  constructor() {
    super(
      "The Configurator database tables are not set up yet. Apply supabase/migrations/086_configurator.sql, then run the import.",
      { statusCode: 503, code: "CONFIGURATOR_NOT_SET_UP" },
    );
  }
}

export class DraftConflictError extends AppError {
  constructor(
    message: string,
    public readonly details: { conflicts: { id: string; message: string }[]; errors: string[] },
  ) {
    super(message, { statusCode: 409, code: "CONFIGURATOR_CONFLICT" });
  }
}

export type Draft = {
  catalog: Catalog;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
};

/** What a release stores: the full catalog (with prices, for quotes) and the asset paths it uses. */
export type ReleaseSnapshot = {
  catalog: Catalog;
  assets: Record<string, { displayPath: string; thumbPath: string }>;
};

export type ReleaseSummary = {
  version: number;
  notes: string;
  publishedAt: string;
  publishedBy: string | null;
  publishedByName: string | null;
  rolledBackFrom: number | null;
  summary: PublishSummary;
};

export type Release = ReleaseSummary & { snapshot: ReleaseSnapshot };

export type PublishSummary = {
  publishedModels: string[];
  keptPreviousModels: { name: string; reasons: string[] }[];
  skippedModels: { name: string; reasons: string[] }[];
};

export type ImportReport = Record<string, unknown> & { generatedAt: string };

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export function usesMemoryConfiguratorStore(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return (
    process.env.E2E_TEST_AUTH_BYPASS === "true" ||
    process.env.CONFIGURATOR_LOCAL_MODE === "true" ||
    !url ||
    !anon ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    url.includes("127.0.0.1") ||
    anon.startsWith("test-")
  );
}

/**
 * Local/E2E data written by `scripts/configurator-import.ts --target=local`. Paths stay
 * statically scoped to `.configurator-local/` so production file tracing never pulls in the
 * rest of the project (or the 2.8 GB Models folder).
 */
export function localSeedFile(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".configurator-local", "seed.json");
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

type MemoryState = {
  draft: Draft;
  releases: Release[];
  assets: Map<string, Asset>;
  importReport: ImportReport | null;
};

const globalMemory = globalThis as typeof globalThis & { __baxterConfigurator?: MemoryState };

type SeedFile = { catalog: Catalog; assets: Asset[]; importReport?: ImportReport };

function loadSeed(): SeedFile | null {
  if (process.env.CONFIGURATOR_DISABLE_SEED === "true") return null;
  const file = localSeedFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SeedFile;
  } catch {
    return null;
  }
}

function memory(): MemoryState {
  if (!globalMemory.__baxterConfigurator) {
    const seed = loadSeed();
    globalMemory.__baxterConfigurator = {
      draft: {
        catalog: seed?.catalog ?? emptyCatalog(),
        revision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: null,
      },
      releases: [],
      assets: new Map((seed?.assets ?? []).map((a) => [a.id, a])),
      importReport: seed?.importReport ?? null,
    };
  }
  return globalMemory.__baxterConfigurator;
}

export function resetConfiguratorMemoryForTests(seed?: {
  catalog: Catalog;
  assets?: Asset[];
}): void {
  globalMemory.__baxterConfigurator = {
    draft: {
      catalog: seed?.catalog ?? emptyCatalog(),
      revision: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: null,
    },
    releases: [],
    assets: new Map((seed?.assets ?? []).map((a) => [a.id, a])),
    importReport: null,
  };
  releaseCache = null;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

type PgError = { code?: string; message?: string } | null;

function isMissingTable(error: PgError): boolean {
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message ?? "")),
  );
}

function fail(error: PgError, context: string): never {
  if (isMissingTable(error)) throw new ConfiguratorSetupError();
  throw new AppError(`Configurator ${context} failed: ${error?.message ?? "unknown error"}`, {
    statusCode: 500,
    code: "CONFIGURATOR_DB",
  });
}

type AssetRow = {
  id: string;
  display_path: string;
  thumb_path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sha256: string;
  original_name: string;
  source: Asset["source"];
  provenance: string;
  classification: AssetClassification | null;
  created_at: string;
};

function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    displayPath: row.display_path,
    thumbPath: row.thumb_path,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    sha256: row.sha256,
    originalName: row.original_name,
    source: row.source,
    provenance: row.provenance,
    classification: row.classification,
    createdAt: row.created_at,
  };
}

function assetToRow(asset: Asset, userId: string | null) {
  return {
    id: asset.id,
    display_path: asset.displayPath,
    thumb_path: asset.thumbPath,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    sha256: asset.sha256,
    original_name: asset.originalName,
    source: asset.source,
    provenance: asset.provenance,
    classification: asset.classification,
    created_at: asset.createdAt,
    created_by: userId,
  };
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export async function getDraft(): Promise<Draft> {
  if (usesMemoryConfiguratorStore()) return structuredClone(memory().draft);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_documents")
    .select("body, revision, updated_at, updated_by")
    .eq("key", "draft")
    .maybeSingle();
  if (error) fail(error, "draft read");
  if (!data)
    return {
      catalog: emptyCatalog(),
      revision: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: null,
    };
  return {
    catalog: data.body as Catalog,
    revision: data.revision as number,
    updatedAt: data.updated_at as string,
    updatedBy: (data.updated_by as string | null) ?? null,
  };
}

/**
 * Apply entity changes to the latest draft. Retries on concurrent writes; entity revisions
 * catch real edit conflicts.
 */
export async function saveDraftChanges(
  changes: CatalogChange[],
  userId: string | null,
): Promise<Draft> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await getDraft();
    const result = applyChanges(current.catalog, changes);
    if (!result.ok) {
      const first = result.conflicts[0]?.message ?? result.errors[0] ?? "Could not save.";
      throw new DraftConflictError(first, {
        conflicts: result.conflicts.map((c) => ({ id: c.id, message: c.message })),
        errors: result.errors,
      });
    }
    const next: Draft = {
      catalog: result.catalog,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    if (usesMemoryConfiguratorStore()) {
      memory().draft = structuredClone(next);
      return next;
    }
    const supabase = createServiceClient();
    if (current.revision === 0) {
      const { error } = await supabase.from("configurator_documents").insert({
        key: "draft",
        body: next.catalog,
        revision: next.revision,
        updated_at: next.updatedAt,
        updated_by: userId,
      });
      if (!error) return next;
      if (error.code !== "23505") fail(error, "draft create");
      continue;
    }
    const { data, error } = await supabase
      .from("configurator_documents")
      .update({
        body: next.catalog,
        revision: next.revision,
        updated_at: next.updatedAt,
        updated_by: userId,
      })
      .eq("key", "draft")
      .eq("revision", current.revision)
      .select("key");
    if (error) fail(error, "draft save");
    if (data && data.length > 0) return next;
  }
  throw new AppError("The draft is being edited heavily right now. Please try again.", {
    statusCode: 409,
    code: "CONFIGURATOR_BUSY",
  });
}

/** Replace the whole draft (import script / rollback-to-draft). */
export async function replaceDraft(catalog: Catalog, userId: string | null): Promise<Draft> {
  const current = await getDraft();
  const next: Draft = {
    catalog,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  if (usesMemoryConfiguratorStore()) {
    memory().draft = structuredClone(next);
    return next;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("configurator_documents").upsert({
    key: "draft",
    body: catalog,
    revision: next.revision,
    updated_at: next.updatedAt,
    updated_by: userId,
  });
  if (error) fail(error, "draft replace");
  return next;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function listAssets(): Promise<Asset[]> {
  if (usesMemoryConfiguratorStore()) return [...memory().assets.values()];
  const supabase = createServiceClient();
  const out: Asset[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("configurator_assets")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) fail(error, "asset list");
    out.push(...(data as AssetRow[]).map(assetFromRow));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getAssetsByIds(ids: string[]): Promise<Map<string, Asset>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  if (usesMemoryConfiguratorStore()) {
    const all = memory().assets;
    return new Map(unique.flatMap((id) => (all.has(id) ? [[id, all.get(id)!] as const] : [])));
  }
  const supabase = createServiceClient();
  const out = new Map<string, Asset>();
  for (let i = 0; i < unique.length; i += 300) {
    const { data, error } = await supabase
      .from("configurator_assets")
      .select("*")
      .in("id", unique.slice(i, i + 300));
    if (error) fail(error, "asset read");
    for (const row of data as AssetRow[]) out.set(row.id, assetFromRow(row));
  }
  return out;
}

export async function findAssetBySha(hash: string): Promise<Asset | null> {
  if (usesMemoryConfiguratorStore())
    return [...memory().assets.values()].find((a) => a.sha256 === hash) ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_assets")
    .select("*")
    .eq("sha256", hash)
    .maybeSingle();
  if (error) fail(error, "asset lookup");
  return data ? assetFromRow(data as AssetRow) : null;
}

export async function insertAsset(
  asset: Omit<Asset, "id" | "createdAt"> & { id?: string },
  userId: string | null,
): Promise<Asset> {
  const full: Asset = {
    ...asset,
    id: asset.id ?? randomUUID(),
    createdAt: new Date().toISOString(),
  };
  if (usesMemoryConfiguratorStore()) {
    memory().assets.set(full.id, full);
    return full;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("configurator_assets").insert(assetToRow(full, userId));
  if (error) fail(error, "asset save");
  return full;
}

export async function updateAssetClassification(
  id: string,
  classification: AssetClassification,
): Promise<Asset> {
  if (usesMemoryConfiguratorStore()) {
    const asset = memory().assets.get(id);
    if (!asset) throw new NotFoundError("Image not found.");
    const next = { ...asset, classification };
    memory().assets.set(id, next);
    return next;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_assets")
    .update({ classification })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) fail(error, "asset update");
  if (!data) throw new NotFoundError("Image not found.");
  return assetFromRow(data as AssetRow);
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

type ReleaseRow = {
  version: number;
  notes: string;
  published_at: string;
  published_by: string | null;
  rolled_back_from: number | null;
  summary: PublishSummary;
  snapshot?: ReleaseSnapshot;
  profiles?: { full_name: string | null; email: string | null } | null;
};

function releaseFromRow(row: ReleaseRow): ReleaseSummary {
  return {
    version: row.version,
    notes: row.notes,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    publishedByName: row.profiles?.full_name ?? row.profiles?.email ?? null,
    rolledBackFrom: row.rolled_back_from,
    summary: row.summary,
  };
}

let releaseCache: { at: number; release: Release | null } | null = null;
const RELEASE_CACHE_MS = 15_000;

export async function getCurrentRelease(
  options: { fresh?: boolean } = {},
): Promise<Release | null> {
  if (usesMemoryConfiguratorStore()) {
    const releases = memory().releases;
    return releases.length ? structuredClone(releases[releases.length - 1]!) : null;
  }
  if (!options.fresh && releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_MS)
    return releaseCache.release;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_releases")
    .select("version, notes, published_at, published_by, rolled_back_from, summary, snapshot")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error, "release read");
  const release = data
    ? { ...releaseFromRow(data as ReleaseRow), snapshot: (data as ReleaseRow).snapshot! }
    : null;
  releaseCache = { at: Date.now(), release };
  return release;
}

export async function listReleases(): Promise<ReleaseSummary[]> {
  if (usesMemoryConfiguratorStore()) {
    return memory()
      .releases.map(({ snapshot: _snapshot, ...rest }) => rest)
      .reverse();
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_releases")
    .select(
      "version, notes, published_at, published_by, rolled_back_from, summary, profiles:published_by(full_name, email)",
    )
    .order("version", { ascending: false })
    .limit(100);
  if (error) fail(error, "release list");
  return (data as unknown as ReleaseRow[]).map(releaseFromRow);
}

async function getRelease(version: number): Promise<Release> {
  if (usesMemoryConfiguratorStore()) {
    const r = memory().releases.find((x) => x.version === version);
    if (!r) throw new NotFoundError("That version does not exist.");
    return structuredClone(r);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_releases")
    .select("version, notes, published_at, published_by, rolled_back_from, summary, snapshot")
    .eq("version", version)
    .maybeSingle();
  if (error) fail(error, "release read");
  if (!data) throw new NotFoundError("That version does not exist.");
  return { ...releaseFromRow(data as ReleaseRow), snapshot: (data as ReleaseRow).snapshot! };
}

async function insertRelease(
  snapshot: ReleaseSnapshot,
  notes: string,
  summary: PublishSummary,
  userId: string | null,
  rolledBackFrom: number | null,
): Promise<ReleaseSummary> {
  const current = await getCurrentRelease({ fresh: true });
  const version = (current?.version ?? 0) + 1;
  const publishedAt = new Date().toISOString();
  if (usesMemoryConfiguratorStore()) {
    const release: Release = {
      version,
      notes,
      publishedAt,
      publishedBy: userId,
      publishedByName: null,
      rolledBackFrom,
      summary,
      snapshot,
    };
    memory().releases.push(structuredClone(release));
    return release;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("configurator_releases").insert({
    version,
    notes,
    snapshot,
    summary,
    published_at: publishedAt,
    published_by: userId,
    rolled_back_from: rolledBackFrom,
  });
  if (error) {
    if (error.code === "23505")
      throw new AppError("Someone else published at the same moment. Please try again.", {
        statusCode: 409,
        code: "CONFIGURATOR_BUSY",
      });
    fail(error, "publish");
  }
  releaseCache = null;
  return {
    version,
    notes,
    publishedAt,
    publishedBy: userId,
    publishedByName: null,
    rolledBackFrom,
    summary,
  };
}

export type PublishPlan = {
  catalog: Catalog;
  summary: PublishSummary;
  globalErrors: Issue[];
};

/**
 * What would go live. Each active model that passes validation goes live as drafted. An active
 * model with blocking issues keeps its previously published version (or stays off the live
 * site if it was never published), so one unfinished model never blocks the others.
 */
export function planPublish(draft: Catalog, live: Catalog | null): PublishPlan {
  const globalErrors = blockingIssues(validateCatalog(draft)).filter((i) => i.modelId === null);
  const summary: PublishSummary = {
    publishedModels: [],
    keptPreviousModels: [],
    skippedModels: [],
  };
  const models: Model[] = [];
  for (const model of draft.models) {
    if (model.status !== "active") {
      models.push(model);
      continue;
    }
    const errors = blockingIssues(validateModel(draft, model));
    if (errors.length === 0) {
      models.push(model);
      summary.publishedModels.push(model.name);
      continue;
    }
    const reasons = errors.slice(0, 5).map((e) => e.message);
    const previous = live?.models.find((m) => m.id === model.id && m.status === "active");
    if (previous) {
      models.push(previous);
      summary.keptPreviousModels.push({ name: model.name, reasons });
    } else {
      models.push({ ...model, status: "inactive" });
      summary.skippedModels.push({ name: model.name, reasons });
    }
  }
  // Keep styles that a kept (older) model still references.
  const styleIds = new Set(draft.styles.map((s) => s.id));
  const styles = [...draft.styles];
  for (const style of live?.styles ?? []) if (!styleIds.has(style.id)) styles.push(style);
  return { catalog: { ...draft, styles, models }, summary, globalErrors };
}

function referencedAssetIds(catalog: Catalog): string[] {
  const ids: string[] = [];
  for (const model of catalog.models) {
    if (model.status !== "active") continue;
    ids.push(...Object.values(model.renders));
    if (model.floorplans.standard) ids.push(model.floorplans.standard);
    if (model.floorplans.mirror) ids.push(model.floorplans.mirror);
  }
  for (const style of catalog.styles) if (style.detailsAssetId) ids.push(style.detailsAssetId);
  return ids;
}

export async function publishDraft(notes: string, userId: string | null): Promise<ReleaseSummary> {
  const [draft, live] = await Promise.all([getDraft(), getCurrentRelease({ fresh: true })]);
  const plan = planPublish(draft.catalog, live?.snapshot.catalog ?? null);
  if (plan.globalErrors.length)
    throw new ValidationError(plan.globalErrors.map((e) => e.message).join(" "));
  if (plan.summary.publishedModels.length === 0 && plan.summary.keptPreviousModels.length === 0)
    throw new ValidationError(
      "No model is ready to publish yet. Fix the issues listed for each model first.",
    );
  const assets = await getAssetsByIds(referencedAssetIds(plan.catalog));
  const snapshot: ReleaseSnapshot = {
    catalog: plan.catalog,
    assets: Object.fromEntries(
      [...assets].map(([id, a]) => [id, { displayPath: a.displayPath, thumbPath: a.thumbPath }]),
    ),
  };
  return insertRelease(snapshot, notes, plan.summary, userId, null);
}

/** Re-publish an older version as the newest one (history stays linear). */
export async function rollbackToVersion(
  version: number,
  userId: string | null,
): Promise<ReleaseSummary> {
  const target = await getRelease(version);
  const summary: PublishSummary = {
    publishedModels: target.snapshot.catalog.models
      .filter((m) => m.status === "active")
      .map((m) => m.name),
    keptPreviousModels: [],
    skippedModels: [],
  };
  return insertRelease(target.snapshot, `Restored version ${version}`, summary, userId, version);
}

// ---------------------------------------------------------------------------
// Import report
// ---------------------------------------------------------------------------

export async function getImportReport(): Promise<ImportReport | null> {
  if (usesMemoryConfiguratorStore()) return memory().importReport;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("configurator_documents")
    .select("body")
    .eq("key", "import_report")
    .maybeSingle();
  if (error) fail(error, "import report read");
  return (data?.body as ImportReport | undefined) ?? null;
}
