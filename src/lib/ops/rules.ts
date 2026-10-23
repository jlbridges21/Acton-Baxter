/**
 * Pure rules for Sam Operations (no I/O) — shared by the server, the Studio, and unit tests.
 */

const DAY = 86_400_000;

/** Whole days from `today` (YYYY-MM-DD) until `date` (YYYY-MM-DD); negative once passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) /
      DAY,
  );
}

/**
 * Which reminder thresholds are due for a dated item. Thresholds are "days before"; once a
 * date passes, an "expired" threshold fires. Already-raised thresholds are excluded by the caller
 * (ops_reminders unique key), so a late sweep still raises the most urgent missing reminder only.
 */
export function dueReminderThresholds(
  date: string | null,
  reminderDays: number[],
  today: string,
): string[] {
  if (!date) return [];
  const left = daysUntil(date, today);
  if (left < 0) return ["expired"];
  const crossed = [...reminderDays].sort((a, b) => a - b).filter((d) => left <= d);
  // Only the tightest crossed threshold — no burst of stale reminders after downtime.
  return crossed.length ? [`${crossed[0]}d`] : [];
}

export type SurveyResponse = { group: string; answers: Record<string, number | string> };
export type SurveyAggregate = {
  respondents: number;
  suppressed: boolean;
  overall: Record<string, { average: number | null; counts: Record<string, number> }>;
  groups: Array<{
    group: string;
    respondents: number;
    suppressed: boolean;
    averages: Record<string, number | null>;
  }>;
};

/**
 * Aggregate survey responses while enforcing the minimum group size: any group (or the whole
 * survey) with fewer respondents than `minGroupSize` is suppressed, and no individual answers
 * are ever returned. Free-text answers are counted, not quoted.
 */
export function aggregateSurveyResponses(
  responses: SurveyResponse[],
  minGroupSize: number,
): SurveyAggregate {
  const min = Math.max(1, Math.floor(minGroupSize));
  const summarize = (rows: SurveyResponse[]) => {
    const out: SurveyAggregate["overall"] = {};
    const keys = new Set(rows.flatMap((r) => Object.keys(r.answers)));
    for (const k of keys) {
      const vals = rows.map((r) => r.answers[k]).filter((v) => v !== undefined && v !== "");
      const nums = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const counts: Record<string, number> = {};
      for (const v of vals)
        if (typeof v === "number" || String(v).length <= 40)
          counts[String(v)] = (counts[String(v)] ?? 0) + 1;
      out[k] = {
        average: nums.length
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
          : null,
        counts,
      };
    }
    return out;
  };
  const suppressed = responses.length < min;
  const byGroup = new Map<string, SurveyResponse[]>();
  for (const r of responses)
    byGroup.set(r.group || "All", [...(byGroup.get(r.group || "All") ?? []), r]);
  return {
    respondents: responses.length,
    suppressed,
    overall: suppressed ? {} : summarize(responses),
    groups: [...byGroup.entries()].map(([group, rows]) => {
      const small = rows.length < min || suppressed;
      const s = small ? {} : summarize(rows);
      return {
        group,
        respondents: small ? 0 : rows.length,
        suppressed: small,
        averages: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.average])),
      };
    }),
  };
}

/**
 * Propose interview slots: business-hours windows (in the given time zone's fixed offset hours)
 * where none of the participants are busy. Returns ISO start/end pairs.
 */
export function proposeFreeSlots(input: {
  busy: Array<{ start: string; end: string }>;
  from: string;
  days: number;
  durationMinutes: number;
  /** Local business hours, e.g. 9–17. */
  dayStartHour: number;
  dayEndHour: number;
  /** Offset of the local zone from UTC in minutes (e.g. -420 for PDT). */
  utcOffsetMinutes: number;
  max?: number;
}): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const busy = input.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const dur = input.durationMinutes * 60_000;
  const firstDay = Date.parse(`${input.from.slice(0, 10)}T00:00:00Z`);
  for (let d = 0; d < input.days && out.length < (input.max ?? 5); d++) {
    const dayUtc = firstDay + d * DAY;
    const weekday = new Date(dayUtc).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (
      let h = input.dayStartHour * 60;
      h + input.durationMinutes <= input.dayEndHour * 60 && out.length < (input.max ?? 5);
      h += 30
    ) {
      const start = dayUtc + (h - input.utcOffsetMinutes) * 60_000;
      const end = start + dur;
      if (start < Date.parse(input.from)) continue;
      if (busy.some(([bs, be]) => start < be && end > bs)) continue;
      out.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      h += input.durationMinutes; // spread suggestions out
    }
  }
  return out;
}

