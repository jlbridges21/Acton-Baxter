import { z } from "zod";
import {
  KNOWLEDGE_SOURCE_STATUSES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_VISIBILITIES,
} from "./types";

export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export const knowledgeVisibilitySchema = z.enum(KNOWLEDGE_VISIBILITIES);
export const knowledgeSourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPES);
export const knowledgeSourceStatusSchema = z.enum(KNOWLEDGE_SOURCE_STATUSES);

export function normalizeTags(input: string[] | string | undefined | null): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const tag = value.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

const optionalTrimmedString = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.string().trim().max(2000).optional(),
);

const optionalCategory = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.string().trim().max(120).optional(),
);

const optionalSourceName = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.string().trim().max(200).optional(),
);

const optionalSourceUrl = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.string().trim().max(2000).optional(),
);

const optionalChangeNote = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.string().trim().max(1000).optional(),
);

const knowledgeDocKindSchema = z.enum([
  "building_code",
  "ordinance",
  "design_guideline",
  "other_code",
]);

const optionalJurisdictionKey = z.preprocess(
  (value) => (value == null || value === "" ? null : value),
  z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/, "Invalid jurisdiction_key")
    .nullable()
    .optional(),
);

export const knowledgeEntryWriteSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  content: z.string().trim().min(1, "Content is required").max(100_000),
  summary: optionalTrimmedString.nullable().optional(),
  category: optionalCategory.nullable().optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  source_name: optionalSourceName.nullable().optional(),
  source_type: knowledgeSourceTypeSchema.optional().default("manual"),
  source_url: optionalSourceUrl.nullable().optional(),
  visibility: knowledgeVisibilitySchema.optional().default("internal"),
  status: knowledgeStatusSchema.optional(),
  change_note: optionalChangeNote.nullable().optional(),
  jurisdiction_key: optionalJurisdictionKey,
  doc_kind: knowledgeDocKindSchema.nullable().optional(),
});

export const knowledgeSourceWriteSchema = z.object({
  name: z.string().trim().min(2).max(200),
  source_type: knowledgeSourceTypeSchema,
  description: z.string().trim().max(2000).optional().nullable(),
  status: knowledgeSourceStatusSchema.default("manual"),
  external_identifier: z.string().trim().max(300).optional().nullable(),
});

export const knowledgeListQuerySchema = z.object({
  q: z.string().optional(),
  status: knowledgeStatusSchema.or(z.literal("all")).optional(),
  category: z.string().optional(),
  source_type: knowledgeSourceTypeSchema.or(z.literal("all")).optional(),
  tag: z.string().optional(),
  sort: z.enum(["updated", "created", "title", "category"]).optional(),
});

export type KnowledgeEntryWriteInput = z.infer<typeof knowledgeEntryWriteSchema>;
/** Pre-parse / caller-facing shape (defaults not yet applied). */
export type KnowledgeEntryWritePayload = z.input<typeof knowledgeEntryWriteSchema>;
export type KnowledgeSourceWriteInput = z.infer<typeof knowledgeSourceWriteSchema>;
