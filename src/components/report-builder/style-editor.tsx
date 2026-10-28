"use client";

/**
 * Report style editor (edit mode): the report's palette, density, spacing, type size, card
 * style, and per-widget appearance (palette, legend, KPI colors, table look, grouped-table
 * buttons). Everything is validated with the same schema the server uses; changes land in
 * the draft and are saved as a new report version like any other edit. Dexter can set the
 * same options (and finer ones such as value colors and conditional rules) in conversation.
 */

import { useState } from "react";
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
import { widgetSchema, type ReportSpec, type WidgetSpec } from "@/lib/reports/spec";
import {
  CARD_STYLES,
  DENSITIES,
  LEGEND_POSITIONS,
  PALETTES,
  SPACINGS,
  themeSchema,
  TYPE_SCALES,
  type ReportTheme,
} from "@/lib/reports/style";

const selectCls = "h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm";

type Look = Record<string, unknown>;

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-[var(--acton-navy)]">
      {label}
      <select
        className={`${selectCls} mt-1 font-normal`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
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

const opts = (xs: readonly string[]) =>
  xs.map((x) => [x, x[0]!.toUpperCase() + x.slice(1)] as const);
const paletteOpts = Object.entries(PALETTES).map(([k, p]) => [k, p.label] as const);

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--acton-navy)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function ReportStyleDialog({
  spec,
  onClose,
  onApply,
}: {
  spec: ReportSpec;
  onClose: () => void;
  onApply: (theme: ReportTheme | undefined, widgets: WidgetSpec[]) => void;
}) {
  const [theme, setTheme] = useState<ReportTheme>(spec.theme ?? {});
  const [looks, setLooks] = useState<Record<string, Look>>(() =>
    Object.fromEntries(
      spec.widgets.map((w) => [w.id, { ...((w as { appearance?: Look }).appearance ?? {}) }]),
    ),
  );
  const [widgetId, setWidgetId] = useState(spec.widgets[0]?.id ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const w = spec.widgets.find((x) => x.id === widgetId);
  const look = looks[widgetId] ?? {};
  const setLook = (patch: Look) => {
    const next = { ...look, ...patch };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    setLooks({ ...looks, [widgetId]: next });
  };
  const setTheme1 = (patch: Partial<ReportTheme>) => {
    const next = { ...theme, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    setTheme(next as ReportTheme);
  };
  const controls = (look.controls as Record<string, boolean> | undefined) ?? {};
  const legend = (look.legend as Record<string, unknown> | undefined) ?? {};

  const apply = () => {
    const problems: string[] = [];
    const t = themeSchema.safeParse(theme);
    if (!t.success)
      problems.push(...t.error.issues.map((i) => `Theme ${i.path.join(".")}: ${i.message}`));
    const widgets = spec.widgets.map((x) => {
      const appearance = looks[x.id];
      const next = { ...x } as Record<string, unknown>;
      if (appearance && Object.keys(appearance).length) next.appearance = appearance;
      else delete next.appearance;
      const parsed = widgetSchema.safeParse(next);
      if (!parsed.success) {
        problems.push(
          ...parsed.error.issues.map((i) => `${x.title || x.id} ${i.path.join(".")}: ${i.message}`),
        );
        return x;
      }
      return parsed.data;
    });
    if (problems.length) return setErrors(problems);
    const empty = !t.success || Object.keys(t.data).length === 0;
    onApply(empty ? undefined : t.data, widgets);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Report style</DialogTitle>
        <DialogCloseButton />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Whole report</h3>
            <p className="text-xs text-[var(--acton-muted)]">
              Leave everything on Default to keep the standard look. Ask Dexter for finer control
              such as phase colors or conditional colors.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Select
                label="Palette"
                value={theme.palette}
                options={paletteOpts}
                onChange={(v) => setTheme1({ palette: v })}
              />
              <Select
                label="Density"
                value={theme.density}
                options={opts(DENSITIES)}
                onChange={(v) => setTheme1({ density: v as ReportTheme["density"] })}
              />
              <Select
                label="Spacing"
                value={theme.spacing}
                options={opts(SPACINGS)}
                onChange={(v) => setTheme1({ spacing: v as ReportTheme["spacing"] })}
              />
              <Select
                label="Text size"
                value={theme.typography}
                options={[
                  ["sm", "Small"],
                  ["md", "Medium"],
                  ["lg", "Large"],
                ]}
                onChange={(v) => setTheme1({ typography: v as ReportTheme["typography"] })}
              />
              <Select
                label="Cards"
                value={theme.card}
                options={opts(CARD_STYLES)}
                onChange={(v) => setTheme1({ card: v as ReportTheme["card"] })}
              />
            </div>
          </section>
          {w ? (
            <section className="border-t border-[var(--acton-border)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--acton-navy)]">Widget</h3>
              <select
                aria-label="Widget to style"
                className={`${selectCls} mt-1`}
                value={widgetId}
                onChange={(e) => setWidgetId(e.target.value)}
              >
                {spec.widgets.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title || x.id} ({x.type})
                  </option>
                ))}
              </select>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Select
                  label="Card"
                  value={look.card as string}
                  options={opts(CARD_STYLES)}
                  onChange={(v) => setLook({ card: v })}
                />
                <Select
                  label="Text size"
                  value={look.typography as string}
                  options={TYPE_SCALES.map(
                    (x) => [x, x === "sm" ? "Small" : x === "md" ? "Medium" : "Large"] as const,
                  )}
                  onChange={(v) => setLook({ typography: v })}
                />
                {w.type === "table" ? (
                  <Select
                    label="Row density"
                    value={look.density as string}
                    options={opts(DENSITIES)}
                    onChange={(v) => setLook({ density: v })}
                  />
                ) : null}
                {w.type === "chart" ? (
                  <>
                    <Select
                      label="Palette"
                      value={look.palette as string}
                      options={paletteOpts}
                      onChange={(v) => setLook({ palette: v })}
                    />
                    <Select
                      label="Legend"
                      value={legend.show === false ? "none" : (legend.position as string)}
                      options={opts(LEGEND_POSITIONS)}
                      onChange={(v) =>
                        setLook({
                          legend: v
                            ? v === "none"
                              ? { show: false }
                              : { position: v }
                            : undefined,
                        })
                      }
                    />
                  </>
                ) : null}
                {w.type === "table" ? (
                  <>
                    <Select
                      label="Header"
                      value={look.header as string}
                      options={opts(["default", "muted", "bold", "accent"])}
                      onChange={(v) => setLook({ header: v })}
                    />
                    <Select
                      label="Dividers"
                      value={look.dividers as string}
                      options={opts(["rows", "none", "grid"])}
                      onChange={(v) => setLook({ dividers: v })}
                    />
                  </>
                ) : null}
              </div>
              {w.type === "table" ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Toggle
                    label="Striped rows"
                    checked={Boolean(look.zebra)}
                    onChange={(v) => setLook({ zebra: v || undefined })}
                  />
                  {(
                    [
                      ["search", "Search box"],
                      ["columns", "Columns button"],
                      ["expandAll", "Expand all"],
                      ["collapseAll", "Collapse all"],
                      ["expandToLevel", "Expand to level"],
                    ] as const
                  ).map(([k, label]) => (
                    <Toggle
                      key={k}
                      label={`Show “${label}”`}
                      checked={controls[k] !== false}
                      onChange={(v) => {
                        const next = { ...controls, [k]: v };
                        for (const [ck, cv] of Object.entries(next)) if (cv) delete next[ck];
                        setLook({ controls: Object.keys(next).length ? next : undefined });
                      }}
                    />
                  ))}
                </div>
              ) : null}
              {w.type === "kpi" ? (
                <p className="mt-2 text-xs text-[var(--acton-muted)]">
                  KPI colors and thresholds (e.g. “red below 20%”) are easiest to set by asking
                  Dexter.
                </p>
              ) : null}
            </section>
          ) : null}
          {errors.length ? (
            <Notice tone="error">
              <ul className="list-disc pl-4">
                {errors.slice(0, 6).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            setTheme({});
            setLooks(Object.fromEntries(spec.widgets.map((x) => [x.id, {}])));
          }}
        >
          Reset all to default
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={apply}>Apply</Button>
      </DialogFooter>
    </Dialog>
  );
}
