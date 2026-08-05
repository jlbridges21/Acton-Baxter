import { z } from "zod";
import { isValidJurisdictionRuleKey } from "./rule-keys";
import { KNOWLEDGE_DOC_KINDS } from "./types";
import { isSupportedJurisdictionKey } from "./keys";

export const knowledgeDocKindSchema = z.enum(KNOWLEDGE_DOC_KINDS);

const optionalNullableString = z.preprocess(
  (value) => (value == null || value === "" ? null : value),
  z.string().trim().max(200).nullable(),
);

export const quantityValueSchema = z.object({
  kind: z.literal("quantity"),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(32),
});

export const structuredValueSchema = z.object({
  kind: z.literal("structured"),
  fields: z.record(z.string(), z.unknown()),
});

export const jurisdictionRuleValueSchema = z.union([quantityValueSchema, structuredValueSchema]);

export const jurisdictionRuleWriteSchema = z.object({
  jurisdiction_key: z
    .string()
    .trim()
    .refine(isSupportedJurisdictionKey, "Unsupported jurisdiction_key"),
  rule_key: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine(isValidJurisdictionRuleKey, "rule_key must be snake_case (a-z, 0-9, _)"),
  zone_key: optionalNullableString,
  value_json: jurisdictionRuleValueSchema,
  source_citation: z
    .string()
    .trim()
    .min(1, "Source citation is required")
    .max(500, "Source citation is too long"),
  source_knowledge_entry_id: z.string().uuid().nullable().optional(),
  notes: optionalNullableString,
});

export const jurisdictionRuleUpdateSchema = jurisdictionRuleWriteSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No fields to update")
  .superRefine((value, ctx) => {
    if (value.source_citation !== undefined && !value.source_citation?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source citation is required",
        path: ["source_citation"],
      });
    }
  });

export const associateKnowledgeEntrySchema = z.object({
  knowledge_entry_id: z.string().uuid(),
  jurisdiction_key: z
    .string()
    .trim()
    .nullable()
    .refine(
      (value) => value == null || isSupportedJurisdictionKey(value),
      "Unsupported jurisdiction_key",
    ),
  doc_kind: knowledgeDocKindSchema.nullable(),
});

export type JurisdictionRuleWriteParsed = z.infer<typeof jurisdictionRuleWriteSchema>;
export type JurisdictionRuleUpdateParsed = z.infer<typeof jurisdictionRuleUpdateSchema>;
