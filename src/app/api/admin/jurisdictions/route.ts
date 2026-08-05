import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { listKnowledgeEntries } from "@/lib/knowledge/store";
import { adminSetKnowledgeEntryJurisdiction } from "@/lib/knowledge/mutations";
import {
  SUPPORTED_JURISDICTIONS,
  JURISDICTION_RULE_KEY_CATALOG,
  associateKnowledgeEntrySchema,
  createJurisdictionRule,
  deleteJurisdictionRule,
  jurisdictionRuleUpdateSchema,
  jurisdictionRuleWriteSchema,
  listCodeDocumentsForJurisdiction,
  listJurisdictionRules,
  updateJurisdictionRule,
} from "@/lib/jurisdictions";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const jurisdictionKey = url.searchParams.get("jurisdictionKey") ?? undefined;

    const [rules, unassignedEntries] = await Promise.all([
      listJurisdictionRules(jurisdictionKey ? { jurisdictionKey } : undefined),
      listKnowledgeEntries({ status: "all", sort: "title" }),
    ]);

    const documentsByJurisdiction: Record<
      string,
      Awaited<ReturnType<typeof listCodeDocumentsForJurisdiction>>
    > = {};
    for (const jurisdiction of SUPPORTED_JURISDICTIONS) {
      documentsByJurisdiction[jurisdiction.key] = await listCodeDocumentsForJurisdiction(
        jurisdiction.key,
      );
    }

    return jsonOk({
      jurisdictions: SUPPORTED_JURISDICTIONS,
      ruleKeyCatalog: JURISDICTION_RULE_KEY_CATALOG,
      rules,
      documentsByJurisdiction,
      associableEntries: unassignedEntries
        .filter((entry) => entry.status !== "archived")
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status,
          jurisdiction_key: entry.jurisdiction_key,
          doc_kind: entry.doc_kind,
          source_name: entry.source_name,
          source_url: entry.source_url,
          updated_at: entry.updated_at,
        })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/jurisdictions");
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_rule"),
    rule: jurisdictionRuleWriteSchema,
  }),
  z.object({
    action: z.literal("update_rule"),
    id: z.string().uuid(),
    rule: jurisdictionRuleUpdateSchema,
  }),
  z.object({
    action: z.literal("delete_rule"),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("associate_entry"),
    association: associateKnowledgeEntrySchema,
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid request");
    }

    if (parsed.data.action === "create_rule") {
      const rule = await createJurisdictionRule(parsed.data.rule, user.id);
      return jsonOk({ rule }, { status: 201 });
    }

    if (parsed.data.action === "update_rule") {
      const rule = await updateJurisdictionRule(parsed.data.id, parsed.data.rule, user.id);
      return jsonOk({ rule });
    }

    if (parsed.data.action === "delete_rule") {
      await deleteJurisdictionRule(parsed.data.id);
      return jsonOk({ deleted: true });
    }

    const entry = await adminSetKnowledgeEntryJurisdiction(
      user.profile.role,
      user.id,
      parsed.data.association.knowledge_entry_id,
      {
        jurisdiction_key: parsed.data.association.jurisdiction_key,
        doc_kind: parsed.data.association.doc_kind,
      },
    );
    return jsonOk({ entry });
  } catch (error) {
    return jsonError(error, "POST /api/admin/jurisdictions");
  }
}
