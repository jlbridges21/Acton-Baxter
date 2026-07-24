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

export const knowledgeEntryWriteSchema = z.object({
  title: z.string().trim().min(3).max(300),
  content: z.string().trim().min(10).max(100_000),
  summary: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().min(2).max(120),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  source_name: z.string().trim().max(200).optional().nullable(),
  source_type: knowledgeSourceTypeSchema.default("manual"),
  source_url: z.string().trim().max(2000).optional().nullable(),
  visibility: knowledgeVisibilitySchema.default("internal"),
  status: knowledgeStatusSchema.optional(),
  change_note: z.string().trim().max(1000).optional().nullable(),
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
export type KnowledgeSourceWriteInput = z.infer<typeof knowledgeSourceWriteSchema>;
