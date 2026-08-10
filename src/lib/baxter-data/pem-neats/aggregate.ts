/**
 * Deterministic PEM NEAT aggregation — parameterized filters → SQL counts/lists.
 * The LLM extracts parameters only; numbers always come from this module.
 */

import "server-only";

import {
  endOfZonedDay,
  getZonedYmd,
  resolveFeedbackDateRange,
  startOfZonedDay,
  type DateRangeBounds,
  type FeedbackRangePreset,
  BAXTER_REPORTING_TIMEZONE,
} from "@/lib/baxter-ai/feedback-date-ranges";
import {
  MEETING_OUTCOMES,
  QUALIFICATION_LEVELS,
  type MeetingOutcome,
  type QualificationLevel,
} from "@/lib/pem-neat/constants";
import { listSalespeople, type SalespersonOption } from "@/lib/pem-neat/salespeople";
import { getPemNeatStore } from "@/lib/pem-neat/store";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import type { PemNeatListItem } from "@/lib/pem-neat/types";

/** Statuses counted as completed PEMs (analysis exists). Soft-deleted always excluded. */
export const PEM_AGGREGATE_COUNTABLE_STATUSES = ["completed", "needs_regeneration"] as const;

export type PemAggregateFilters = {
  salespersonUserId?: string | null;
  salespersonDisplayName?: string | null;
  dateRange?: DateRangeBounds | null;
  outcome?: MeetingOutcome | null;
  qualification?: QualificationLevel | null;
};

export type PemAggregateRow = {
  id: string;
  prospect_name: string;
  salesperson_user_id: string | null;
  salesperson_display_name: string;
  meeting_date: string | null;
  meeting_outcome: MeetingOutcome | null;
  qualification: QualificationLevel | null;
  status: string;
};

export type PemAggregateResult = {
  total: number;
  byOutcome: Record<MeetingOutcome | "UNSET", number>;
  byQualification: Record<QualificationLevel | "UNSET", number>;
  bySalesperson: Array<{ name: string; userId: string | null; count: number }>;
  matching: PemAggregateRow[];
  countedStatuses: readonly string[];
  filtersApplied: {
    salesperson: string | null;
    dateLabel: string | null;
    outcome: MeetingOutcome | null;
    qualification: QualificationLevel | null;
  };
};

export type PemAggregateQueryParams = {
  intent: "count" | "list" | "breakdown";
  salespersonName: string | null;
  datePreset: FeedbackRangePreset | null;
  customStart: string | null;
  customEnd: string | null;
  /** 1–12 when the user named a calendar month ("August"). */
  calendarMonth: number | null;
  calendarYear: number | null;
  outcome: MeetingOutcome | null;
  qualification: QualificationLevel | null;
  includeOutcomeBreakdown: boolean;
  highlightOutcomes: MeetingOutcome[];
};

const EMPTY_OUTCOME_COUNTS = (): Record<MeetingOutcome | "UNSET", number> => ({
  YES: 0,
  NO: 0,
  DECISION_DATE: 0,
  DECISION_DATE_NOT_SECURED: 0,
  UNSET: 0,
});

const EMPTY_QUAL_COUNTS = (): Record<QualificationLevel | "UNSET", number> => ({
  STRONGLY_QUALIFIED: 0,
  QUALIFIED_WITH_RISKS: 0,
  EARLY_EXPLORATORY: 0,
  WEAKLY_QUALIFIED: 0,
  DISQUALIFIED: 0,
  UNSET: 0,
});

