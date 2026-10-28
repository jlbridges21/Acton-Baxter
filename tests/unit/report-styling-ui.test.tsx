/** @vitest-environment jsdom */

/**
 * Report styling in the renderer: unstyled widgets keep today's look, grouped-table buttons
 * can be hidden per widget, and KPI colors/rules apply. Synthetic results only.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupedTable } from "@/components/report-builder/grouped-table";
import { ReportThemeContext } from "@/components/report-builder/report-theme";
import { WidgetBody } from "@/components/report-builder/widgets";
import type { KpiResult, TableResult } from "@/lib/reports/result-types";
import { widgetSchema, type WidgetSpec } from "@/lib/reports/spec";

afterEach(cleanup);

const grouped: TableResult = {
  id: "t",
  kind: "table",
  status: "ok",
  columns: [
    { key: "job.name", label: "Job", type: "text", origin: "x", ref: "job.name" },
    {
      key: "job.projectedPrice",
      label: "Price",
      type: "currency",
      origin: "x",
      ref: "job.projectedPrice",
    },
  ],
  rows: [
    { id: "a", cells: { "job.name": "Alpha", "job.projectedPrice": 10 } },
    {
      id: "b",
      cells: { "job.name": "Beta", "job.projectedPrice": 20 },
      ruleStyle: { background: "#fff5d6" },
    },
  ],
  totalRows: 2,
  truncated: false,
  groupLevels: [
    { key: "cf:phase", label: "Phase" },
    { key: "job.city", label: "City" },
  ],
  groups: [
    {
      id: '["Design"]',
      level: 0,
      field: "cf:phase",
      fieldLabel: "Phase",
      label: "Design",
      count: 2,
      values: { "job.projectedPrice": 30 },
      children: [
        {
          id: '["Design","Testville"]',
          level: 1,
          field: "job.city",
          fieldLabel: "City",
          label: "Testville",
          count: 2,
          values: { "job.projectedPrice": 30 },
          children: [],
          rowIds: ["a", "b"],
        },
      ],
      rowIds: [],
    },
  ],
  totals: { "job.projectedPrice": 30 },
  expandDepth: 2,
};

const table = (appearance?: unknown): WidgetSpec =>
  widgetSchema.parse({
    id: "t",
    type: "table",
    dataset: "jobs",
    groupLevels: ["cf:phase00001", "job.city"],
    columns: [{ field: "job.name" }, { field: "job.projectedPrice" }],
    ...(appearance ? { appearance } : {}),
  });

describe("grouped table appearance", () => {
  it("shows every control by default", () => {
    render(<GroupedTable widget={table()} result={grouped} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Columns/ })).toBeTruthy();
    expect(screen.getByText("Expand to")).toBeTruthy();
  });

  it("hides the buttons a report turns off, without hiding the data", () => {
    render(
      <GroupedTable
        widget={table({
          density: "compact",
          controls: { expandAll: false, columns: false, expandToLevel: false },
        })}
        result={grouped}
      />,
    );
    expect(screen.queryByRole("button", { name: "Expand all" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
    expect(screen.queryByText("Expand to")).toBeNull();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    const beta = screen.getByText("Beta").closest("tr")!;
    expect(beta.style.backgroundColor).toBe("rgb(255, 245, 214)"); // server-evaluated rule
    expect(beta.querySelector("td:last-child")!.className).toContain("px-2 py-1");
  });
});

describe("KPI appearance", () => {
  const kpi = (appearance?: unknown): WidgetSpec =>
    widgetSchema.parse({
      id: "k",
      type: "kpi",
      dataset: "jobs",
      metric: { op: "count" },
      ...(appearance ? { appearance } : {}),
    });
  const result = (value: number): KpiResult => ({
    id: "k",
    kind: "kpi",
    status: "ok",
    value,
    fieldType: "percent",
  });

  it("renders the default look without inline colors", () => {
    render(<WidgetBody spec={kpi()} result={result(12)} actions={{}} />);
    const value = screen.getByText(/12/);
    expect(value.getAttribute("style")).toBeNull();
    expect(value.className).toContain("text-3xl");
  });

  it("applies the first matching rule over the base value color", () => {
    render(
      <ReportThemeContext.Provider value={{ typography: "lg" }}>
        <WidgetBody
          spec={kpi({
            valueColor: "#0b1f3a",
            rules: [{ op: "lt", value: 20, style: { color: "token:negative" } }],
          })}
          result={result(12)}
          actions={{}}
        />
      </ReportThemeContext.Provider>,
    );
    const value = screen.getByText(/12/);
    expect(value.style.color).toBe("rgb(227, 73, 72)");
    expect(value.className).toContain("text-4xl");
  });
});
