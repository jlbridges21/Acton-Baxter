"use client";

/**
 * Model Options, Appliances, Upgrades and Bathrooms: per-model lists of customer choices.
 * Each card edits name, availability, default, description lines and its Pricing by Region.
 */

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { newAppliance, newBathroom, newModelOption, newUpgrade } from "@/lib/configurator/defaults";
import { ROLE_LABELS, slotKey } from "@/lib/configurator/render";
import type {
  AppliancePackage,
  BathroomOption,
  Model,
  ModelOption,
  Price,
  Region,
  Upgrade,
} from "@/lib/configurator/types";
import { cn } from "@/lib/utils";
import { useAdmin } from "./admin-context";
import {
  ImageSlot,
  Panel,
  Pill,
  RegionPriceEditor,
  TextInput,
  Toggle,
  inputClass,
  priceSummary,
} from "./admin-ui";
import {
  classificationForSlot,
  moveItem,
  rankForSlot,
  setDefault,
  setRender,
} from "./model-helpers";

type Item = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  price: Price;
  lines?: string[];
};

function ItemCard<T extends Item>({
  item,
  index,
  count,
  regions,
  onChange,
  onMove,
  onDelete,
  onMakeDefault,
  defaultLabel = "Default",
  extra,
  showLines,
  testId,
}: {
  item: T;
  index: number;
  count: number;
  regions: Region[];
  onChange: (item: T) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onMakeDefault?: () => void;
  defaultLabel?: string;
  extra?: ReactNode;
  showLines?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-sm",
        item.enabled ? "border-[var(--acton-border)]" : "border-dashed border-gray-300 opacity-75",
      )}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <TextInput
          value={item.name}
          onChange={(e) => onChange({ ...item, name: e.target.value })}
          className="max-w-xs font-semibold"
          aria-label="Name"
        />
        <Toggle
          checked={item.enabled}
          onChange={(v) => onChange({ ...item, enabled: v })}
          label="Offered"
        />
        {onMakeDefault ? (
          item.isDefault ? (
            <Pill tone="blue">{defaultLabel}</Pill>
          ) : (
            <button
              type="button"
              onClick={onMakeDefault}
              className="text-xs font-semibold text-[#0088FF] hover:underline"
            >
              Make {defaultLabel.toLowerCase()}
            </button>
          )
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-[var(--acton-navy)] hover:bg-gray-50"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="tabular-nums">{priceSummary(item.price, regions)}</span>
          {item.price.needsReview ? <Pill tone="amber">Review</Pill> : null}
        </button>
        <button
          type="button"
          aria-label="Delete"
          onClick={onDelete}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {extra ? (
        <div className="border-t border-[var(--acton-border)] px-4 py-3">{extra}</div>
      ) : null}
      {showLines ? (
        <div className="border-t border-[var(--acton-border)] px-4 py-3">
          <span className="mb-1 block text-xs font-semibold text-[var(--acton-muted)]">
            Bullet points shown on the card (one per line)
          </span>
          <textarea
            className={cn(inputClass, "h-24 py-2")}
            value={(item.lines ?? []).join("\n")}
            onChange={(e) => onChange({ ...item, lines: e.target.value.split("\n") })}
            onBlur={(e) =>
              onChange({
                ...item,
                lines: e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      ) : null}
      {open ? (
        <div className="border-t border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-4">
          <RegionPriceEditor
            price={item.price}
            regions={regions}
            onChange={(price) => onChange({ ...item, price })}
            label="Pricing by Region"
            allowZeroNote
          />
        </div>
      ) : null}
    </div>
  );
}

function useListEditor<K extends "options" | "appliances" | "upgrades" | "bathrooms">(
  model: Model,
  key: K,
) {
  const { updateModel } = useAdmin();
  type T = Model[K][number];
  const items = [...(model[key] as T[])].sort((a, b) => a.sortOrder - b.sortOrder);
  const set = (next: T[]) => updateModel(model.id, (m) => ({ ...m, [key]: next }));
  return {
    items,
    set,
    change: (item: T) => set(items.map((i) => (i.id === item.id ? item : i))),
    move: (index: number, delta: -1 | 1) => set(moveItem(items, index, delta)),
    remove: (id: string) =>
      set(items.filter((i) => i.id !== id).map((i, n) => ({ ...i, sortOrder: n }))),
    makeDefault: (id: string) => set(setDefault(items, (i) => i.id === id)),
  };
}

function AddRow({
  placeholder,
  onAdd,
  label,
}: {
  placeholder: string;
  onAdd: (name: string) => void;
  label: string;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName("");
      }}
    >
      <TextInput
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="max-w-xs"
        aria-label={label}
      />
      <button
        type="submit"
        className="inline-flex h-10 items-center gap-1 rounded-md bg-[var(--acton-navy)] px-3 text-sm font-semibold text-white disabled:opacity-50"
        disabled={!name.trim()}
      >
        <Plus className="h-4 w-4" /> {label}
      </button>
    </form>
  );
}

function DeleteConfirm({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => {
        onConfirm();
        onClose();
      }}
      title={`Remove “${name}”?`}
      description="It is removed from this model's draft. Customers keep seeing it until you publish. You can also turn it off instead."
      confirmLabel="Remove"
      destructive
    />
  );
}

