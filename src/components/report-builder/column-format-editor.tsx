"use client";

/**
 * Column editor (edit mode → paintbrush in a table column header): header and cell colors,
 * bold, alignment, number format (currency / percent / decimals / separators / negatives),
 * width, hidden-by-default, pinning, conditional cell rules, presets, and reset.
 *
 * It edits `appearance.columnFormats[<column id>]` — the same config Dexter writes with
 * set_column_format — validated with the server's schema. Presentation only: values,
 * formulas, filters, sorting, and exports are never touched. Changes land in the draft and
 * are saved as a new report version like any other edit.
 */

import { useMemo, useState } from "react";
import { Notice } from "@/components/ai/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  COLUMN_PRESETS,
  columnFormatSchema,
  formatNumberCell,
  mergeColumnFormat,
  NEGATIVE_STYLES,
  NUMBER_STYLES,
  type ColumnFormat,
} from "@/lib/reports/column-format";
import {
  RULE_OPS,
  TOKEN_NAMES,
  resolveColor,
  resolveTokens,
  type ReportTheme,
} from "@/lib/reports/style";

const inputCls = "h-8 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm";
type Patch = Record<string, unknown>;

/** Hex color picker with token swatches. Empty = default. */
export function ColorField({
  label,
  value,
  theme,
  onChange,
}: {
  label: string;
  value: string | undefined;
  theme: ReportTheme | null;
  onChange: (v: string | undefined) => void;
}) {
  const tokens = resolveTokens(theme);
  const shown = value ? resolveColor(value, tokens) : "#ffffff";
  return (
    <fieldset className="text-xs">
      <legend className="font-semibold text-[var(--acton-navy)]">{label}</legend>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} color`}
          value={/^#[0-9a-f]{6}$/i.test(shown) ? shown : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-[var(--acton-border)] bg-white"
        />
        <input
          aria-label={`${label} hex or token`}
          value={value ?? ""}
          placeholder="Default"
          onChange={(e) => onChange(e.target.value.trim() || undefined)}
          className="h-8 w-28 rounded-md border border-[var(--acton-border)] px-2 font-mono text-xs"
        />
        {(["accent", "positive", "warning", "negative", "info", "muted"] as const)
          .filter((t) => TOKEN_NAMES.includes(t))
          .map((t) => (
            <button
              key={t}
              type="button"
              title={t}
              aria-label={`Use the ${t} color`}
              onClick={() => onChange(`token:${t}`)}
              className="h-6 w-6 rounded-full border border-[var(--acton-border)]"
              style={{ backgroundColor: tokens[t] }}
            />
          ))}
        {value ? (
          <button type="button" className="text-xs underline" onClick={() => onChange(undefined)}>
            Clear
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-[var(--acton-navy)]">
      {label}
      <select
        className={`${inputCls} mt-1 font-normal`}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      >
        <option value="">Default</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const ALIGN_OPTS = [
  ["left", "Left"],
  ["center", "Center"],
  ["right", "Right"],
] as const;
const NUMBER_OPTS = NUMBER_STYLES.filter((x) => x !== "auto").map(
  (x) => [x, x === "plain" ? "Plain (no separators)" : x[0]!.toUpperCase() + x.slice(1)] as const,
);
const NEG_OPTS = NEGATIVE_STYLES.map(
  (x) =>
    [
      x,
      { minus: "-1,234", parens: "(1,234)", red: "-1,234 in red", red_parens: "(1,234) in red" }[x],
    ] as const,
);
const OP_LABEL: Record<string, string> = {
  eq: "equals",
  neq: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  contains: "contains",
  blank: "is blank",
  not_blank: "is not blank",
  in: "is one of",
  not_in: "is not one of",
};

export function ColumnFormatDialog({
  column,
  others,
  current,
  theme,
  sample,
  onClose,
  onApply,
  onSavePreset,
}: {
  column: { id: string; label: string; type: string };
  /** Other columns in the table (rules may read their raw values). */
  others: Array<{ id: string; label: string }>;
  current: ColumnFormat | undefined;
  theme: ReportTheme | null;
  /** A raw value from the current results, for the live preview. */
  sample: unknown;
  onClose: () => void;
  /** undefined = reset this column to the default look. */
  onApply: (format: ColumnFormat | undefined) => void;
  onSavePreset?: (key: string, label: string, format: ColumnFormat) => void;
}) {
  const [fmt, setFmt] = useState<Patch>(() => structuredClone(current ?? {}) as Patch);
  const [errors, setErrors] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("");
  const numeric = ["number", "currency", "percent", "sqft"].includes(column.type);
  const presets = useMemo(
    () => ({
      ...COLUMN_PRESETS,
      ...Object.fromEntries(
        Object.entries(theme?.columnPresets ?? {}).map(([k, p]) => [`report:${k}`, p]),
      ),
    }),
    [theme],
  );
  const part = (k: "header" | "cell" | "number") => (fmt[k] as Patch | undefined) ?? {};
  const set = (k: "header" | "cell" | "number", patch: Patch) => {
    const next = { ...part(k), ...patch };
    for (const [x, v] of Object.entries(next)) if (v === undefined) delete next[x];
    setFmt((f) => {
      const out = { ...f, [k]: next };
      if (!Object.keys(next).length) delete out[k];
      return out;
    });
  };
  const setTop = (patch: Patch) =>
    setFmt((f) => {
      const out = { ...f, ...patch };
      for (const [x, v] of Object.entries(out)) if (v === undefined) delete out[x];
      return out;
    });
  const rules = (fmt.rules as Patch[] | undefined) ?? [];
  const setRules = (next: Patch[]) => setTop({ rules: next.length ? next : undefined });

  const parsed = columnFormatSchema.safeParse(fmt);
  const preview =
    parsed.success && typeof sample === "number"
      ? (formatNumberCell(sample, column.type, parsed.data.number)?.text ?? String(sample))
      : null;

  const apply = () => {
    if (!parsed.success)
      return setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    onApply(Object.keys(parsed.data).length ? parsed.data : undefined);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Format column “{column.label}”</DialogTitle>
        <DialogCloseButton />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-5">
          <section aria-label="Presets">
            <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Presets</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(presets).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setFmt(mergeColumnFormat(fmt as ColumnFormat, p.format as Patch) as Patch)
                  }
                  className="rounded-full border border-[var(--acton-border)] px-2.5 py-1 text-xs hover:border-[var(--acton-navy)]"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Header</h3>
              <ColorField
                label="Background"
                value={part("header").background as string | undefined}
                theme={theme}
                onChange={(v) => set("header", { background: v })}
              />
              <ColorField
                label="Text"
                value={part("header").text as string | undefined}
                theme={theme}
                onChange={(v) => set("header", { text: v })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Seg
                  label="Align"
                  value={part("header").align as "left" | undefined}
                  options={ALIGN_OPTS}
                  onChange={(v) => set("header", { align: v })}
                />
                <label className="mt-5 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(part("header").bold)}
                    onChange={(e) => set("header", { bold: e.target.checked || undefined })}
                  />
                  Bold
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Cells</h3>
              <ColorField
                label="Background"
                value={part("cell").background as string | undefined}
                theme={theme}
                onChange={(v) => set("cell", { background: v })}
              />
              <ColorField
                label="Text"
                value={part("cell").text as string | undefined}
                theme={theme}
                onChange={(v) => set("cell", { text: v })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Seg
                  label="Align"
                  value={part("cell").align as "left" | undefined}
                  options={ALIGN_OPTS}
                  onChange={(v) => set("cell", { align: v })}
                />
                <label className="mt-5 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(part("cell").bold)}
                    onChange={(e) => set("cell", { bold: e.target.checked || undefined })}
                  />
                  Bold
                </label>
              </div>
            </div>
          </section>

          {numeric ? (
            <section>
              <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Numbers</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-4">
                <Seg
                  label="Format"
                  value={part("number").style as "number" | undefined}
                  options={NUMBER_OPTS}
                  onChange={(v) => set("number", { style: v })}
                />
                <label className="block text-xs font-semibold text-[var(--acton-navy)]">
                  Decimals
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={(part("number").decimals as number | undefined) ?? ""}
                    placeholder="Auto"
                    onChange={(e) =>
                      set("number", {
                        decimals: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} mt-1 font-normal`}
                  />
                </label>
                <Seg
                  label="Negatives"
                  value={part("number").negative as "minus" | undefined}
                  options={NEG_OPTS}
                  onChange={(v) => set("number", { negative: v })}
                />
                <label className="mt-5 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={part("number").thousands !== false}
                    onChange={(e) =>
                      set("number", { thousands: e.target.checked ? undefined : false })
                    }
                  />
                  Thousands separators
                </label>
              </div>
              {preview !== null ? (
                <p className="mt-2 text-xs text-[var(--acton-muted)]">
                  Preview: <span className="font-semibold text-[var(--acton-navy)]">{preview}</span>{" "}
                  (value {String(sample)} — the number itself never changes)
                </p>
              ) : null}
            </section>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Layout</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-semibold text-[var(--acton-navy)]">
                Width (px)
                <input
                  type="number"
                  min={60}
                  max={600}
                  value={(fmt.width as number | undefined) ?? ""}
                  placeholder="Auto"
                  onChange={(e) =>
                    setTop({ width: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                  className={`${inputCls} mt-1 font-normal`}
                />
              </label>
              <label className="mt-5 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={fmt.pin === "left"}
                  onChange={(e) => setTop({ pin: e.target.checked ? "left" : undefined })}
                />
                Pin to the left
              </label>
              <label className="mt-5 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(fmt.hidden)}
                  onChange={(e) => setTop({ hidden: e.target.checked || undefined })}
                />
                Hidden by default (viewers can show it)
              </label>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Conditional colors</h3>
            <p className="text-xs text-[var(--acton-muted)]">
              Rules compare the underlying value (e.g. 1250.5), not the formatted text. The first
              matching rule wins.
            </p>
            <ul className="mt-2 space-y-2">
              {rules.map((r, i) => {
                const style = (r.style as Patch | undefined) ?? {};
                const update = (patch: Patch) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <li
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-[var(--acton-border)] p-2"
                  >
                    <label className="text-xs">
                      When
                      <select
                        className={`${inputCls} mt-1 w-36`}
                        value={(r.column as string | undefined) ?? ""}
                        onChange={(e) => update({ column: e.target.value || undefined })}
                      >
                        <option value="">this column</option>
                        {others.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      is
                      <select
                        className={`${inputCls} mt-1 w-32`}
                        value={r.op as string}
                        onChange={(e) => update({ op: e.target.value })}
                      >
                        {RULE_OPS.map((op) => (
                          <option key={op} value={op}>
                            {OP_LABEL[op] ?? op}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!["blank", "not_blank"].includes(r.op as string) ? (
                      <label className="text-xs">
                        Value
                        {r.op === "between" || r.op === "in" || r.op === "not_in"
                          ? "s (comma-separated)"
                          : ""}
                        <input
                          className={`${inputCls} mt-1 w-36`}
                          value={
                            Array.isArray(r.value) ? r.value.join(", ") : String(r.value ?? "")
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            const toVal = (x: string) =>
                              x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : x.trim();
                            update({
                              value: ["between", "in", "not_in"].includes(r.op as string)
                                ? raw
                                    .split(",")
                                    .map(toVal)
                                    .filter((x) => x !== "")
                                : toVal(raw),
                            });
                          }}
                        />
                      </label>
                    ) : null}
                    <ColorField
                      label="Fill"
                      value={style.background as string | undefined}
                      theme={theme}
                      onChange={(v) => update({ style: { ...style, background: v } })}
                    />
                    <ColorField
                      label="Text"
                      value={style.color as string | undefined}
                      theme={theme}
                      onChange={(v) => update({ style: { ...style, color: v } })}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRules(rules.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
            {rules.length < 8 ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() =>
                  setRules([
                    ...rules,
                    {
                      op: numeric ? "lt" : "eq",
                      value: numeric ? 0 : "",
                      style: { color: "token:negative" },
                    },
                  ])
                }
              >
                Add rule
              </Button>
            ) : null}
          </section>

          {onSavePreset ? (
            <section className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-[var(--acton-navy)]">
                Save this look as a report preset
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Preset name"
                  className={`${inputCls} mt-1 w-56 font-normal`}
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={!presetName.trim() || !parsed.success}
                onClick={() => {
                  if (!parsed.success) return;
                  const key =
                    presetName
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_+|_+$/g, "")
                      .replace(/^(?![a-z])/, "p_")
                      .slice(0, 32) || "preset";
                  onSavePreset(key, presetName.trim().slice(0, 40), parsed.data);
                  setPresetName("");
                }}
              >
                Save preset
              </Button>
            </section>
          ) : null}

          {errors.length ? (
            <Notice tone="error">
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => {
            onApply(undefined);
            onClose();
          }}
        >
          Reset to default
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={apply}>Apply</Button>
      </DialogFooter>
    </Dialog>
  );
}
