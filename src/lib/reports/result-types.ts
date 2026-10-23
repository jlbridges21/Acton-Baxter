/** Shapes returned by report execution (server → browser). Only authorized values appear here. */

import type { CellValue, ChartPoint } from "./compute";
import type { FieldType } from "./fields";

export type FieldMeta = {
  key: string;
  label: string;
  type: FieldType;
  description?: string;
  origin: string;
  wrap?: boolean;
};

export type Provenance = {
  source: string;
  fields: Array<{ key: string; label: string; origin: string }>;
  filters: string[];
  calculation: string;
  rows: number;
  /** Rows with a usable value for the measured field (completeness). */
  withValue?: number;
  notes: string[];
};

export type WidgetStatus = "ok" | "empty" | "restricted" | "error";

type Base = { id: string; status: WidgetStatus; message?: string; provenance?: Provenance };

export type KpiResult = Base & {
  kind: "kpi";
  value: number | null;
  fieldType: FieldType | "count";
};
export type ChartResult = Base & {
  kind: "chart";
  points: ChartPoint[];
  seriesKeys: string[];
  valueType: FieldType | "count";
  groupLabel: string;
  metricLabel: string;
  scatter?: Array<{ id: string; label: string; x: number; y: number }>;
  xLabel?: string;
  yLabel?: string;
};
export type TableResult = Base & {
  kind: "table";
  columns: FieldMeta[];
  rows: Array<{
    id: string;
    cells: Record<string, CellValue>;
    tone?: string;
    jobtreadUrl?: string;
  }>;
  totalRows: number;
  truncated: boolean;
};
export type DetailResult = Base & {
  kind: "detail";
  jobId: string | null;
  items: Array<{
    key: string;
    label: string;
    type: FieldType;
    value: CellValue;
    restricted?: boolean;
    missing?: boolean;
  }>;
  live: boolean;
};
export type HeaderResult = Base & {
  kind: "project_header";
  jobId: string | null;
  name: string | null;
  number: string | null;
  customer: string | null;
  address: string | null;
  badges: Array<{ label: string; value: string }>;
  jobtreadUrl: string | null;
  live: boolean;
};
export type MilestonesResult = Base & {
  kind: "milestones";
  jobId: string | null;
  milestones: Array<{
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    completedTasks: number;
    totalTasks: number;
    status: "complete" | "in_progress" | "not_started";
    kind: "schedule" | "checklist";
  }>;
};
export type DocumentsResult = Base & {
  kind: "documents";
  jobId: string | null;
  files: Array<{
    id: string;
    name: string;
    folder: string | null;
    type: string | null;
    createdAt: string | null;
  }>;
  jobtreadUrl: string | null;
};
export type TextResult = Base & { kind: "text"; body: string };

export type WidgetResult =
  | KpiResult
  | ChartResult
  | TableResult
  | DetailResult
  | HeaderResult
  | MilestonesResult
  | DocumentsResult
  | TextResult;

export type ControlOptions =
  | {
      kind: "job_picker";
      id: string;
      options: Array<{ value: string; label: string }>;
      selected: string | null;
    }
  | {
      kind: "select";
      id: string;
      options: Array<{ value: string; count: number }>;
      selected: string[];
      restricted?: boolean;
    }
  | { kind: "search"; id: string; value: string }
  | {
      kind: "number_range";
      id: string;
      min: number | null;
      max: number | null;
      selected: [number | null, number | null];
    }
  | { kind: "date_range"; id: string; selected: [string | null, string | null] };

export type ExecutionResult = {
  widgets: Record<string, WidgetResult>;
  controls: Record<string, ControlOptions>;
  freshness: {
    syncedAt: string | null;
    liveFetchedAt: string | null;
    source: string;
    connected: boolean;
  };
  issues: string[];
  restrictedWidgets: number;
  durationMs: number;
};

export type ControlState = Record<
  string,
  string | string[] | [number | null, number | null] | [string | null, string | null] | null
>;