// ---------------------------------------------------------------------------

export function OptionsTab({ model }: { model: Model }) {
  const { catalog } = useAdmin();
  const list = useListEditor(model, "options");
  const [deleting, setDeleting] = useState<ModelOption | null>(null);
  return (
    <Panel
      title="Model Options"
      description={
        list.items.some((o) => o.enabled)
          ? "Customers choose one of these right after picking the model (e.g. Standard / With Porch). Porch options show the porch exterior renderings."
          : "This model has no options, so customers go straight from Choose a Model to Exterior Styles."
      }
      actions={
        <AddRow
          placeholder="e.g. With Porch"
          label="Add option"
          onAdd={(name) => list.set([...list.items, newModelOption(name, list.items)])}
        />
      }
    >
      <div className="space-y-3">
        {list.items.map((o, i) => (
          <ItemCard
            key={o.id}
            item={o}
            index={i}
            count={list.items.length}
            regions={catalog.regions}
            onChange={list.change}
            onMove={(d) => list.move(i, d)}
            onDelete={() => setDeleting(o)}
            onMakeDefault={() => list.makeDefault(o.id)}
            testId={`option-card-${o.id}`}
            extra={
              <label className="flex items-center gap-2 text-sm">
                <span className="text-[var(--acton-muted)]">Exterior renderings:</span>
                <select
                  className={cn(inputClass, "h-9 w-auto")}
                  value={o.exteriorVariant}
                  onChange={(e) =>
                    list.change({
                      ...o,
                      exteriorVariant: e.target.value as ModelOption["exteriorVariant"],
                    })
                  }
                >
                  <option value="standard">Standard (no porch)</option>
                  <option value="porch">With porch</option>
                </select>
              </label>
            }
          />
        ))}
        {list.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--acton-border)] p-6 text-center text-sm text-[var(--acton-muted)]">
            No model options. The step is skipped automatically.
          </p>
        ) : null}
      </div>
      {deleting ? (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => list.remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Panel>
  );
}

