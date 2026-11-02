/**
 * Project Manager completeness audit (pure). Explains *why* a job has no Project Manager in
 * reports, by class, without ever filling one in:
 *   mapping     — the business field isn't mapped, or its mapping is stale/conflicting
 *   exclusion   — an administrator excluded the JobTread field, so values aren't cached
 *   sync        — the field is allowed but no job has a cached value (run a jobs sync)
 *   source_data — the job really has no Project Manager in JobTread
 * Values outside the field's JobTread options and multi-person values are listed for review.
 */

export type PmFieldInfo = {
  semanticKey: string;
  label: string;
  customFieldId: string | null;
  fieldName: string | null;
  category: string | null;
  targetType: string | null;
  options: string[];
  removed: boolean;
  /** Alias audit status (ok, stale, conflict, ambiguous, …). */
  aliasStatus: string | null;
};

export type PmJob = {
  id: string;
  name: string;
  number: string | null;
  closed: boolean;
  phase: string | null;
  values: string[] | null;
};

export type PmDefect = { class: "mapping" | "exclusion" | "sync" | "source_data"; message: string };

export type PmAudit = {
  field: PmFieldInfo | null;
  totalJobs: number;
  openJobs: number;
  populated: number;
  populatedOpen: number;
  blank: number;
  completenessPct: number | null;
  byPm: Array<{ pm: string; jobs: number }>;
  byPhase: Array<{ phase: string; jobs: number; withPm: number }>;
  valuesOutsideOptions: Array<{ value: string; jobs: number }>;
  multiPersonJobs: number;
  blankOpenJobs: Array<{ id: string; name: string; number: string | null; phase: string | null }>;
  defects: PmDefect[];
};

export function auditProjectManager(input: { field: PmFieldInfo | null; jobs: PmJob[] }): PmAudit {
  const { field, jobs } = input;
  const defects: PmDefect[] = [];
  if (!field || !field.customFieldId)
    defects.push({
      class: "mapping",
      message:
        "The Project Manager business field isn't mapped to a JobTread field (Reports → Data settings → Business fields).",
    });
  else if (field.removed || field.aliasStatus === "stale")
    defects.push({
      class: "mapping",
      message: "The mapped JobTread field was removed; re-map Project Manager.",
    });
  else if (field.aliasStatus === "conflict" || field.aliasStatus === "ambiguous")
    defects.push({
      class: "mapping",
      message:
        "More than one JobTread field matches Project Manager; confirm the right one in Field mapping health.",
    });
  if (field?.category === "excluded")
    defects.push({
      class: "exclusion",
      message:
        "The Project Manager JobTread field is excluded under Field access, so its values aren't cached.",
    });
  if (field?.targetType && field.targetType !== "job")
    defects.push({
      class: "mapping",
      message: `Project Manager maps to a ${field.targetType} field; only job, location, and customer values are in reports.`,
    });
  const usable = !defects.some((d) => d.class !== "source_data");
  const options = new Set((field?.options ?? []).map((o) => o.trim().toLowerCase()));
  const pmCount = new Map<string, number>();
  const outside = new Map<string, number>();
  const phases = new Map<string, { jobs: number; withPm: number }>();
  let populated = 0;
  let populatedOpen = 0;
  let multi = 0;
  const blankOpen: PmAudit["blankOpenJobs"] = [];
  for (const j of jobs) {
    const vals = (j.values ?? []).map((v) => v.trim()).filter(Boolean);
    const phase = j.phase ?? "(No phase)";
    const p = phases.get(phase) ?? { jobs: 0, withPm: 0 };
    p.jobs++;
    if (vals.length) {
      populated++;
      p.withPm++;
      if (!j.closed) populatedOpen++;
      if (vals.length > 1) multi++;
      for (const v of vals) {
        pmCount.set(v, (pmCount.get(v) ?? 0) + 1);
        if (options.size && !options.has(v.toLowerCase()))
          outside.set(v, (outside.get(v) ?? 0) + 1);
      }
    } else if (!j.closed)
      blankOpen.push({ id: j.id, name: j.name, number: j.number, phase: j.phase });
    phases.set(phase, p);
  }
  const blank = jobs.length - populated;
  if (usable && field?.customFieldId && jobs.length > 0 && populated === 0)
    defects.push({
      class: "sync",
      message:
        "No job has a cached Project Manager value. If field access changed recently, run a jobs sync; otherwise the field is blank in JobTread.",
    });
  else if (usable && blank > 0)
    defects.push({
      class: "source_data",
      message: `${blank} of ${jobs.length} jobs have no Project Manager in JobTread. Baxter never fills one in; set it in JobTread.`,
    });
  const open = jobs.filter((j) => !j.closed).length;
  return {
    field,
    totalJobs: jobs.length,
    openJobs: open,
    populated,
    populatedOpen,
    blank,
    completenessPct:
      jobs.length && usable ? Math.round((populated / jobs.length) * 1000) / 10 : null,
    byPm: [...pmCount].map(([pm, n]) => ({ pm, jobs: n })).sort((a, b) => b.jobs - a.jobs),
    byPhase: [...phases].map(([phase, v]) => ({ phase, ...v })).sort((a, b) => b.jobs - a.jobs),
    valuesOutsideOptions: [...outside].map(([value, n]) => ({ value, jobs: n })),
    multiPersonJobs: multi,
    blankOpenJobs: blankOpen.slice(0, 100),
    defects,
  };
}
