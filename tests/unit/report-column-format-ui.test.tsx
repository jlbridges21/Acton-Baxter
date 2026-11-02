/** @vitest-environment jsdom */

/**
 * Column formatting and drill affordances in the renderer: formats apply by stable column id
 * (not field ref or position), conditional colors read raw values, edit mode offers the column
 * editor, and grouped subtotals open drills. Synthetic results only.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColumnFormatDialog } from "@/components/report-builder/column-format-editor";
import { GroupedTable } from "@/components/report-builder/grouped-table";
import { WidgetBody } from "@/components/report-builder/widgets";
import type { TableResult } from "@/lib/reports/result-types";
import { widgetSchema, type WidgetSpec } from "@/lib/reports/spec";

afterEach(cleanup);

const result = (groups = false): TableResult => ({
  id: "t",
  kind: "table",
  status: "ok",
  columns: [
    {
      key: "job.name",
      label: "Job",
      type: "text",
      origin: "x",
      ref: "job.name",
      columnId: "job_name",
    },
    {
      key: "job.projectedPrice",
      label: "Price",
      type: "currency",
      origin: "x",
      ref: "job.projectedPrice",
      columnId: "price",
    },
  ],
  rows: [
    { id: "a", cells: { "job.name": "Alpha", "job.projectedPrice": -1500.25 } },
    { id: "b", cells: { "job.name": "Beta", "job.projectedPrice": 999.6 } },
  ],
  totalRows: 2,
  truncated: false,
  ...(groups
    ? {
        groupLevels: [{ key: "cf:phase", label: "Phase" }],
        groups: [
          {
            id: '["Design"]',
            level: 0,
            field: "cf:phase",
            fieldLabel: "Phase",
            label: "Design",
            count: 2,
            values: { "job.projectedPrice": -500.65 },
            children: [],
            rowIds: ["a", "b"],
          },
        ],
        totals: { "job.projectedPrice": -500.65 },
        expandDepth: 1,
      }
    : {}),
});

const widget = (columnFormats?: unknown): WidgetSpec =>
  widgetSchema.parse({
    id: "t",
    type: "table",
    dataset: "jobs",
    columns: [{ field: "job.name" }, { id: "price", field: "job.projectedPrice" }],
    ...(columnFormats ? { appearance: { columnFormats } } : {}),
  });

describe("column formats by stable id", () => {
  it("formats numbers, colors negatives, and evaluates rules on raw values", () => {
    render(
      <WidgetBody
        spec={widget({
          price: {
            number: { style: "currency", decimals: 0, negative: "red_parens" },
            header: { bold: true, background: "#1f6feb" },
            rules: [{ op: "lt", value: 1000, style: { background: "#fff5d6" } }],
          },
        })}
        result={result()}
        actions={{}}
      />,
    );
    expect(screen.getByText("($1,500)")).toBeTruthy();
    // 999.6 displays as $1,000 but the rule compares the raw value (< 1000) → highlighted.
    const cell = screen.getByText("$1,000").closest("td")!;
    expect(cell.style.backgroundColor).toBe("rgb(255, 245, 214)");
    const header = screen.getByRole("columnheader", { name: /Price/ });
    expect(header.style.fontWeight).toBe("700");
    expect(screen.getByText("Alpha")).toBeTruthy(); // other columns untouched
  });

  it("hides a column by default without dropping its data, and offers the editor in edit mode", () => {
    const onFormat = vi.fn();
    render(
      <WidgetBody
        spec={widget({ price: { hidden: true } })}
        result={result()}
        actions={{ onFormatColumn: onFormat }}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: /Price/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Format column Job" }));
    expect(onFormat).toHaveBeenCalledWith("job_name");
  });

  it("opens drills from grouped subtotals with the group path and column id", () => {
    const onDrill = vi.fn();
    render(
      <GroupedTable
        widget={widget({ price: { number: { style: "currency", decimals: 2 } } })}
        result={result(true)}
        onDrillGroup={onDrill}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Drill into Price for Design" });
    fireEvent.click(buttons[0]!);
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ widgetId: "t", path: ["Design"], columnId: "price" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the 2 records in Design" }));
    expect(onDrill).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: ["Design"], columnId: undefined }),
    );
  });
});

describe("column editor", () => {
  it("applies a preset, validates, and resets", () => {
    const onApply = vi.fn();
    render(
      <ColumnFormatDialog
        column={{ id: "price", label: "Price", type: "currency" }}
        others={[{ id: "job_name", label: "Job" }]}
        current={undefined}
        theme={null}
        sample={-1500.25}
        onClose={() => undefined}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Negatives in red" }));
    expect(screen.getByText("($1,500)")).toBeTruthy(); // live preview; the value stays -1500.25
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ number: { negative: "red_parens" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onApply).toHaveBeenLastCalledWith(undefined);
  });
});