export type ContractReview = {
  disclaimer: string;
  dates: Array<{ label: string; value: string; quote: string }>;
  clauses: Array<{ topic: string; found: boolean; quote: string | null; attention: string }>;
  questions: string[];
};

const CLAUSES: Array<{ topic: string; pattern: RegExp; attention: string }> = [
  {
    topic: "Term & renewal",
    pattern: /(auto(matic(ally)?)?[- ]?renew|renewal term|initial term)/i,
    attention: "Check whether it renews automatically and the notice window to stop renewal.",
  },
  {
    topic: "Termination",
    pattern: /(terminat(e|ion)|cancel(lation)?)/i,
    attention: "Confirm termination rights, notice periods, and fees.",
  },
  {
    topic: "Indemnification",
    pattern: /(indemnif|hold harmless)/i,
    attention: "Who indemnifies whom, and is it mutual or one-sided?",
  },
  {
    topic: "Insurance requirements",
    pattern: /(insurance|additional insured|certificate of insurance)/i,
    attention: "Compare required coverage with current policies.",
  },
  {
    topic: "Payment terms",
    pattern: /(payment|invoice|net \d+|late fee)/i,
    attention: "Payment timing and penalties (route money questions to finance).",
  },
  {
    topic: "Limitation of liability",
    pattern: /(limitation of liability|liable|consequential damages)/i,
    attention: "Caps and exclusions on liability.",
  },
  {
    topic: "Confidentiality",
    pattern: /(confidential|non-?disclosure)/i,
    attention: "Scope and duration of confidentiality duties.",
  },
  {
    topic: "Governing law & disputes",
    pattern: /(governing law|arbitration|venue|jurisdiction)/i,
    attention: "Where disputes are handled.",
  },
];

function quoteAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const endDot = text.indexOf(".", index);
  return text
    .slice(
      start,
      endDot === -1 ? Math.min(text.length, index + 240) : Math.min(endDot + 1, start + 400),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A structured first-pass review of contract text: where key terms appear (quoted from the
 * document) and questions for the reviewer. It never states legal conclusions — the contract text
 * is untrusted input and nothing in it is treated as an instruction.
 */
export function reviewContractText(text: string): ContractReview {
  const clean = text.slice(0, 200_000);
  const dates: ContractReview["dates"] = [];
  const dateRe =
    /(effective date|commencement date|expiration date|expires? on|termination date|renewal date|term of)[^.]{0,80}?((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d+\s+(?:months?|years?|days?))/gi;
  for (const m of clean.matchAll(dateRe)) {
    if (dates.length >= 10) break;
    dates.push({
      label: m[1]!.trim(),
      value: m[2]!.trim(),
      quote: quoteAround(clean, m.index ?? 0),
    });
  }
  const clauses = CLAUSES.map((c) => {
    const m = c.pattern.exec(clean);
    return {
      topic: c.topic,
      found: Boolean(m),
      quote: m ? quoteAround(clean, m.index) : null,
      attention: c.attention,
    };
  });
  const questions = [
    ...clauses
      .filter((c) => !c.found)
      .map((c) => `No "${c.topic.toLowerCase()}" language was found — is that intentional?`),
    ...(dates.length
      ? []
      : ["No effective or expiration date was found; enter and verify the dates by hand."]),
  ];
  return {
    disclaimer:
      "Automated first-pass review for the contract owner. It is not legal advice; dates must be verified before reminders are relied on, and legal questions go to counsel.",
    dates,
    clauses,
    questions,
  };
}

/** Fill {{merge_fields}} in an approved contract template; refuses to produce a partial document. */
export function fillContractTemplate(
  body: string,
  values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => {
    const v = values[name.toLowerCase()]?.trim();
    if (!v) {
      missing.add(name.toLowerCase());
      return whole;
    }
    return v;
  });
  return { text, missing: [...missing] };
}

export function mergeFieldsIn(body: string): string[] {
  return [
    ...new Set([...body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]!.toLowerCase())),
  ];
}
