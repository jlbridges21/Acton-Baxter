/**
 * Repairs for business-name aliases (sem:<key>). Every repair is explicit and audited by the
 * caller: remap to a live field id, clear the mapping, mark deprecated, or mark verified.
 * "Apply the suggested repair" uses the alias audit's certain repair (the declaration's
 * single verified exact match); nothing is chosen by label similarity.
 */

import "server-only";

import { agentDb, eq } from "@/lib/agents/store";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { analyzeAliases, type AliasFinding } from "./alias-audit";
import { listBusinessFields } from "./business-fields";
import { catalogSchemaReady, listCustomFields } from "./metadata";

export type AliasRepair =
  | { action: "remap"; fieldId: string }
  | { action: "apply_suggested" }
  | { action: "clear" }
  | { action: "deprecate"; note?: string }
  | { action: "verify"; note?: string };

async function findingFor(key: string): Promise<AliasFinding> {
  const [aliases, fields] = await Promise.all([
    listBusinessFields(),
    listCustomFields({ includeRemoved: true }),
  ]);
  const f = analyzeAliases(aliases, fields).get(key);
  if (!f) throw new NotFoundError(`Business name sem:${key} not found.`);
  return f;
}

/** Reports whose current spec references sem:<key> (for the dry-run impact list). */
async function reportsUsing(key: string) {
  const re = new RegExp(`"sem:${key}"`);
  const reports = await agentDb().select<{ id: string; title: string; spec: unknown }>(
    "bi_reports",
    { columns: "id, title, spec", limit: 2000 },
  );
  return reports
    .filter((r) => re.test(JSON.stringify(r.spec)))
    .map((r) => ({ id: r.id, title: r.title }));
}

export async function previewAliasRepair(key: string, repair: AliasRepair) {
  const finding = await findingFor(key);
  const fields = await listCustomFields();
  let to: { id: string; name: string } | null = finding.target;
  if (repair.action === "apply_suggested") {
    if (!finding.repair)
      throw new ValidationError(
        `sem:${key} has no certain repair${finding.candidates.length ? ` — choose one of: ${finding.candidates.map((c) => `${c.name} (cf:${c.id})`).join(", ")}` : ""}.`,
      );
    to = finding.repair;
  } else if (repair.action === "remap") {
    const f = fields.find((x) => x.id === repair.fieldId.replace(/^cf:/, ""));
    if (!f) throw new ValidationError(`cf:${repair.fieldId} isn't a live JobTread field.`);
    to = { id: f.id, name: f.display_name || f.name };
  } else if (repair.action === "clear") to = null;
  return {
    key,
    finding,
    action: repair.action,
    from: finding.target ? { id: finding.target.id, name: finding.target.name } : null,
    to,
    reports: await reportsUsing(key),
    note:
      repair.action === "remap" || repair.action === "apply_suggested"
        ? "Reports using this business name will read the new field from their next run; report specs don't change."
        : repair.action === "clear"
          ? "Reports using this business name will show it as unmapped until it's mapped again."
          : "Reports keep working; the business name shows a warning.",
  };
}

export async function applyAliasRepair(key: string, repair: AliasRepair, userId: string | null) {
  const preview = await previewAliasRepair(key, repair);
  const now = new Date().toISOString();
  const review = await catalogSchemaReady();
  const patch: Record<string, unknown> = { updated_by: userId, updated_at: now };
  if (repair.action === "remap" || repair.action === "apply_suggested") {
    patch.custom_field_id = preview.to!.id;
    patch.mapped_by = "admin";
    if (review) Object.assign(patch, { review_status: null, review_note: null });
  } else if (repair.action === "clear") {
    patch.custom_field_id = null;
    patch.mapped_by = "admin";
  } else if (review) {
    Object.assign(patch, {
      review_status: repair.action === "deprecate" ? "deprecated" : "verified",
      review_note: repair.note?.slice(0, 400) ?? null,
      reviewed_by: userId,
      reviewed_at: now,
    });
  } else {
    throw new ValidationError("Deprecating or verifying aliases needs migration 080.");
  }
  await agentDb().update("jt_semantic_fields", [eq("key", key)], patch);
  const { invalidateFieldCatalog } = await import("@/lib/reports/fields");
  invalidateFieldCatalog();
  return preview;
}
