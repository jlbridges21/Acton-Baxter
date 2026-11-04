"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhlSubmission } from "@/lib/configurator/ghl-messages";
import { quoteFromSheet, type ModelPriceSheet } from "@/lib/configurator/pricing";
import type { PublicCatalog, PublicModel } from "@/lib/configurator/public-catalog";
import {
  carrySelection,
  deepLinkParams,
  defaultSelection,
  findModelByLinkValue,
  parseDeepLink,
  selectionFromDeepLink,
  toggleUpgrade,
} from "@/lib/configurator/selection";
import type { Selection, ViewMode } from "@/lib/configurator/types";

const LOCATION_KEY = "acton-configurator-location";
/** Same key the legacy site used, so contact details carry over between visits. */
const PREFILL_KEY = "cfg_prefill_exact";

export type LocationState =
  | { status: "none" }
  | { status: "checking" }
  | { status: "supported"; city: string; state: string; regionName: string; token: string }
  | { status: "outside"; city: string }
  | { status: "needs_city"; choices: string[]; pending: GhlSubmission }
  | { status: "error"; message: string };

export type PriceState = {
  modelId: string;
  sheet: ModelPriceSheet;
  financing: { enabled: boolean; annualRatePct: number; termMonths: number };
  regionName: string;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — state stays in memory */
  }
}

const URL_KEYS = [
  "series",
  "model",
  "viewMode",
  "modelOption",
  "exterior",
  "interior",
  "appliances",
  "upgrades",
  "bathroom",
];

function initialState(
  catalog: PublicCatalog,
  search: string,
): { model: PublicModel; selection: Selection; viewMode: ViewMode } {
  const params = new URLSearchParams(search);
  const link = parseDeepLink(params);
  const design = params.get("design");
  const bySeries = link.series
    ? catalog.models.filter((m) => m.seriesSlug === link.series)
    : catalog.models;
  const model =
    findModelByLinkValue(catalog.models, link.model) ??
    (design
      ? catalog.models.find(
          (m) =>
            m.canibuildDesignName.toLowerCase() === design.toLowerCase() ||
            m.name.toLowerCase() === design.toLowerCase(),
        )
      : undefined) ??
    bySeries[0] ??
    catalog.models[0]!;
  return { model, selection: selectionFromDeepLink(model, link), viewMode: link.viewMode };
}

