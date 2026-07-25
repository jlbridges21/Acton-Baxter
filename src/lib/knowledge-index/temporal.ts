/**
 * Temporal / date-range understanding for structured sales queries.
 */

export type TimeRangeFilter = {
  field: string;
  fromIso: string;
  toIso: string;
  label: string;
  year?: number;
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function iso(d: Date): string {
  return d.toISOString();
}

/**
 * Parse natural-language time filters relative to `now` (server time).
 * Defaults the date field to Close Date for sales questions.
 */
export function parseTimeRangeFromQuestion(
  question: string,
  now: Date = new Date(),
  defaultField = "Close Date",
): TimeRangeFilter | null {
  const q = question.toLowerCase();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (/\b(year to date|ytd)\b/.test(q) || /\bthis year\b/.test(q)) {
    const from = new Date(Date.UTC(y, 0, 1));
    const to = endOfDay(now);
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(to),
      label: `${y} YTD`,
      year: y,
    };
  }

  if (/\blast year\b/.test(q)) {
    const from = new Date(Date.UTC(y - 1, 0, 1));
    const to = endOfDay(new Date(Date.UTC(y - 1, 11, 31)));
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(to),
      label: String(y - 1),
      year: y - 1,
    };
  }

  if (/\bthis month\b/.test(q)) {
    const from = new Date(Date.UTC(y, m, 1));
    const to = endOfDay(now);
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(to),
      label: `${y}-${String(m + 1).padStart(2, "0")}`,
    };
  }

  if (/\blast month\b/.test(q)) {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    const from = new Date(Date.UTC(ly, lm, 1));
    const lastDay = new Date(Date.UTC(ly, lm + 1, 0));
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(endOfDay(lastDay)),
      label: `${ly}-${String(lm + 1).padStart(2, "0")}`,
    };
  }

  if (/\btrailing 12\b|\btrailing twelve\b|\blast 12 months\b/.test(q)) {
    const from = new Date(Date.UTC(y, m - 11, 1));
    return {
      field: defaultField,
      fromIso: iso(startOfDay(from)),
      toIso: iso(endOfDay(now)),
      label: "trailing 12 months",
    };
  }

  const yearMatch = q.match(/\bin (20\d{2})\b/);
  if (yearMatch?.[1]) {
    const year = Number(yearMatch[1]);
    return {
      field: defaultField,
      fromIso: iso(new Date(Date.UTC(year, 0, 1))),
      toIso: iso(endOfDay(new Date(Date.UTC(year, 11, 31)))),
      label: String(year),
      year,
    };
  }

  const qMatch = q.match(/\bq([1-4])(?:\s+(20\d{2}))?\b/);
  if (qMatch?.[1]) {
    const quarter = Number(qMatch[1]);
    const year = qMatch[2] ? Number(qMatch[2]) : y;
    const startMonth = (quarter - 1) * 3;
    const from = new Date(Date.UTC(year, startMonth, 1));
    const to = endOfDay(new Date(Date.UTC(year, startMonth + 3, 0)));
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(to),
      label: `Q${quarter} ${year}`,
      year,
    };
  }

  if (/\bsince january\b/.test(q)) {
    const from = new Date(Date.UTC(y, 0, 1));
    return {
      field: defaultField,
      fromIso: iso(from),
      toIso: iso(endOfDay(now)),
      label: `since January ${y}`,
      year: y,
    };
  }

  return null;
}

export function cellMatchesTimeRange(
  dateIso: string | null | undefined,
  range: TimeRangeFilter,
): boolean {
  if (!dateIso) return false;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return false;
  const from = Date.parse(range.fromIso);
  const to = Date.parse(range.toIso);
  return t >= from && t <= to;
}
