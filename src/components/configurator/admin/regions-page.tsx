"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { newRegion } from "@/lib/configurator/defaults";
import { REGION_COLORS, cityKey, cityOwner, displayCityName } from "@/lib/configurator/regions";
import type { Region } from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import { PageHeader } from "./admin-shell";
import { Field, Panel, TextInput, inputClass } from "./admin-ui";

export function RegionsPage({ californiaCities }: { californiaCities: string[] }) {
  const { catalog, updateRegions } = useAdmin();
  const regions = [...catalog.regions].sort((a, b) => a.sortOrder - b.sortOrder);
  const [selectedId, setSelectedId] = useState<string | null>(regions[0]?.id ?? null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Region | null>(null);
  const selected = regions.find((r) => r.id === selectedId) ?? null;
  const update = (id: string, fn: (r: Region) => Region) =>
    updateRegions((list) => list.map((r) => (r.id === id ? fn(r) : r)));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Pricing regions"
        description="Customers are priced by the city of their property. Each city belongs to one region, and every model automatically has a price column for every region."
      />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Panel title={`Regions (${regions.length})`}>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const region = newRegion(
                newName.trim(),
                catalog,
                REGION_COLORS[regions.length % REGION_COLORS.length]!,
              );
              updateRegions((list) => [...list, region]);
              setSelectedId(region.id);
              setNewName("");
            }}
          >
            <TextInput
              placeholder="New region name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New region name"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="inline-flex h-10 items-center gap-1 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white disabled:opacity-50"
              data-testid="add-region"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
          <div className="space-y-1">
            {regions.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                  r.id === selectedId ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-gray-50",
                )}
              >
                <span className="h-4 w-4 rounded" style={{ background: r.color }} />
                <span className="flex-1">
                  <span className="block font-semibold text-[var(--acton-navy)]">{r.name}</span>
                  <span className="block truncate text-xs text-[var(--acton-muted)]">
                    {r.cities.length} {r.cities.length === 1 ? "city" : "cities"}
                    {r.cities.length
                      ? ` · ${r.cities
                          .slice(0, 3)
                          .map((c) => c.name)
                          .join(", ")}${r.cities.length > 3 ? "…" : ""}`
                      : ""}
                  </span>
                </span>
              </button>
            ))}
            {regions.length === 0 ? (
              <p className="text-sm text-[var(--acton-muted)]">No regions yet.</p>
            ) : null}
          </div>
        </Panel>

        {selected ? (
          <RegionEditor
            key={selected.id}
            region={selected}
            regions={regions}
            californiaCities={californiaCities}
            onChange={(fn) => update(selected.id, fn)}
            onMoveCity={(city, fromId) =>
              updateRegions((list) =>
                list.map((r) => {
                  if (r.id === fromId)
                    return { ...r, cities: r.cities.filter((c) => cityKey(c) !== cityKey(city)) };
                  if (r.id === selected.id) return { ...r, cities: [...r.cities, city] };
                  return r;
                }),
              )
            }
            onDelete={() => setDeleting(selected)}
          />
        ) : (
          <Panel>
            <p className="text-sm text-[var(--acton-muted)]">
              Create a region to start adding cities.
            </p>
          </Panel>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          updateRegions((list) => list.filter((r) => r.id !== deleting.id));
          setSelectedId(null);
          setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "region"}?`}
        description="Its cities become unassigned (customers there see the outside-service-area message) and every price entered for this region is removed when you save."
        confirmLabel="Delete region"
        destructive
      />
    </div>
  );
}

function RegionEditor({
  region,
  regions,
  californiaCities,
  onChange,
  onMoveCity,
  onDelete,
}: {
  region: Region;
  regions: Region[];
  californiaCities: string[];
  onChange: (fn: (r: Region) => Region) => void;
  onMoveCity: (city: { name: string; state: string }, fromRegionId: string) => void;
  onDelete: () => void;
}) {
  const [query, setQuery] = useState("");
  const [bulk, setBulk] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    move?: { city: { name: string; state: string }; from: Region };
  } | null>(null);
  const [filter, setFilter] = useState("");

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return californiaCities.filter((c) => c.toLowerCase().startsWith(q)).slice(0, 8);
  }, [query, californiaCities]);

  const addCity = (raw: string): "added" | "exists" | "conflict" => {
    const city = { name: displayCityName(raw), state: "CA" };
    if (region.cities.some((c) => cityKey(c) === cityKey(city))) return "exists";
    const owner = cityOwner(regions, city, region.id);
    if (owner) {
      setMessage({
        text: `${city.name} already belongs to ${owner.name}. A city can only be in one region.`,
        move: { city, from: owner },
      });
      return "conflict";
    }
    onChange((r) =>
      r.cities.some((c) => cityKey(c) === cityKey(city))
        ? r
        : { ...r, cities: [...r.cities, city].sort((a, b) => a.name.localeCompare(b.name)) },
    );
    return "added";
  };

  const cities = region.cities.filter(
    (c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Panel
      title="Edit region"
      actions={
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Delete region
        </button>
      }
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Region name">
          <TextInput
            value={region.name}
            onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }))}
          />
        </Field>
        <Field label="Color">
          <div className="flex h-10 items-center gap-1.5">
            {REGION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => onChange((r) => ({ ...r, color: c }))}
                className={cn(
                  "h-7 w-7 rounded-md",
                  region.color === c ? "ring-2 ring-[var(--acton-navy)] ring-offset-2" : "",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
      </div>

      <Field
        label="Add a city"
        hint="Start typing a California city. Cities outside California can be typed in full."
      >
        <div className="relative">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!query.trim()) return;
              if (addCity(query) === "added") {
                setQuery("");
                setMessage(null);
              }
            }}
          >
            <TextInput
              value={query}
              onChange={(e) => (setQuery(e.target.value), setMessage(null))}
              placeholder="e.g. Sunnyvale"
              aria-label="City"
              data-testid="city-input"
            />
          </form>
          {suggestions.length ? (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white shadow-lg">
              {suggestions.map((s) => {
                const owner = cityOwner(regions, { name: s, state: "CA" });
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (addCity(s) === "added") setQuery("");
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span>{s}, CA</span>
                    {owner ? (
                      <span className="text-xs text-[var(--acton-muted)]">in {owner.name}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </Field>
      {message ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="alert"
          data-testid="city-conflict"
        >
          {message.text}
          {message.move ? (
            <button
              type="button"
              onClick={() => {
                onMoveCity(message.move!.city, message.move!.from.id);
                setMessage(null);
                setQuery("");
              }}
              className="font-semibold underline"
            >
              Move it to {region.name}
            </button>
          ) : null}
        </div>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-[#0088FF]">
          Paste a list of cities
        </summary>
        <textarea
          className={cn(inputClass, "mt-2 h-24 py-2")}
          placeholder="San Jose, Santa Clara, Sunnyvale…"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 h-9 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white"
          onClick={() => {
            const names = [
              ...new Map(
                bulk
                  .split(/[,\n;]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((n) => [n.toLowerCase(), n]),
              ).values(),
            ];
            const skipped: string[] = [];
            let added = 0;
            for (const n of names) {
              const result = addCity(n);
              if (result === "added") added++;
              if (result === "conflict") skipped.push(n);
            }
            setMessage({
              text: `Added ${added} cities.${skipped.length ? ` Already in another region: ${skipped.join(", ")}.` : ""}`,
            });
            setBulk("");
          }}
        >
          Add cities
        </button>
      </details>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--acton-navy)]">
          {region.cities.length} cities
        </p>
        {region.cities.length > 12 ? (
          <TextInput
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-40"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="city-chips">
        {cities.map((c) => (
          <span
            key={cityKey(c)}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--acton-gray-100)] py-1 pr-1 pl-3 text-sm text-[var(--acton-navy)]"
          >
            {c.name}
            {c.state !== "CA" ? `, ${c.state}` : ""}
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() =>
                onChange((r) => ({
                  ...r,
                  cities: r.cities.filter((x) => cityKey(x) !== cityKey(c)),
                }))
              }
              className="rounded-full p-0.5 hover:bg-gray-300"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </Panel>
  );
}