export function useConfigurator(
  catalog: PublicCatalog,
  options: { preview: boolean; initialSearch: string },
) {
  const [state, setState] = useState(() => initialState(catalog, options.initialSearch));
  const { model, selection, viewMode } = state;
  const [mirror, setMirror] = useState(false);
  const [location, setLocationState] = useState<LocationState>({ status: "none" });
  const [prices, setPrices] = useState<PriceState | null>(null);
  const [previewRegionId, setPreviewRegionId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Partial<GhlSubmission>>({});

  // Restore saved location + contact prefill after mount (localStorage is client-only).
  /* eslint-disable react-hooks/set-state-in-effect -- hydrate the visitor's saved location and contact details after mount */
  useEffect(() => {
    const saved = readJson<LocationState>(LOCATION_KEY);
    if (saved && (saved.status === "supported" || saved.status === "outside"))
      setLocationState(saved);
    const legacy = readJson<Record<string, string>>(PREFILL_KEY);
    if (legacy)
      setPrefill({
        firstName: legacy.first_name,
        lastName: legacy.last_name,
        email: legacy.email,
        phone: legacy.phone,
        address: legacy.address,
        city: legacy.city,
        postalCode: legacy.postal_code,
      });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setLocation = useCallback((next: LocationState) => {
    setLocationState(next);
    if (next.status === "supported" || next.status === "outside" || next.status === "none")
      writeJson(LOCATION_KEY, next.status === "none" ? null : next);
  }, []);

  const seriesModels = useMemo(
    () => catalog.models.filter((m) => m.seriesId === model.seriesId),
    [catalog.models, model.seriesId],
  );

  // Keep the address bar in sync (other params such as utm_* / gclid / cb_ref are kept).
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of URL_KEYS) url.searchParams.delete(key);
    url.searchParams.delete("design");
    deepLinkParams(model.seriesSlug, model, selection, viewMode).forEach((v, k) =>
      url.searchParams.set(k, v),
    );
    window.history.replaceState(window.history.state, "", url.toString());
  }, [model, selection, viewMode]);

  // ------------------------------------------------------------------ selection
  const selectModel = useCallback((next: PublicModel) => {
    setState((prev) =>
      prev.model.id === next.id
        ? prev
        : { ...prev, model: next, selection: carrySelection(prev.model, prev.selection, next) },
    );
    setMirror(false);
  }, []);
  const update = useCallback((patch: Partial<Selection>) => {
    setState((prev) => ({ ...prev, selection: { ...prev.selection, ...patch } }));
  }, []);
  const selectUpgrade = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        selection: {
          ...prev.selection,
          upgradeIds: toggleUpgrade(
            prev.model,
            prev.selection.upgradeIds,
            id,
            catalog.settings.upgradeSelection,
          ),
        },
      }));
    },
    [catalog.settings.upgradeSelection],
  );
  const setViewMode = useCallback((mode: ViewMode) => {
    setState((prev) => ({ ...prev, viewMode: mode }));
    if (mode === "elevation") setMirror(false);
  }, []);

  // ------------------------------------------------------------------ pricing
  const token = location.status === "supported" ? location.token : null;
  const requestId = useRef(0);
  const pricingActive = Boolean(token || (options.preview && previewRegionId));
  useEffect(() => {
    if (!pricingActive) return;
    const id = ++requestId.current;
    const body =
      options.preview && previewRegionId
        ? { model: model.slug, preview: true, regionId: previewRegionId }
        : { model: model.slug, token, preview: options.preview };
    fetch("/api/public/configurator/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => ({
        ok: res.ok,
        data: (await res.json().catch(() => ({}))) as Record<string, unknown>,
      }))
      .then(({ data }) => {
        if (id !== requestId.current) return;
        if (data.status === "priced") {
          setPrices({
            modelId: data.modelId as string,
            sheet: data.sheet as ModelPriceSheet,
            financing: data.financing as PriceState["financing"],
            regionName: data.regionName as string,
          });
        } else {
          setPrices(null);
          if (data.status === "outside")
            setLocation({ status: "outside", city: String(data.city ?? "") });
          if (data.status === "location_required") setLocation({ status: "none" });
        }
      })
      .catch(() => id === requestId.current && setPrices(null));
  }, [model.slug, token, options.preview, previewRegionId, pricingActive, setLocation]);

  const sheet = pricingActive && prices && prices.modelId === model.id ? prices.sheet : null;

  const quote = useMemo(() => {
    if (!sheet || !prices) return null;
    const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
    return quoteFromSheet(model, sheet, selection, prices.financing, styleName);
  }, [sheet, prices, model, selection, catalog.styles]);

  // ------------------------------------------------------------------ location
  const submitLocation = useCallback(
    async (submission: GhlSubmission, cityOverride?: string) => {
      const nextPrefill = {
        ...prefill,
        ...Object.fromEntries(Object.entries(submission).filter(([, v]) => v)),
      };
      setPrefill(nextPrefill);
      writeJson(PREFILL_KEY, {
        first_name: nextPrefill.firstName,
        last_name: nextPrefill.lastName,
        email: nextPrefill.email,
        phone: nextPrefill.phone,
        address: nextPrefill.address,
        city: cityOverride ?? nextPrefill.city,
        postal_code: nextPrefill.postalCode,
      });
      setLocationState({ status: "checking" });
      try {
        const res = await fetch(
          `/api/public/configurator/location${options.preview ? "?preview=draft" : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: submission.address,
              city: cityOverride ?? submission.city,
              state: submission.state,
              postalCode: submission.postalCode,
            }),
          },
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (data.status === "supported") {
          setLocation({
            status: "supported",
            city: String(data.city),
            state: String(data.state),
            regionName: String(data.regionName),
            token: String(data.token),
          });
          return "supported" as const;
        }
        if (data.status === "outside") {
          setLocation({
            status: "outside",
            city: String(data.city ?? cityOverride ?? submission.city),
          });
          return "outside" as const;
        }
        if (data.status === "needs_city") {
          setLocationState({
            status: "needs_city",
            choices: (data.choices as string[]) ?? [],
            pending: submission,
          });
          return "needs_city" as const;
        }
        setLocationState({
          status: "error",
          message: "We couldn't check that address. Please try again.",
        });
        return "error" as const;
      } catch {
        setLocationState({
          status: "error",
          message: "We couldn't check that address. Please try again.",
        });
        return "error" as const;
      }
    },
    [options.preview, prefill, setLocation],
  );

  return {
    model,
    seriesModels,
    selection,
    viewMode,
    mirror,
    setMirror,
    selectModel,
    update,
    selectUpgrade,
    setViewMode,
    location,
    setLocation,
    submitLocation,
    sheet,
    quote,
    prefill,
    setPrefill,
    previewRegionId,
    setPreviewRegionId,
    resetSelection: () =>
      setState((prev) => ({ ...prev, selection: defaultSelection(prev.model) })),
  };
}