function shouldUseMemory(): boolean {
  const env = getEnv();
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function normalizePerson(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a spoken month ("August") + optional year to Pacific calendar bounds.
 * Defaults to the most recent occurrence of that month (this year if that month
 * has started or is current; otherwise last year).
 */
export function resolveCalendarMonthRange(input: {
  month: number;
  year?: number | null;
  now?: Date;
  timeZone?: string;
}): DateRangeBounds {
  const timeZone = input.timeZone ?? BAXTER_REPORTING_TIMEZONE;
  const now = input.now ?? new Date();
  const today = getZonedYmd(now, timeZone);
  const month = Math.min(12, Math.max(1, Math.floor(input.month)));
  let year = input.year ?? null;
  if (year == null) {
    year = month <= today.month ? today.year : today.year - 1;
  }
  const start = startOfZonedDay(year, month, 1, timeZone);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const firstNext = startOfZonedDay(nextYear, nextMonth, 1, timeZone);
  const lastDayYmd = getZonedYmd(new Date(firstNext.getTime() - 12 * 60 * 60 * 1000), timeZone);
  const end = endOfZonedDay(lastDayYmd.year, lastDayYmd.month, lastDayYmd.day, timeZone);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function resolveAggregateDateRange(
  params: Pick<
    PemAggregateQueryParams,
    "datePreset" | "customStart" | "customEnd" | "calendarMonth" | "calendarYear"
  >,
  now?: Date,
): { range: DateRangeBounds; label: string | null } {
  if (params.calendarMonth != null && params.calendarMonth >= 1 && params.calendarMonth <= 12) {
    const range = resolveCalendarMonthRange({
      month: params.calendarMonth,
      year: params.calendarYear,
      now,
    });
    const startYmd = range.start ? getZonedYmd(new Date(range.start)) : null;
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const label = startYmd
      ? `${monthNames[startYmd.month - 1]} ${startYmd.year}`
      : `month ${params.calendarMonth}`;
    return { range, label };
  }

  const preset = params.datePreset ?? "all_time";
  if (preset === "all_time" && !params.customStart && !params.customEnd) {
    return { range: { start: null, end: null }, label: null };
  }

  const useCustom = preset === "custom" || Boolean(params.customStart && params.customEnd);
  const range = resolveFeedbackDateRange({
    preset: useCustom ? "custom" : preset,
    customStart: params.customStart,
    customEnd: params.customEnd,
    now,
  });

  const labels: Record<FeedbackRangePreset, string> = {
    this_week: "this week",
    this_month: "this month",
    last_month: "last month",
    this_year: "this year",
    last_7_days: "the last 7 days",
    last_30_days: "the last 30 days",
    all_time: "all time",
    custom: "the selected date range",
  };
  if (useCustom) {
    return {
      range,
      label:
        params.customStart && params.customEnd
          ? `${params.customStart} → ${params.customEnd}`
          : labels.custom,
    };
  }
  return { range, label: labels[preset] ?? null };
}

export function parseMeetingOutcome(raw: string | null | undefined): MeetingOutcome | null {
  if (!raw) return null;
  const n = raw.trim().toUpperCase().replace(/\s+/g, "_");
  const aliases: Record<string, MeetingOutcome> = {
    YES: "YES",
    NO: "NO",
    DECISION_DATE: "DECISION_DATE",
    DECISION_DATE_NOT_SECURED: "DECISION_DATE_NOT_SECURED",
    DECISION_DATE_NOT_SECURE: "DECISION_DATE_NOT_SECURED",
    DDNS: "DECISION_DATE_NOT_SECURED",
  };
  if (aliases[n]) return aliases[n]!;
  return (MEETING_OUTCOMES as readonly string[]).includes(n) ? (n as MeetingOutcome) : null;
}

export function parseQualification(raw: string | null | undefined): QualificationLevel | null {
  if (!raw) return null;
  const n = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return (QUALIFICATION_LEVELS as readonly string[]).includes(n) ? (n as QualificationLevel) : null;
}

/**
 * Match a spoken salesperson name against Sales profiles.
 * Prefer exact/full matches over first-name-only.
 */
export function matchSalespersonName(
  spoken: string,
  salespeople: SalespersonOption[],
  extraDisplayNames: string[] = [],
): { match: SalespersonOption | null; ambiguous: SalespersonOption[]; unrecognized: boolean } {
  const needle = normalizePerson(spoken);
  if (!needle) return { match: null, ambiguous: [], unrecognized: true };

  const scored = salespeople
    .map((sp) => {
      const full = normalizePerson(sp.displayName);
      let score = 0;
      if (full === needle) score = 100;
      else if (full.startsWith(needle) || needle.startsWith(full)) score = 90;
      else if (full.split(" ").some((p) => p === needle)) score = 70;
      else if (full.includes(needle) || needle.includes(full)) score = 60;
      return { sp, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const extras = extraDisplayNames
      .map((n) => ({ name: n, norm: normalizePerson(n) }))
      .filter(
        (x) => x.norm && (x.norm === needle || x.norm.includes(needle) || needle.includes(x.norm)),
      );
    if (extras.length === 1) {
      return {
        match: { id: "", displayName: extras[0]!.name, role: null },
        ambiguous: [],
        unrecognized: false,
      };
    }
    return { match: null, ambiguous: [], unrecognized: true };
  }

  const top = scored[0]!;
  const tied = scored.filter((x) => x.score === top.score && x.score >= 70);
  if (tied.length > 1 && top.score < 100) {
    return { match: null, ambiguous: tied.map((t) => t.sp), unrecognized: false };
  }
  return { match: top.sp, ambiguous: [], unrecognized: false };
}

function meetingDateInRange(meetingDate: string | null, range: DateRangeBounds): boolean {
  if (!range.start && !range.end) return true;
  if (!meetingDate) return false;
  const startYmd = range.start ? getZonedYmd(new Date(range.start)) : null;
  const endYmd = range.end ? getZonedYmd(new Date(range.end)) : null;
  const [y, m, d] = meetingDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  const key = y * 10_000 + m * 100 + d;
  if (startYmd) {
    const startKey = startYmd.year * 10_000 + startYmd.month * 100 + startYmd.day;
    if (key < startKey) return false;
  }
  if (endYmd) {
    const endKey = endYmd.year * 10_000 + endYmd.month * 100 + endYmd.day;
    if (key > endKey) return false;
  }
  return true;
}

function isCountableStatus(status: string): boolean {
  return (PEM_AGGREGATE_COUNTABLE_STATUSES as readonly string[]).includes(status);
}

function toAggregateRow(item: PemNeatListItem): PemAggregateRow {
  return {
    id: item.id,
    prospect_name: item.prospect_name,
    salesperson_user_id: item.salesperson_user_id,
    salesperson_display_name: item.salesperson_display_name,
    meeting_date: item.meeting_date,
    meeting_outcome: item.meeting_outcome,
    qualification: item.qualification,
    status: item.status,
  };
}

function summarize(
  rows: PemAggregateRow[],
  filtersApplied: PemAggregateResult["filtersApplied"],
): PemAggregateResult {
  const byOutcome = EMPTY_OUTCOME_COUNTS();
  const byQualification = EMPTY_QUAL_COUNTS();
  const bySpMap = new Map<string, { name: string; userId: string | null; count: number }>();

  for (const row of rows) {
    const outcomeKey = row.meeting_outcome ?? "UNSET";
    byOutcome[outcomeKey] = (byOutcome[outcomeKey] ?? 0) + 1;
    const qualKey = row.qualification ?? "UNSET";
    byQualification[qualKey] = (byQualification[qualKey] ?? 0) + 1;
    const spKey = row.salesperson_user_id || row.salesperson_display_name || "unknown";
    const existing = bySpMap.get(spKey);
    if (existing) existing.count += 1;
    else {
      bySpMap.set(spKey, {
        name: row.salesperson_display_name || "Unknown",
        userId: row.salesperson_user_id,
        count: 1,
      });
    }
  }

  return {
    total: rows.length,
    byOutcome,
    byQualification,
    bySalesperson: [...bySpMap.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
    matching: rows,
    countedStatuses: PEM_AGGREGATE_COUNTABLE_STATUSES,
    filtersApplied,
  };
}

async function aggregateFromMemory(filters: PemAggregateFilters): Promise<PemAggregateResult> {
  const store = getPemNeatStore();
  const listed = await store.list({
    salespersonUserId: filters.salespersonUserId || undefined,
    outcome: filters.outcome || undefined,
  });
  const range = filters.dateRange ?? { start: null, end: null };
  const rows = listed
    .filter((item) => isCountableStatus(item.status))
    .filter((item) => {
      if (filters.salespersonDisplayName && !filters.salespersonUserId) {
        return (
          normalizePerson(item.salesperson_display_name) ===
          normalizePerson(filters.salespersonDisplayName)
        );
      }
      return true;
    })
    .filter((item) => meetingDateInRange(item.meeting_date, range))
    .filter((item) => !filters.qualification || item.qualification === filters.qualification)
    .map(toAggregateRow);

  return summarize(rows, {
    salesperson: filters.salespersonDisplayName ?? null,
    dateLabel: null,
    outcome: filters.outcome ?? null,
    qualification: filters.qualification ?? null,
  });
}

/** Bounded SQL aggregation over non-deleted countable PEM NEATs. */
export async function aggregatePemNeats(filters: PemAggregateFilters): Promise<PemAggregateResult> {
  if (shouldUseMemory()) {
    return aggregateFromMemory(filters);
  }

  const supabase = createServiceClient();
  const pageSize = 500;
  const hardCap = 2_000;
  const all: PemAggregateRow[] = [];
  let from = 0;

  while (all.length < hardCap) {
    let query = supabase
      .from("pem_neats")
      .select(
        "id, prospect_name, salesperson_user_id, salesperson_display_name, meeting_date, meeting_outcome, qualification, status",
      )
      .is("deleted_at", null)
      .in("status", [...PEM_AGGREGATE_COUNTABLE_STATUSES])
      .order("meeting_date", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (filters.salespersonUserId) {
      query = query.eq("salesperson_user_id", filters.salespersonUserId);
    }
    if (filters.outcome) {
      query = query.eq("meeting_outcome", filters.outcome);
    }
    if (filters.qualification) {
      query = query.eq("qualification", filters.qualification);
    }

    const range = filters.dateRange;
    if (range?.start) {
      const startYmd = getZonedYmd(new Date(range.start));
      const startDate = `${startYmd.year}-${String(startYmd.month).padStart(2, "0")}-${String(startYmd.day).padStart(2, "0")}`;
      query = query.gte("meeting_date", startDate);
    }
    if (range?.end) {
      const endYmd = getZonedYmd(new Date(range.end));
      const endDate = `${endYmd.year}-${String(endYmd.month).padStart(2, "0")}-${String(endYmd.day).padStart(2, "0")}`;
      query = query.lte("meeting_date", endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as PemAggregateRow[];
    if (batch.length === 0) break;

    for (const row of batch) {
      if (
        filters.salespersonDisplayName &&
        !filters.salespersonUserId &&
        normalizePerson(row.salesperson_display_name) !==
          normalizePerson(filters.salespersonDisplayName)
      ) {
        continue;
      }
      all.push(row);
    }

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return summarize(all, {
    salesperson: filters.salespersonDisplayName ?? null,
    dateLabel: null,
    outcome: filters.outcome ?? null,
    qualification: filters.qualification ?? null,
  });
}

export type ResolvePemAggregateInput = {
  params: PemAggregateQueryParams;
  now?: Date;
  listSalespeopleImpl?: () => Promise<SalespersonOption[]>;
  aggregateImpl?: typeof aggregatePemNeats;
};

export type ResolvedPemAggregate =
  | {
      kind: "ok";
      result: PemAggregateResult;
      params: PemAggregateQueryParams;
      dateLabel: string | null;
      salesperson: SalespersonOption | null;
    }
  | { kind: "unrecognized_salesperson"; name: string }
  | { kind: "ambiguous_salesperson"; name: string; options: SalespersonOption[] };

export async function resolveAndAggregatePemNeats(
  input: ResolvePemAggregateInput,
): Promise<ResolvedPemAggregate> {
  const params = input.params;
  const listFn = input.listSalespeopleImpl ?? listSalespeople;
  const aggregateFn = input.aggregateImpl ?? aggregatePemNeats;
  const { range, label: dateLabel } = resolveAggregateDateRange(params, input.now);

  let salesperson: SalespersonOption | null = null;
  if (params.salespersonName?.trim()) {
    const salespeople = await listFn();
    const matched = matchSalespersonName(params.salespersonName, salespeople);
    if (matched.unrecognized) {
      return { kind: "unrecognized_salesperson", name: params.salespersonName.trim() };
    }
    if (matched.ambiguous.length > 0) {
      return {
        kind: "ambiguous_salesperson",
        name: params.salespersonName.trim(),
        options: matched.ambiguous,
      };
    }
    salesperson = matched.match;
  }

  const result = await aggregateFn({
    salespersonUserId: salesperson?.id || null,
    salespersonDisplayName: salesperson?.displayName || null,
    dateRange: range,
    outcome: params.outcome,
    qualification: params.qualification,
  });

  result.filtersApplied = {
    salesperson: salesperson?.displayName ?? null,
    dateLabel,
    outcome: params.outcome,
    qualification: params.qualification,
  };

  return { kind: "ok", result, params, dateLabel, salesperson };
}

const PROSPECT_LIST_CAP = 12;

function outcomeLabel(o: MeetingOutcome | "UNSET"): string {
  if (o === "UNSET") return "outcome not set";
  return o.replaceAll("_", " ");
}

/** Format a factual aggregate answer — numbers only, no performance commentary. */
export function formatPemAggregateAnswer(input: {
  resolved: Extract<ResolvedPemAggregate, { kind: "ok" }>;
  libraryPath?: string;
}): string {
  const { result, params, dateLabel, salesperson } = input.resolved;
  const who = salesperson?.displayName;
  const when = dateLabel;
  const scopeBits = [
    who ? `salesperson ${who}` : null,
    when ? when : null,
    params.outcome ? `outcome ${outcomeLabel(params.outcome)}` : null,
    params.qualification ? `qualification ${params.qualification.replaceAll("_", " ")}` : null,
  ].filter(Boolean);
  const scope = scopeBits.length ? scopeBits.join(", ") : "all countable PEM NEATs";

  const lines: string[] = [];

  if (params.intent === "list" && params.outcome) {
    lines.push(
      result.total === 0
        ? `No completed PEM NEATs match ${scope}.`
        : `${result.total} completed PEM NEAT${result.total === 1 ? "" : "s"} match ${scope}.`,
    );
  } else if (params.highlightOutcomes.length > 0 && !params.outcome) {
    const totalLine = who
      ? `${who} ran ${result.total} completed PEM${result.total === 1 ? "" : "s"}${when ? ` in ${when}` : ""}.`
      : `${result.total} completed PEM${result.total === 1 ? "" : "s"}${when ? ` in ${when}` : ""}.`;
    lines.push(totalLine);
    for (const o of params.highlightOutcomes) {
      const n = result.byOutcome[o] ?? 0;
      lines.push(`${n} resulted in ${outcomeLabel(o)}.`);
    }
  } else if (params.outcome) {
    lines.push(
      `${result.total} completed PEM${result.total === 1 ? "" : "s"} with outcome ${outcomeLabel(params.outcome)}${who ? ` for ${who}` : ""}${when ? ` in ${when}` : ""}.`,
    );
  } else {
    lines.push(
      who
        ? `${who} ran ${result.total} completed PEM${result.total === 1 ? "" : "s"}${when ? ` in ${when}` : ""}.`
        : `${result.total} completed PEM${result.total === 1 ? "" : "s"}${when ? ` in ${when}` : ""}.`,
    );
  }

  if (params.includeOutcomeBreakdown && result.total > 0 && !params.outcome) {
    const parts = (MEETING_OUTCOMES as readonly MeetingOutcome[])
      .map((o) => {
        const n = result.byOutcome[o] ?? 0;
        return n > 0 ? `${n} ${outcomeLabel(o)}` : null;
      })
      .filter(Boolean);
    const unset = result.byOutcome.UNSET ?? 0;
    if (unset > 0) parts.push(`${unset} outcome not set`);
    if (parts.length) lines.push(`Breakdown: ${parts.join(", ")}.`);
  }

  if (params.intent === "breakdown" && !who && result.bySalesperson.length > 0) {
    const top = result.bySalesperson.slice(0, 8);
    lines.push(
      `By salesperson: ${top.map((s) => `${s.name} ${s.count}`).join("; ")}${
        result.bySalesperson.length > top.length ? "; …" : ""
      }.`,
    );
  }

  if (result.total > 0 && result.total <= PROSPECT_LIST_CAP) {
    const names = result.matching.map((r) => r.prospect_name).join("; ");
    lines.push(`Prospects: ${names}.`);
  } else if (result.total > PROSPECT_LIST_CAP) {
    const path = input.libraryPath ?? "/pem-neats";
    lines.push(
      `${result.total} matching records — open the PEM NEAT library (${path}) to browse the full list.`,
    );
  }

  lines.push("");
  lines.push(
    `Source: PEM NEAT records (completed / needs regeneration only; soft-deleted excluded)${scopeBits.length ? `; filters: ${scope}` : ""}.`,
  );

  return lines.join("\n");
}

export function formatPemAggregateUnrecognized(name: string): string {
  return `I don’t recognize “${name}” as a salesperson in Baxter, so I can’t count PEM NEATs for them. Check the name against the Sales roster on the PEM NEAT form, or ask about a different person.`;
}

export function formatPemAggregateAmbiguous(name: string, options: SalespersonOption[]): string {
  const list = options.map((o) => o.displayName).join(", ");
  return `“${name}” matches more than one salesperson (${list}). Which one did you mean?`;
}

/** Client-safe summary counts for the library filter view. */
export function summarizePemLibraryCounts(items: Array<{ meeting_outcome: string | null }>): {
  total: number;
  yes: number;
} {
  let yes = 0;
  for (const item of items) {
    if (item.meeting_outcome === "YES") yes += 1;
  }
  return { total: items.length, yes };
}
