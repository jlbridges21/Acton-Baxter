"use client";

/**
 * Admin working copy of the draft catalog. Every editor (model tabs, style drawer, bulk
 * pricing grid, regions) edits this one copy, so a price changed in a style's "Pricing by
 * Region" tab is the same value the bulk grid shows. Save sends only the entities that
 * changed, with their revision, so concurrent edits by another admin are caught.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AdminAsset, AdminWorkspaceData } from "@/lib/configurator/server";
import { validateCatalog, type Issue } from "@/lib/configurator/validate";
import type {
  AssetClassification,
  Catalog,
  CatalogChange,
  CatalogCollection,
  CatalogSettings,
  Model,
  Region,
  Series,
  SharedStyle,
} from "@/lib/configurator/types";

type Entity = { id: string; rev: number };

type AdminContextValue = {
  catalog: Catalog;
  saved: Catalog;
  revision: number;
  assets: AdminAsset[];
  assetById: Map<string, AdminAsset>;
  issues: Issue[];
  live: AdminWorkspaceData["live"];
  setLive: (live: AdminWorkspaceData["live"]) => void;
  dirtyCount: number;
  isDirty: (collection: CatalogCollection | "settings", id?: string) => boolean;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: string;
  canUndo: boolean;
  undo: () => void;
  updateModel: (id: string, update: (model: Model) => Model) => void;
  putModel: (model: Model) => void;
  deleteModel: (id: string) => void;
  updateStyle: (id: string, update: (style: SharedStyle) => SharedStyle) => void;
  putStyle: (style: SharedStyle) => void;
  deleteStyle: (id: string) => void;
  updateRegions: (update: (regions: Region[]) => Region[]) => void;
  updateSeries: (update: (series: Series[]) => Series[]) => void;
  updateSettings: (update: (settings: CatalogSettings) => CatalogSettings) => void;
  updateCatalog: (update: (catalog: Catalog) => Catalog) => void;
  save: () => Promise<boolean>;
  discard: () => void;
  uploadImage: (file: File, classification?: AssetClassification | null) => Promise<AdminAsset>;
  reclassifyAsset: (id: string, classification: AssetClassification) => Promise<void>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside ConfiguratorAdminProvider");
  return ctx;
}

const COLLECTIONS: CatalogCollection[] = ["series", "styles", "regions", "models"];

function changedEntities(saved: Catalog, working: Catalog): CatalogChange[] {
  const changes: CatalogChange[] = [];
  for (const collection of COLLECTIONS) {
    const before = new Map((saved[collection] as Entity[]).map((e) => [e.id, e]));
    const after = working[collection] as Entity[];
    for (const entity of after) {
      const original = before.get(entity.id);
      if (!original || JSON.stringify(original) !== JSON.stringify(entity)) {
        changes.push({
          op: "put",
          collection,
          value: { ...entity, rev: original?.rev ?? 0 },
          expectedRev: original ? original.rev : null,
        } as CatalogChange);
      }
    }
    const remaining = new Set(after.map((e) => e.id));
    for (const [id, original] of before)
      if (!remaining.has(id))
        changes.push({ op: "delete", collection, id, expectedRev: original.rev });
  }
  if (JSON.stringify(saved.settings) !== JSON.stringify(working.settings))
    changes.push({ op: "settings", value: working.settings, expectedRev: saved.settings.rev });
  return changes;
}

export function ConfiguratorAdminProvider({
  initial,
  children,
}: {
  initial: AdminWorkspaceData;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<Catalog>(initial.catalog);
  const [catalog, setCatalog] = useState<Catalog>(initial.catalog);
  const [revision, setRevision] = useState(initial.revision);
  const [lastSavedAt, setLastSavedAt] = useState(initial.updatedAt);
  const [assets, setAssets] = useState<AdminAsset[]>(initial.assets);
  const [live, setLive] = useState(initial.live);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const history = useRef<Catalog[]>([]);
  const [historyLength, setHistoryLength] = useState(0);

  const apply = useCallback((update: (c: Catalog) => Catalog) => {
    setCatalog((current) => {
      const next = update(current);
      if (next === current) return current;
      history.current = [...history.current.slice(-49), current];
      setHistoryLength(history.current.length);
      return next;
    });
  }, []);

  const changes = useMemo(() => changedEntities(saved, catalog), [saved, catalog]);
  const dirtyKeys = useMemo(
    () =>
      new Set(
        changes.map((c) =>
          c.op === "settings"
            ? "settings"
            : `${c.collection}:${c.op === "put" ? c.value.id : c.id}`,
        ),
      ),
    [changes],
  );
  const issues = useMemo(() => validateCatalog(catalog), [catalog]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  useEffect(() => {
    if (changes.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

  const save = useCallback(async () => {
    if (changes.length === 0) return true;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/configurator/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        catalog?: Catalog;
        revision?: number;
        updatedAt?: string;
        error?: { message?: string; errors?: string[] };
      };
      if (!res.ok || !payload.catalog) {
        const extra = payload.error?.errors?.filter((e) => e !== payload.error?.message) ?? [];
        setSaveError([payload.error?.message ?? "Could not save changes.", ...extra].join(" "));
        return false;
      }
      setSaved(payload.catalog);
      setCatalog(payload.catalog);
      setRevision(payload.revision ?? revision);
      setLastSavedAt(payload.updatedAt ?? new Date().toISOString());
      history.current = [];
      setHistoryLength(0);
      return true;
    } catch {
      setSaveError("Could not reach Baxter. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [changes, revision]);

  const value: AdminContextValue = {
    catalog,
    saved,
    revision,
    assets,
    assetById,
    issues,
    live,
    setLive,
    dirtyCount: changes.length,
    isDirty: (collection, id) =>
      collection === "settings" ? dirtyKeys.has("settings") : dirtyKeys.has(`${collection}:${id}`),
    saving,
    saveError,
    lastSavedAt,
    canUndo: historyLength > 0,
    undo: () => {
      const previous = history.current.pop();
      setHistoryLength(history.current.length);
      if (previous) setCatalog(previous);
    },
    updateModel: (id, update) =>
      apply((c) => ({ ...c, models: c.models.map((m) => (m.id === id ? update(m) : m)) })),
    putModel: (model) =>
      apply((c) => ({
        ...c,
        models: c.models.some((m) => m.id === model.id)
          ? c.models.map((m) => (m.id === model.id ? model : m))
          : [...c.models, model],
      })),
    deleteModel: (id) => apply((c) => ({ ...c, models: c.models.filter((m) => m.id !== id) })),
    updateStyle: (id, update) =>
      apply((c) => ({ ...c, styles: c.styles.map((s) => (s.id === id ? update(s) : s)) })),
    putStyle: (style) =>
      apply((c) => ({
        ...c,
        styles: c.styles.some((s) => s.id === style.id)
          ? c.styles.map((s) => (s.id === style.id ? style : s))
          : [...c.styles, style],
      })),
    deleteStyle: (id) => apply((c) => ({ ...c, styles: c.styles.filter((s) => s.id !== id) })),
    updateRegions: (update) => apply((c) => ({ ...c, regions: update(c.regions) })),
    updateSeries: (update) => apply((c) => ({ ...c, series: update(c.series) })),
    updateSettings: (update) => apply((c) => ({ ...c, settings: update(c.settings) })),
    updateCatalog: apply,
    save,
    discard: () => {
      setCatalog(saved);
      history.current = [];
      setHistoryLength(0);
      setSaveError(null);
    },
    uploadImage: async (file, classification) => {
      const form = new FormData();
      form.set("file", file);
      if (classification) form.set("classification", JSON.stringify(classification));
      const res = await fetch("/api/admin/configurator/assets", { method: "POST", body: form });
      const payload = (await res.json().catch(() => ({}))) as {
        asset?: AdminAsset;
        error?: { message?: string };
      };
      if (!res.ok || !payload.asset) throw new Error(payload.error?.message ?? "Upload failed.");
      const asset = payload.asset;
      setAssets((list) => (list.some((a) => a.id === asset.id) ? list : [...list, asset]));
      return asset;
    },
    reclassifyAsset: async (id, classification) => {
      const res = await fetch(`/api/admin/configurator/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        asset?: AdminAsset;
        error?: { message?: string };
      };
      if (!res.ok || !payload.asset)
        throw new Error(payload.error?.message ?? "Could not update the image.");
      const asset = payload.asset;
      setAssets((list) => list.map((a) => (a.id === id ? asset : a)));
    },
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
