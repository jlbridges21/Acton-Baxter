/**
 * Report integrity audit (server): static spec checks plus an execution with the viewer's own
 * access, so reconciliation and access boundaries are verified on real (cached) data.
 * Read-only.
 */

import "server-only";

import { canSeeField, type ReportsAccess } from "./access";
import { executeReport } from "./engine";
import { resolveField } from "./fields";
import { catalogFor } from "./metrics";
import {
  checkResultIntegrity,
  checkSpecIntegrity,
  type IntegrityFinding,
} from "./report-integrity";
import type { ReportSpec } from "./spec";

export async function auditReportIntegrity(input: {
  spec: ReportSpec;
  access: ReportsAccess;
  /** The stored (unparsed) spec, to catch duplicate explicit column ids. */
  rawSpec?: unknown;
}): Promise<{ findings: IntegrityFinding[]; summary: Record<string, number>; ok: boolean }> {
  const catalog = await catalogFor(input.spec);
  const findings = checkSpecIntegrity(
    input.spec,
    (ref) => {
      const r = resolveField(catalog, ref);
      return r.ok ? { ok: true, key: r.key } : { ok: false, reason: r.reason };
    },
    { rawSpec: input.rawSpec },
  );
  const allowed = new Set<string>(["__lines"]);
  for (const w of input.spec.widgets)
    if (w.type === "table")
      for (const c of w.columns) {
        const r = resolveField(catalog, c.field);
        if (r.ok && canSeeField(input.access, r.def)) allowed.add(r.key);
      }
  const result = await executeReport({ spec: input.spec, access: input.access });
  findings.push(...checkResultIntegrity(input.spec, result, { allowedKeys: allowed }));
  const summary: Record<string, number> = {};
  for (const f of findings) summary[f.kind] = (summary[f.kind] ?? 0) + 1;
  return { findings, summary, ok: !findings.some((f) => f.severity === "error") };
}
