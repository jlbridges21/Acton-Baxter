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
  /** The field reference as written in the spec (for per-column appearance). */
  ref?: string;
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
  /** Set when a viewer's metric choice replaced the KPI's own metric. */
  label?: string;
};
export type ChartResult = Base & {
  kind: "chart";
  points: ChartPoint[];
  seriesKeys: string[];
  valueType: FieldType | "count";
  groupLabel: string;
  metricLabel: string;
  /** Field refs behind the categories and series (for value-bound colors). */
  groupField?: string;
  seriesField?: string;
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
    /** First matching appearance rule (evaluated server-side with field access checks). */
    ruleStyle?: { color?: string; background?: string; accent?: string; emphasis?: string };
    jobtreadUrl?: string;
  }>;
  totalRows: number;
  truncated: boolean;
  /** Nested groups (groupLevels or a viewer's grouping), each with subtotals. */
  groups?: TableGroup[];
  groupLevels?: Array<{ key: string; label: string }>;
  /** Grand total across all records (computed from records, not from group subtotals). */
  totals?: Record<string, CellValue>;
  totalsIncomplete?: Record<string, number>;
  /** Levels expanded by default; viewers' own expand/collapse choices are kept per viewer. */
  expandDepth?: number;
  sortedBy?: { key: string; dir: "asc" | "desc" } | null;
};

export type TableGroup = {
  /** Stable path id (JSON array of labels). */
  id: string;
  level: number;
  field: string;
  fieldLabel: string;
  label: string;
  count: number;
  /** Subtotals keyed by column key (blank when the column isn't aggregated). */
  values: Record<string, CellValue>;
  /** Column key → records in this group without a value (excluded from the subtotal). */
  incomplete?: Record<string, number>;
  children: TableGroup[];
  /** Deepest level only: the records in this group (ids into `rows`). */
  rowIds: string[];
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
export type DataStatusResult = Base & {
  kind: "data_status";
  datasets: Array<{
    entity: string;
    label: string;
    level: FreshnessLevel;
    lastSuccessAt: string | null;
    message: string | null;
  }>;
};
export type RuleEditorResult = Base & {
  kind: "rule_editor";
  editor: "rates" | "assignments";
  ruleSet: string;
  ruleSetName: string | null;
  /** A template's placeholder: no live rule set behind it. */
  template?: boolean;
  canEdit: boolean;
};

export type WidgetResult =
  | KpiResult
  | ChartResult
  | TableResult
  | DetailResult
  | HeaderResult
  | MilestonesResult
  | DocumentsResult
  | TextResult
  | DataStatusResult
  | RuleEditorResult;

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
  | { kind: "date_range"; id: string; selected: [string | null, string | null] }
  | {
      kind: "group_by";
      id: string;
      options: Array<{ value: string; label: string }>;
      selected: string[];
      maxLevels: number;
    }
  | {
      kind: "sort";
      id: string;
      options: Array<{ value: string; label: string }>;
      selected: { field: string; dir: "asc" | "desc" } | null;
    }
  | {
      kind: "metric_picker";
      id: string;
      options: Array<{ value: string; label: string }>;
      selected: string;
    };

export type FreshnessLevel =
  "fresh" | "stale" | "never" | "failed" | "disabled" | "running" | "not_configured";

/** Freshness of the synced datasets a report depends on (src/lib/reports/dependencies.ts). */
export type DataHealthSummary = {
  status: "ok" | "warning";
  entities: Array<{
    entity: string;
    label: string;
    level: FreshnessLevel;
    lastSuccessAt: string | null;
    message: string | null;
    widgets: string[];
  }>;
  warnings: string[];
  /** Widget id → missing/stale data warnings for that widget. */
  widgetWarnings: Record<string, string[]>;
  liveWidgets: string[];
};

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
  /** Null when the Sync Manager isn't available (e.g. migration 075 not applied yet). */
  dataHealth?: DataHealthSummary | null;
};

export type ControlState = Record<
  string,
  string | string[] | [number | null, number | null] | [string | null, string | null] | null
>;