export function AppliancesTab({ model }: { model: Model }) {
  const { catalog, updateModel } = useAdmin();
  const list = useListEditor(model, "appliances");
  const [deleting, setDeleting] = useState<AppliancePackage | null>(null);
  const interiors = model.interiors
    .filter((u) => u.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  return (
    <Panel
      title="Appliances"
      description="Each package shows its Appliance Base or Appliance Mid rendering for the customer's interior style. Ceiling height does not change appliance renderings."
      actions={
        <AddRow
          placeholder="e.g. Premium"
          label="Add package"
          onAdd={(name) => list.set([...list.items, newAppliance(name, list.items)])}
        />
      }
    >
      <div className="space-y-3">
        {list.items.map((a, i) => (
          <ItemCard
            key={a.id}
            item={a}
            index={i}
            count={list.items.length}
            regions={catalog.regions}
            onChange={list.change}
            onMove={(d) => list.move(i, d)}
            onDelete={() => setDeleting(a)}
            onMakeDefault={() => list.makeDefault(a.id)}
            showLines
            testId={`appliance-card-${a.id}`}
            extra={
              <div>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <span className="text-[var(--acton-muted)]">Rendering used:</span>
                  <select
                    className={cn(inputClass, "h-9 w-auto")}
                    value={a.renderRole}
                    onChange={(e) =>
                      list.change({
                        ...a,
                        renderRole: e.target.value as AppliancePackage["renderRole"],
                      })
                    }
                  >
                    <option value="appliance_base">Appliance Base</option>
                    <option value="appliance_mid">Appliance Mid</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {interiors.map((u) => {
                    const slot = {
                      type: "int" as const,
                      styleId: u.styleId,
                      role: a.renderRole,
                      ceiling: "8" as const,
                    };
                    return (
                      <ImageSlot
                        key={u.styleId}
                        label={styleName(u.styleId)}
                        sublabel={ROLE_LABELS[a.renderRole]}
                        assetId={model.renders[slotKey(slot)] ?? null}
                        onChange={(id) => updateModel(model.id, (m) => setRender(m, slot, id))}
                        classification={classificationForSlot(model, slot)}
                        suggest={rankForSlot(model, slot)}
                        required
                      />
                    );
                  })}
                </div>
              </div>
            }
          />
        ))}
      </div>
      {deleting ? (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => list.remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Panel>
  );
}

const EFFECT_TEXT: Record<Upgrade["effect"], string> = {
  none: "No change (the “No Upgrade” card)",
  ceiling_9ft: "9-ft ceilings — switches exterior and interior renderings to the 9-ft versions",
  lighting: "Lighting — shows the Lighting Dusk Uplights rendering",
  other: "Price only — renderings do not change",
};

export function UpgradesTab({ model }: { model: Model }) {
  const { catalog } = useAdmin();
  const list = useListEditor(model, "upgrades");
  const [deleting, setDeleting] = useState<Upgrade | null>(null);
  return (
    <Panel
      title="Upgrades"
      description={
        catalog.settings.upgradeSelection === "single"
          ? "Customers pick one upgrade card (as on the current site). Change this in Settings to let upgrades combine."
          : "Customers can combine upgrades (for example 9-ft ceilings plus lighting)."
      }
      actions={
        <AddRow
          placeholder="e.g. 9-foot Ceiling"
          label="Add upgrade"
          onAdd={(name) => list.set([...list.items, newUpgrade(name, list.items)])}
        />
      }
    >
      <div className="space-y-3">
        {list.items.map((u, i) => (
          <ItemCard
            key={u.id}
            item={u}
            index={i}
            count={list.items.length}
            regions={catalog.regions}
            onChange={list.change}
            onMove={(d) => list.move(i, d)}
            onDelete={() => setDeleting(u)}
            onMakeDefault={() =>
              list.set(
                list.items.map((x) => ({
                  ...x,
                  isDefault: x.id === u.id,
                  effect: x.id === u.id ? "none" : x.effect,
                })),
              )
            }
            defaultLabel="No-upgrade card"
            showLines
            testId={`upgrade-card-${u.id}`}
            extra={
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[var(--acton-muted)]">What it changes:</span>
                <select
                  className={cn(inputClass, "h-9 w-auto max-w-full")}
                  value={u.effect}
                  onChange={(e) =>
                    list.change({ ...u, effect: e.target.value as Upgrade["effect"] })
                  }
                >
                  {(Object.keys(EFFECT_TEXT) as Upgrade["effect"][]).map((k) => (
                    <option key={k} value={k}>
                      {EFFECT_TEXT[k]}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
        ))}
      </div>
      {deleting ? (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => list.remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Panel>
  );
}

export function BathroomsTab({ model }: { model: Model }) {
  const { catalog, updateModel } = useAdmin();
  const list = useListEditor(model, "bathrooms");
  const [deleting, setDeleting] = useState<BathroomOption | null>(null);
  const interiors = model.interiors
    .filter((u) => u.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const styleName = (id: string) => catalog.styles.find((s) => s.id === id)?.name ?? id;
  return (
    <Panel
      title="Bathrooms"
      description="Customers see “<interior style> <bathroom>”, e.g. “California Coastal Shower Pan”. Each bathroom needs a rendering per interior style."
      actions={
        <AddRow
          placeholder="e.g. Bathtub"
          label="Add bathroom"
          onAdd={(name) => list.set([...list.items, newBathroom(name, list.items)])}
        />
      }
    >
      <div className="space-y-3">
        {list.items.map((b, i) => (
          <ItemCard
            key={b.id}
            item={b}
            index={i}
            count={list.items.length}
            regions={catalog.regions}
            onChange={list.change}
            onMove={(d) => list.move(i, d)}
            onDelete={() => setDeleting(b)}
            onMakeDefault={() => list.makeDefault(b.id)}
            testId={`bathroom-card-${b.id}`}
            extra={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {interiors.map((u) => {
                  const slot = { type: "bath" as const, styleId: u.styleId, bathroomId: b.id };
                  return (
                    <ImageSlot
                      key={u.styleId}
                      label={styleName(u.styleId)}
                      sublabel={b.name}
                      assetId={model.renders[slotKey(slot)] ?? null}
                      onChange={(id) => updateModel(model.id, (m) => setRender(m, slot, id))}
                      classification={classificationForSlot(model, slot, b.name)}
                      suggest={rankForSlot(model, slot)}
                      required={b.enabled}
                    />
                  );
                })}
              </div>
            }
          />
        ))}
      </div>
      {deleting ? (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => list.remove(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </Panel>
  );
}
