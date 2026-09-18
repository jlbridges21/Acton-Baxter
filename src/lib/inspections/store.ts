/**
 * Site inspection template persistence — service-role writes; memory for tests/mock.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { DETACHED_ADU_SEED, DETACHED_ADU_TEMPLATE_NAME } from "./detached-adu-seed";
import type {
  InspectionSubQuestionType,
  InspectionTemplateDetail,
  InspectionTemplateItem,
  InspectionTemplateOption,
  InspectionTemplateSection,
  InspectionTemplateSubQuestion,
  InspectionTemplateSummary,
  SeedItemInput,
  SeedSubQuestionInput,
  SeedTemplateInput,
} from "./types";

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type SectionRow = {
  id: string;
  template_id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  template_id: string;
  section_id: string | null;
  title: string;
  guide_notes: string;
  allows_media: boolean;
  allows_notes: boolean;
  is_cover_photo_source: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type SubQuestionRow = {
  id: string;
  item_id: string;
  prompt: string;
  question_type: InspectionSubQuestionType;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type OptionRow = {
  id: string;
  sub_question_id: string;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type MemoryState = {
  templates: Map<string, TemplateRow>;
  sections: Map<string, SectionRow>;
  items: Map<string, ItemRow>;
  subQuestions: Map<string, SubQuestionRow>;
  options: Map<string, OptionRow>;
  seeded: boolean;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterInspectionTemplates?: MemoryState;
};

function emptyMemory(): MemoryState {
  return {
    templates: new Map(),
    sections: new Map(),
    items: new Map(),
    subQuestions: new Map(),
    options: new Map(),
    seeded: false,
  };
}

function getMemory(): MemoryState {
  if (!globalMemory.__baxterInspectionTemplates) {
    globalMemory.__baxterInspectionTemplates = emptyMemory();
  }
  return globalMemory.__baxterInspectionTemplates;
}

export function resetInspectionTemplateMemoryForTests() {
  globalMemory.__baxterInspectionTemplates = emptyMemory();
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  const message = (record.message ?? "").toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function reindexOrders<T extends { sort_order: number }>(
  rows: T[],
  orderedIds: string[],
  idOf: (row: T) => string,
): T[] {
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const next: T[] = [];
  orderedIds.forEach((id, index) => {
    const row = byId.get(id);
    if (!row) throw new ValidationError(`Unknown id in reorder: ${id}`);
    next.push({ ...row, sort_order: index });
  });
  return next;
}

function mapOption(row: OptionRow): InspectionTemplateOption {
  return {
    id: row.id,
    subQuestionId: row.sub_question_id,
    label: row.label,
    sortOrder: row.sort_order,
  };
}

function mapSubQuestion(row: SubQuestionRow, options: OptionRow[]): InspectionTemplateSubQuestion {
  return {
    id: row.id,
    itemId: row.item_id,
    prompt: row.prompt,
    questionType: row.question_type,
    sortOrder: row.sort_order,
    options: options
      .filter((o) => o.sub_question_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(mapOption),
  };
}

function mapItem(
  row: ItemRow,
  subQuestions: SubQuestionRow[],
  options: OptionRow[],
): InspectionTemplateItem {
  const itemSubs = subQuestions
    .filter((s) => s.item_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: row.id,
    templateId: row.template_id,
    sectionId: row.section_id,
    title: row.title,
    guideNotes: row.guide_notes,
    allowsMedia: row.allows_media,
    allowsNotes: row.allows_notes,
    isCoverPhotoSource: row.is_cover_photo_source,
    sortOrder: row.sort_order,
    subQuestions: itemSubs.map((s) => mapSubQuestion(s, options)),
  };
}

function buildDetail(
  template: TemplateRow,
  sections: SectionRow[],
  items: ItemRow[],
  subQuestions: SubQuestionRow[],
  options: OptionRow[],
): InspectionTemplateDetail {
  const standaloneItems = items
    .filter((i) => i.section_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => mapItem(i, subQuestions, options));

  const mappedSections = sections
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((section): InspectionTemplateSection => ({
      id: section.id,
      templateId: section.template_id,
      title: section.title,
      sortOrder: section.sort_order,
      items: items
        .filter((i) => i.section_id === section.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => mapItem(i, subQuestions, options)),
    }));

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    archivedAt: template.archived_at,
    createdBy: template.created_by,
    updatedBy: template.updated_by,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    sectionCount: mappedSections.length,
    itemCount: items.length,
    standaloneItems,
    sections: mappedSections,
  };
}

async function clearCoverPhotoFlag(templateId: string, exceptItemId?: string) {
  if (shouldUseMemory()) {
    const mem = getMemory();
    for (const [id, item] of mem.items) {
      if (
        item.template_id === templateId &&
        item.is_cover_photo_source &&
        item.id !== exceptItemId
      ) {
        mem.items.set(id, { ...item, is_cover_photo_source: false, updated_at: nowIso() });
      }
    }
    return;
  }
  const supabase = createServiceClient();
  let query = supabase
    .from("inspection_template_items")
    .update({ is_cover_photo_source: false })
    .eq("template_id", templateId)
    .eq("is_cover_photo_source", true);
  if (exceptItemId) query = query.neq("id", exceptItemId);
  const { error } = await query;
  if (error && !isMissingTable(error)) throw error;
}

async function templateIdForItem(itemId: string): Promise<string> {
  if (shouldUseMemory()) {
    const item = getMemory().items.get(itemId);
    if (!item) throw new NotFoundError("Item not found");
    return item.template_id;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inspection_template_items")
    .select("template_id")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Item not found");
  return data.template_id as string;
}

async function templateIdForSubQuestion(subQuestionId: string): Promise<{
  templateId: string;
  itemId: string;
}> {
  if (shouldUseMemory()) {
    const sq = getMemory().subQuestions.get(subQuestionId);
    if (!sq) throw new NotFoundError("Sub-question not found");
    const templateId = await templateIdForItem(sq.item_id);
    return { templateId, itemId: sq.item_id };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inspection_template_sub_questions")
    .select("item_id")
    .eq("id", subQuestionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Sub-question not found");
  const templateId = await templateIdForItem(data.item_id as string);
  return { templateId, itemId: data.item_id as string };
}

async function templateIdForOption(optionId: string): Promise<{
  templateId: string;
  subQuestionId: string;
}> {
  if (shouldUseMemory()) {
    const opt = getMemory().options.get(optionId);
    if (!opt) throw new NotFoundError("Option not found");
    const { templateId } = await templateIdForSubQuestion(opt.sub_question_id);
    return { templateId, subQuestionId: opt.sub_question_id };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inspection_template_sub_question_options")
    .select("sub_question_id")
    .eq("id", optionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Option not found");
  const { templateId } = await templateIdForSubQuestion(data.sub_question_id as string);
  return { templateId, subQuestionId: data.sub_question_id as string };
}

async function touchTemplate(templateId: string, updatedBy: string | null) {
  const updatedAt = nowIso();
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.templates.get(templateId);
    if (!row) throw new NotFoundError("Template not found");
    mem.templates.set(templateId, {
      ...row,
      updated_by: updatedBy,
      updated_at: updatedAt,
    });
    return;
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inspection_templates")
    .update({ updated_by: updatedBy })
    .eq("id", templateId);
  if (error) throw error;
}

async function insertSeedItem(
  templateId: string,
  sectionId: string | null,
  item: SeedItemInput,
  sortOrder: number,
  actorId: string | null,
) {
  const itemId = await createItemInternal({
    templateId,
    sectionId,
    title: item.title,
    guideNotes: item.guideNotes,
    isCoverPhotoSource: Boolean(item.isCoverPhotoSource),
    allowsMedia: true,
    allowsNotes: true,
    sortOrder,
    actorId,
  });
  for (const [sqIndex, sq] of (item.subQuestions ?? []).entries()) {
    await createSubQuestionInternal(itemId, sq, sqIndex, actorId);
  }
  return itemId;
}

async function createItemInternal(input: {
  templateId: string;
  sectionId: string | null;
  title: string;
  guideNotes: string;
  isCoverPhotoSource: boolean;
  allowsMedia: boolean;
  allowsNotes: boolean;
  sortOrder: number;
  actorId: string | null;
}): Promise<string> {
  if (input.isCoverPhotoSource) {
    await clearCoverPhotoFlag(input.templateId);
  }
  const id = randomUUID();
  const now = nowIso();
  const row: ItemRow = {
    id,
    template_id: input.templateId,
    section_id: input.sectionId,
    title: input.title.trim(),
    guide_notes: input.guideNotes,
    allows_media: input.allowsMedia,
    allows_notes: input.allowsNotes,
    is_cover_photo_source: input.isCoverPhotoSource,
    sort_order: input.sortOrder,
    created_at: now,
    updated_at: now,
  };
  if (shouldUseMemory()) {
    getMemory().items.set(id, row);
    return id;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("inspection_template_items").insert(row);
  if (error) throw error;
  return id;
}

async function createSubQuestionInternal(
  itemId: string,
  input: SeedSubQuestionInput,
  sortOrder: number,
  _actorId: string | null,
): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  const row: SubQuestionRow = {
    id,
    item_id: itemId,
    prompt: input.prompt.trim(),
    question_type: input.questionType,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  };
  if (shouldUseMemory()) {
    getMemory().subQuestions.set(id, row);
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("inspection_template_sub_questions").insert(row);
    if (error) throw error;
  }
  for (const [optIndex, opt] of (input.options ?? []).entries()) {
    await createOptionInternal(id, opt.label, optIndex);
  }
  return id;
}

async function createOptionInternal(
  subQuestionId: string,
  label: string,
  sortOrder: number,
): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  const row: OptionRow = {
    id,
    sub_question_id: subQuestionId,
    label: label.trim(),
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  };
  if (shouldUseMemory()) {
    getMemory().options.set(id, row);
    return id;
  }
  const supabase = createServiceClient();
  const { error } = await supabase.from("inspection_template_sub_question_options").insert(row);
  if (error) throw error;
  return id;
}

export async function createTemplateFromSeed(
  seed: SeedTemplateInput,
  actorId: string | null,
): Promise<InspectionTemplateDetail> {
  const id = randomUUID();
  const now = nowIso();
  const template: TemplateRow = {
    id,
    name: seed.name.trim(),
    description: seed.description?.trim() || null,
    archived_at: null,
    created_by: actorId,
    updated_by: actorId,
    created_at: now,
    updated_at: now,
  };

  if (shouldUseMemory()) {
    getMemory().templates.set(id, template);
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("inspection_templates").insert(template);
    if (error) throw error;
  }

  for (const [index, item] of (seed.standaloneItems ?? []).entries()) {
    await insertSeedItem(id, null, item, index, actorId);
  }

  for (const [sectionIndex, section] of seed.sections.entries()) {
    const sectionId = randomUUID();
    const sectionRow: SectionRow = {
      id: sectionId,
      template_id: id,
      title: section.title.trim(),
      sort_order: sectionIndex,
      created_at: now,
      updated_at: now,
    };
    if (shouldUseMemory()) {
      getMemory().sections.set(sectionId, sectionRow);
    } else {
      const supabase = createServiceClient();
      const { error } = await supabase.from("inspection_template_sections").insert(sectionRow);
      if (error) throw error;
    }
    for (const [itemIndex, item] of section.items.entries()) {
      await insertSeedItem(id, sectionId, item, itemIndex, actorId);
    }
  }

  return getTemplate(id);
}

export async function ensureDetachedAduTemplateSeeded(
  actorId: string | null = null,
): Promise<void> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    if (mem.seeded) return;
    const exists = Array.from(mem.templates.values()).some(
      (t) => t.name === DETACHED_ADU_TEMPLATE_NAME && !t.archived_at,
    );
    if (!exists) {
      await createTemplateFromSeed(DETACHED_ADU_SEED, actorId);
    }
    mem.seeded = true;
    return;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inspection_templates")
    .select("id")
    .eq("name", DETACHED_ADU_TEMPLATE_NAME)
    .is("archived_at", null)
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return;
    throw error;
  }
  if ((data ?? []).length > 0) return;
  await createTemplateFromSeed(DETACHED_ADU_SEED, actorId);
}

async function loadTemplateGraph(templateId: string): Promise<{
  template: TemplateRow;
  sections: SectionRow[];
  items: ItemRow[];
  subQuestions: SubQuestionRow[];
  options: OptionRow[];
}> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const template = mem.templates.get(templateId);
    if (!template) throw new NotFoundError("Template not found");
    const sections = Array.from(mem.sections.values()).filter((s) => s.template_id === templateId);
    const items = Array.from(mem.items.values()).filter((i) => i.template_id === templateId);
    const itemIds = new Set(items.map((i) => i.id));
    const subQuestions = Array.from(mem.subQuestions.values()).filter((s) =>
      itemIds.has(s.item_id),
    );
    const subIds = new Set(subQuestions.map((s) => s.id));
    const options = Array.from(mem.options.values()).filter((o) => subIds.has(o.sub_question_id));
    return { template, sections, items, subQuestions, options };
  }

  const supabase = createServiceClient();
  const { data: template, error: tErr } = await supabase
    .from("inspection_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!template) throw new NotFoundError("Template not found");

  const { data: sections, error: sErr } = await supabase
    .from("inspection_template_sections")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true });
  if (sErr) throw sErr;

  const { data: items, error: iErr } = await supabase
    .from("inspection_template_items")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true });
  if (iErr) throw iErr;

  const itemIds = (items ?? []).map((i) => i.id);
  let subQuestions: SubQuestionRow[] = [];
  let options: OptionRow[] = [];
  if (itemIds.length) {
    const { data: subs, error: qErr } = await supabase
      .from("inspection_template_sub_questions")
      .select("*")
      .in("item_id", itemIds)
      .order("sort_order", { ascending: true });
    if (qErr) throw qErr;
    subQuestions = (subs ?? []) as SubQuestionRow[];
    const subIds = subQuestions.map((s) => s.id);
    if (subIds.length) {
      const { data: opts, error: oErr } = await supabase
        .from("inspection_template_sub_question_options")
        .select("*")
        .in("sub_question_id", subIds)
        .order("sort_order", { ascending: true });
      if (oErr) throw oErr;
      options = (opts ?? []) as OptionRow[];
    }
  }

  return {
    template: template as TemplateRow,
    sections: (sections ?? []) as SectionRow[],
    items: (items ?? []) as ItemRow[],
    subQuestions,
    options,
  };
}

export async function listTemplates(options?: {
  includeArchived?: boolean;
}): Promise<InspectionTemplateSummary[]> {
  await ensureDetachedAduTemplateSeeded(null);

  if (shouldUseMemory()) {
    const mem = getMemory();
    const templates = Array.from(mem.templates.values()).filter(
      (t) => options?.includeArchived || !t.archived_at,
    );
    return templates
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const sections = Array.from(mem.sections.values()).filter((s) => s.template_id === t.id);
        const items = Array.from(mem.items.values()).filter((i) => i.template_id === t.id);
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          archivedAt: t.archived_at,
          createdBy: t.created_by,
          updatedBy: t.updated_by,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
          sectionCount: sections.length,
          itemCount: items.length,
        };
      });
  }

  const supabase = createServiceClient();
  let query = supabase.from("inspection_templates").select("*").order("name", { ascending: true });
  if (!options?.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  const templates = (data ?? []) as TemplateRow[];
  if (!templates.length) return [];

  const ids = templates.map((t) => t.id);
  const [{ data: sectionRows }, { data: itemRows }] = await Promise.all([
    supabase.from("inspection_template_sections").select("template_id").in("template_id", ids),
    supabase.from("inspection_template_items").select("template_id").in("template_id", ids),
  ]);
  const sectionCountById = new Map<string, number>();
  const itemCountById = new Map<string, number>();
  for (const row of sectionRows ?? []) {
    const id = row.template_id as string;
    sectionCountById.set(id, (sectionCountById.get(id) ?? 0) + 1);
  }
  for (const row of itemRows ?? []) {
    const id = row.template_id as string;
    itemCountById.set(id, (itemCountById.get(id) ?? 0) + 1);
  }

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    archivedAt: t.archived_at,
    createdBy: t.created_by,
    updatedBy: t.updated_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    sectionCount: sectionCountById.get(t.id) ?? 0,
    itemCount: itemCountById.get(t.id) ?? 0,
  }));
}

export async function getTemplate(id: string): Promise<InspectionTemplateDetail> {
  await ensureDetachedAduTemplateSeeded(null);
  const graph = await loadTemplateGraph(id);
  return buildDetail(
    graph.template,
    graph.sections,
    graph.items,
    graph.subQuestions,
    graph.options,
  );
}

export async function createEmptyTemplate(input: {
  name: string;
  description?: string | null;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  return createTemplateFromSeed(
    {
      name: input.name,
      description: input.description ?? null,
      standaloneItems: [],
      sections: [],
    },
    input.actorId,
  );
}

export async function updateTemplateMeta(input: {
  id: string;
  name?: string;
  description?: string | null;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const name = input.name?.trim();
  if (name !== undefined && !name) throw new ValidationError("Name is required");

  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.templates.get(input.id);
    if (!row) throw new NotFoundError("Template not found");
    mem.templates.set(input.id, {
      ...row,
      name: name ?? row.name,
      description:
        input.description === undefined ? row.description : input.description?.trim() || null,
      updated_by: input.actorId,
      updated_at: nowIso(),
    });
    return getTemplate(input.id);
  }

  const supabase = createServiceClient();
  const patch: Record<string, unknown> = { updated_by: input.actorId };
  if (name !== undefined) patch.name = name;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  const { error } = await supabase.from("inspection_templates").update(patch).eq("id", input.id);
  if (error) throw error;
  return getTemplate(input.id);
}

export async function archiveTemplate(
  id: string,
  actorId: string | null,
): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.templates.get(id);
    if (!row) throw new NotFoundError("Template not found");
    mem.templates.set(id, {
      ...row,
      archived_at: nowIso(),
      updated_by: actorId,
      updated_at: nowIso(),
    });
    return getTemplate(id);
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inspection_templates")
    .update({ archived_at: nowIso(), updated_by: actorId })
    .eq("id", id);
  if (error) throw error;
  return getTemplate(id);
}

export async function unarchiveTemplate(
  id: string,
  actorId: string | null,
): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.templates.get(id);
    if (!row) throw new NotFoundError("Template not found");
    mem.templates.set(id, {
      ...row,
      archived_at: null,
      updated_by: actorId,
      updated_at: nowIso(),
    });
    return getTemplate(id);
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inspection_templates")
    .update({ archived_at: null, updated_by: actorId })
    .eq("id", id);
  if (error) throw error;
  return getTemplate(id);
}

/**
 * Permanently delete an archived template and its structure.
 * Does not touch site_inspections — those keep their independent snapshot_json.
 */
export async function permanentlyDeleteTemplate(id: string): Promise<void> {
  const graph = await loadTemplateGraph(id);
  if (!graph.template.archived_at) {
    throw new ValidationError("Archive the template before permanently deleting it");
  }

  if (shouldUseMemory()) {
    const mem = getMemory();
    for (const [optId, opt] of [...mem.options.entries()]) {
      const sq = mem.subQuestions.get(opt.sub_question_id);
      if (sq) {
        const item = mem.items.get(sq.item_id);
        if (item?.template_id === id) mem.options.delete(optId);
      }
    }
    for (const [sqId, sq] of [...mem.subQuestions.entries()]) {
      const item = mem.items.get(sq.item_id);
      if (item?.template_id === id) mem.subQuestions.delete(sqId);
    }
    for (const [itemId, item] of [...mem.items.entries()]) {
      if (item.template_id === id) mem.items.delete(itemId);
    }
    for (const [sectionId, section] of [...mem.sections.entries()]) {
      if (section.template_id === id) mem.sections.delete(sectionId);
    }
    mem.templates.delete(id);
    return;
  }

  const supabase = createServiceClient();
  const itemIds = graph.items.map((i) => i.id);
  const sqIds = graph.subQuestions.map((s) => s.id);
  if (sqIds.length) {
    await supabase.from("inspection_template_options").delete().in("sub_question_id", sqIds);
    await supabase.from("inspection_template_sub_questions").delete().in("id", sqIds);
  }
  if (itemIds.length) {
    await supabase.from("inspection_template_items").delete().in("id", itemIds);
  }
  await supabase.from("inspection_template_sections").delete().eq("template_id", id);
  const { error } = await supabase.from("inspection_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateTemplate(
  id: string,
  actorId: string | null,
): Promise<InspectionTemplateDetail> {
  const source = await getTemplate(id);
  const seed: SeedTemplateInput = {
    name: `Copy of ${source.name}`,
    description: source.description,
    standaloneItems: source.standaloneItems.map((item) => ({
      title: item.title,
      guideNotes: item.guideNotes,
      isCoverPhotoSource: item.isCoverPhotoSource,
      subQuestions: item.subQuestions.map((sq) => ({
        prompt: sq.prompt,
        questionType: sq.questionType,
        options: sq.options.map((o) => ({ label: o.label })),
      })),
    })),
    sections: source.sections.map((section) => ({
      title: section.title,
      items: section.items.map((item) => ({
        title: item.title,
        guideNotes: item.guideNotes,
        isCoverPhotoSource: item.isCoverPhotoSource,
        subQuestions: item.subQuestions.map((sq) => ({
          prompt: sq.prompt,
          questionType: sq.questionType,
          options: sq.options.map((o) => ({ label: o.label })),
        })),
      })),
    })),
  };
  return createTemplateFromSeed(seed, actorId);
}

export async function addSection(input: {
  templateId: string;
  title: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const title = input.title.trim();
  if (!title) throw new ValidationError("Section title is required");
  const graph = await loadTemplateGraph(input.templateId);
  const sortOrder = graph.sections.length;
  const id = randomUUID();
  const now = nowIso();
  const row: SectionRow = {
    id,
    template_id: input.templateId,
    title,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  };
  if (shouldUseMemory()) {
    getMemory().sections.set(id, row);
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("inspection_template_sections").insert(row);
    if (error) throw error;
  }
  await touchTemplate(input.templateId, input.actorId);
  return getTemplate(input.templateId);
}

export async function updateSection(input: {
  sectionId: string;
  title: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const title = input.title.trim();
  if (!title) throw new ValidationError("Section title is required");
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.sections.get(input.sectionId);
    if (!row) throw new NotFoundError("Section not found");
    mem.sections.set(input.sectionId, { ...row, title, updated_at: nowIso() });
    await touchTemplate(row.template_id, input.actorId);
    return getTemplate(row.template_id);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inspection_template_sections")
    .update({ title })
    .eq("id", input.sectionId)
    .select("template_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("Section not found");
  await touchTemplate(data.template_id, input.actorId);
  return getTemplate(data.template_id);
}

export async function deleteSection(input: {
  sectionId: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.sections.get(input.sectionId);
    if (!row) throw new NotFoundError("Section not found");
    const templateId = row.template_id;
    for (const [itemId, item] of [...mem.items.entries()]) {
      if (item.section_id === input.sectionId) {
        for (const [sqId, sq] of [...mem.subQuestions.entries()]) {
          if (sq.item_id === itemId) {
            for (const [optId, opt] of [...mem.options.entries()]) {
              if (opt.sub_question_id === sqId) mem.options.delete(optId);
            }
            mem.subQuestions.delete(sqId);
          }
        }
        mem.items.delete(itemId);
      }
    }
    mem.sections.delete(input.sectionId);
    const remaining = Array.from(mem.sections.values())
      .filter((s) => s.template_id === templateId)
      .sort((a, b) => a.sort_order - b.sort_order);
    remaining.forEach((s, index) => {
      mem.sections.set(s.id, { ...s, sort_order: index });
    });
    await touchTemplate(templateId, input.actorId);
    return getTemplate(templateId);
  }
  const supabase = createServiceClient();
  const { data, error: fetchErr } = await supabase
    .from("inspection_template_sections")
    .select("template_id")
    .eq("id", input.sectionId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!data) throw new NotFoundError("Section not found");
  const { error } = await supabase
    .from("inspection_template_sections")
    .delete()
    .eq("id", input.sectionId);
  if (error) throw error;
  const { data: remaining } = await supabase
    .from("inspection_template_sections")
    .select("id")
    .eq("template_id", data.template_id)
    .order("sort_order", { ascending: true });
  for (const [index, section] of (remaining ?? []).entries()) {
    await supabase
      .from("inspection_template_sections")
      .update({ sort_order: index })
      .eq("id", section.id);
  }
  await touchTemplate(data.template_id, input.actorId);
  return getTemplate(data.template_id);
}

export async function reorderSections(input: {
  templateId: string;
  orderedIds: string[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const rows = Array.from(mem.sections.values()).filter(
      (s) => s.template_id === input.templateId,
    );
    const next = reindexOrders(rows, input.orderedIds, (r) => r.id);
    for (const row of next) mem.sections.set(row.id, { ...row, updated_at: nowIso() });
    await touchTemplate(input.templateId, input.actorId);
    return getTemplate(input.templateId);
  }
  const supabase = createServiceClient();
  for (const [index, id] of input.orderedIds.entries()) {
    const { error } = await supabase
      .from("inspection_template_sections")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("template_id", input.templateId);
    if (error) throw error;
  }
  await touchTemplate(input.templateId, input.actorId);
  return getTemplate(input.templateId);
}

export async function addItem(input: {
  templateId: string;
  sectionId: string | null;
  title: string;
  guideNotes?: string;
  isCoverPhotoSource?: boolean;
  allowsMedia?: boolean;
  allowsNotes?: boolean;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const title = input.title.trim();
  if (!title) throw new ValidationError("Item title is required");
  const graph = await loadTemplateGraph(input.templateId);
  const siblings = graph.items.filter((i) => i.section_id === input.sectionId);
  await createItemInternal({
    templateId: input.templateId,
    sectionId: input.sectionId,
    title,
    guideNotes: input.guideNotes ?? "",
    isCoverPhotoSource: Boolean(input.isCoverPhotoSource),
    allowsMedia: input.allowsMedia !== undefined ? input.allowsMedia : true,
    allowsNotes: input.allowsNotes !== undefined ? input.allowsNotes : true,
    sortOrder: siblings.length,
    actorId: input.actorId,
  });
  await touchTemplate(input.templateId, input.actorId);
  return getTemplate(input.templateId);
}

export async function updateItem(input: {
  itemId: string;
  title?: string;
  guideNotes?: string;
  isCoverPhotoSource?: boolean;
  allowsMedia?: boolean;
  allowsNotes?: boolean;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.items.get(input.itemId);
    if (!row) throw new NotFoundError("Item not found");
    if (input.isCoverPhotoSource) await clearCoverPhotoFlag(row.template_id, row.id);
    const title = input.title !== undefined ? input.title.trim() : row.title;
    if (!title) throw new ValidationError("Item title is required");
    mem.items.set(input.itemId, {
      ...row,
      title,
      guide_notes: input.guideNotes !== undefined ? input.guideNotes : row.guide_notes,
      allows_media: input.allowsMedia !== undefined ? input.allowsMedia : row.allows_media,
      allows_notes: input.allowsNotes !== undefined ? input.allowsNotes : row.allows_notes,
      is_cover_photo_source:
        input.isCoverPhotoSource !== undefined
          ? input.isCoverPhotoSource
          : row.is_cover_photo_source,
      updated_at: nowIso(),
    });
    await touchTemplate(row.template_id, input.actorId);
    return getTemplate(row.template_id);
  }
  const supabase = createServiceClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("inspection_template_items")
    .select("*")
    .eq("id", input.itemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new NotFoundError("Item not found");
  if (input.isCoverPhotoSource) await clearCoverPhotoFlag(existing.template_id, existing.id);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ValidationError("Item title is required");
    patch.title = title;
  }
  if (input.guideNotes !== undefined) patch.guide_notes = input.guideNotes;
  if (input.allowsMedia !== undefined) patch.allows_media = input.allowsMedia;
  if (input.allowsNotes !== undefined) patch.allows_notes = input.allowsNotes;
  if (input.isCoverPhotoSource !== undefined)
    patch.is_cover_photo_source = input.isCoverPhotoSource;
  const { error } = await supabase
    .from("inspection_template_items")
    .update(patch)
    .eq("id", input.itemId);
  if (error) throw error;
  await touchTemplate(existing.template_id, input.actorId);
  return getTemplate(existing.template_id);
}

export async function deleteItem(input: {
  itemId: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.items.get(input.itemId);
    if (!row) throw new NotFoundError("Item not found");
    const templateId = row.template_id;
    const sectionId = row.section_id;
    for (const [sqId, sq] of [...mem.subQuestions.entries()]) {
      if (sq.item_id === input.itemId) {
        for (const [optId, opt] of [...mem.options.entries()]) {
          if (opt.sub_question_id === sqId) mem.options.delete(optId);
        }
        mem.subQuestions.delete(sqId);
      }
    }
    mem.items.delete(input.itemId);
    const remaining = Array.from(mem.items.values())
      .filter((i) => i.template_id === templateId && i.section_id === sectionId)
      .sort((a, b) => a.sort_order - b.sort_order);
    remaining.forEach((i, index) => {
      mem.items.set(i.id, { ...i, sort_order: index });
    });
    await touchTemplate(templateId, input.actorId);
    return getTemplate(templateId);
  }
  const supabase = createServiceClient();
  const { data, error: fetchErr } = await supabase
    .from("inspection_template_items")
    .select("template_id, section_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!data) throw new NotFoundError("Item not found");
  const { error } = await supabase
    .from("inspection_template_items")
    .delete()
    .eq("id", input.itemId);
  if (error) throw error;
  let remQuery = supabase
    .from("inspection_template_items")
    .select("id")
    .eq("template_id", data.template_id)
    .order("sort_order", { ascending: true });
  remQuery =
    data.section_id === null
      ? remQuery.is("section_id", null)
      : remQuery.eq("section_id", data.section_id);
  const { data: remaining } = await remQuery;
  for (const [index, item] of (remaining ?? []).entries()) {
    await supabase
      .from("inspection_template_items")
      .update({ sort_order: index })
      .eq("id", item.id);
  }
  await touchTemplate(data.template_id, input.actorId);
  return getTemplate(data.template_id);
}

export async function reorderItems(input: {
  templateId: string;
  sectionId: string | null;
  orderedIds: string[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const rows = Array.from(mem.items.values()).filter(
      (i) => i.template_id === input.templateId && i.section_id === input.sectionId,
    );
    const next = reindexOrders(rows, input.orderedIds, (r) => r.id);
    for (const row of next) mem.items.set(row.id, { ...row, updated_at: nowIso() });
    await touchTemplate(input.templateId, input.actorId);
    return getTemplate(input.templateId);
  }
  const supabase = createServiceClient();
  for (const [index, id] of input.orderedIds.entries()) {
    const { error } = await supabase
      .from("inspection_template_items")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("template_id", input.templateId);
    if (error) throw error;
  }
  await touchTemplate(input.templateId, input.actorId);
  return getTemplate(input.templateId);
}

/**
 * Move an item into another section (or standalone) and set the target order.
 * Reindexes the source list after removal.
 */
export async function moveItem(input: {
  itemId: string;
  targetSectionId: string | null;
  orderedIds: string[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (!input.orderedIds.includes(input.itemId)) {
    throw new ValidationError("orderedIds must include the moved item");
  }

  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.items.get(input.itemId);
    if (!row) throw new NotFoundError("Item not found");
    const templateId = row.template_id;
    const sourceSectionId = row.section_id;

    mem.items.set(input.itemId, {
      ...row,
      section_id: input.targetSectionId,
      updated_at: nowIso(),
    });

    if (sourceSectionId !== input.targetSectionId) {
      const remaining = Array.from(mem.items.values())
        .filter(
          (i) =>
            i.template_id === templateId &&
            i.section_id === sourceSectionId &&
            i.id !== input.itemId,
        )
        .sort((a, b) => a.sort_order - b.sort_order);
      remaining.forEach((i, index) => {
        mem.items.set(i.id, { ...i, sort_order: index, updated_at: nowIso() });
      });
    }

    for (const [index, id] of input.orderedIds.entries()) {
      const current = mem.items.get(id);
      if (!current || current.template_id !== templateId) {
        throw new ValidationError(`Unknown id in reorder: ${id}`);
      }
      mem.items.set(id, {
        ...current,
        section_id: input.targetSectionId,
        sort_order: index,
        updated_at: nowIso(),
      });
    }

    await touchTemplate(templateId, input.actorId);
    return getTemplate(templateId);
  }

  const supabase = createServiceClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("inspection_template_items")
    .select("*")
    .eq("id", input.itemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new NotFoundError("Item not found");
  const templateId = existing.template_id as string;
  const sourceSectionId = existing.section_id as string | null;

  const { error: moveErr } = await supabase
    .from("inspection_template_items")
    .update({ section_id: input.targetSectionId })
    .eq("id", input.itemId);
  if (moveErr) throw moveErr;

  if (sourceSectionId !== input.targetSectionId) {
    let remQuery = supabase
      .from("inspection_template_items")
      .select("id")
      .eq("template_id", templateId)
      .neq("id", input.itemId)
      .order("sort_order", { ascending: true });
    remQuery =
      sourceSectionId === null
        ? remQuery.is("section_id", null)
        : remQuery.eq("section_id", sourceSectionId);
    const { data: remaining } = await remQuery;
    for (const [index, row] of (remaining ?? []).entries()) {
      await supabase
        .from("inspection_template_items")
        .update({ sort_order: index })
        .eq("id", row.id);
    }
  }

  for (const [index, id] of input.orderedIds.entries()) {
    const { error } = await supabase
      .from("inspection_template_items")
      .update({ section_id: input.targetSectionId, sort_order: index })
      .eq("id", id)
      .eq("template_id", templateId);
    if (error) throw error;
  }

  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function addSubQuestion(input: {
  itemId: string;
  prompt: string;
  questionType: InspectionSubQuestionType;
  options?: { label: string }[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new ValidationError("Prompt is required");
  let templateId: string;
  if (shouldUseMemory()) {
    const item = getMemory().items.get(input.itemId);
    if (!item) throw new NotFoundError("Item not found");
    templateId = item.template_id;
    const count = Array.from(getMemory().subQuestions.values()).filter(
      (s) => s.item_id === input.itemId,
    ).length;
    await createSubQuestionInternal(
      input.itemId,
      {
        prompt,
        questionType: input.questionType,
        options: input.options,
      },
      count,
      input.actorId,
    );
  } else {
    const supabase = createServiceClient();
    const { data: item, error } = await supabase
      .from("inspection_template_items")
      .select("template_id")
      .eq("id", input.itemId)
      .maybeSingle();
    if (error) throw error;
    if (!item) throw new NotFoundError("Item not found");
    templateId = item.template_id;
    const { count } = await supabase
      .from("inspection_template_sub_questions")
      .select("id", { count: "exact", head: true })
      .eq("item_id", input.itemId);
    await createSubQuestionInternal(
      input.itemId,
      {
        prompt,
        questionType: input.questionType,
        options: input.options,
      },
      count ?? 0,
      input.actorId,
    );
  }
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function updateSubQuestion(input: {
  subQuestionId: string;
  prompt?: string;
  questionType?: InspectionSubQuestionType;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.subQuestions.get(input.subQuestionId);
    if (!row) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(row.item_id);
    if (!item) throw new NotFoundError("Item not found");
    const prompt = input.prompt !== undefined ? input.prompt.trim() : row.prompt;
    if (!prompt) throw new ValidationError("Prompt is required");
    mem.subQuestions.set(input.subQuestionId, {
      ...row,
      prompt,
      question_type: input.questionType ?? row.question_type,
      updated_at: nowIso(),
    });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId } = await templateIdForSubQuestion(input.subQuestionId);
  const patch: Record<string, unknown> = {};
  if (input.prompt !== undefined) {
    const prompt = input.prompt.trim();
    if (!prompt) throw new ValidationError("Prompt is required");
    patch.prompt = prompt;
  }
  if (input.questionType !== undefined) patch.question_type = input.questionType;
  const { error } = await supabase
    .from("inspection_template_sub_questions")
    .update(patch)
    .eq("id", input.subQuestionId);
  if (error) throw error;
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function deleteSubQuestion(input: {
  subQuestionId: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.subQuestions.get(input.subQuestionId);
    if (!row) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(row.item_id);
    if (!item) throw new NotFoundError("Item not found");
    for (const [optId, opt] of [...mem.options.entries()]) {
      if (opt.sub_question_id === input.subQuestionId) mem.options.delete(optId);
    }
    mem.subQuestions.delete(input.subQuestionId);
    const remaining = Array.from(mem.subQuestions.values())
      .filter((s) => s.item_id === row.item_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    remaining.forEach((s, index) => {
      mem.subQuestions.set(s.id, { ...s, sort_order: index });
    });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId, itemId } = await templateIdForSubQuestion(input.subQuestionId);
  const { error } = await supabase
    .from("inspection_template_sub_questions")
    .delete()
    .eq("id", input.subQuestionId);
  if (error) throw error;
  const { data: remaining } = await supabase
    .from("inspection_template_sub_questions")
    .select("id")
    .eq("item_id", itemId)
    .order("sort_order", { ascending: true });
  for (const [index, sq] of (remaining ?? []).entries()) {
    await supabase
      .from("inspection_template_sub_questions")
      .update({ sort_order: index })
      .eq("id", sq.id);
  }
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function reorderSubQuestions(input: {
  itemId: string;
  orderedIds: string[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const item = mem.items.get(input.itemId);
    if (!item) throw new NotFoundError("Item not found");
    const rows = Array.from(mem.subQuestions.values()).filter((s) => s.item_id === input.itemId);
    const next = reindexOrders(rows, input.orderedIds, (r) => r.id);
    for (const row of next) mem.subQuestions.set(row.id, { ...row, updated_at: nowIso() });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { data: item, error: fetchErr } = await supabase
    .from("inspection_template_items")
    .select("template_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!item) throw new NotFoundError("Item not found");
  for (const [index, id] of input.orderedIds.entries()) {
    const { error } = await supabase
      .from("inspection_template_sub_questions")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("item_id", input.itemId);
    if (error) throw error;
  }
  await touchTemplate(item.template_id, input.actorId);
  return getTemplate(item.template_id);
}

export async function addOption(input: {
  subQuestionId: string;
  label: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Option label is required");
  if (shouldUseMemory()) {
    const mem = getMemory();
    const sq = mem.subQuestions.get(input.subQuestionId);
    if (!sq) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(sq.item_id);
    if (!item) throw new NotFoundError("Item not found");
    const count = Array.from(mem.options.values()).filter(
      (o) => o.sub_question_id === input.subQuestionId,
    ).length;
    await createOptionInternal(input.subQuestionId, label, count);
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId } = await templateIdForSubQuestion(input.subQuestionId);
  const { count } = await supabase
    .from("inspection_template_sub_question_options")
    .select("id", { count: "exact", head: true })
    .eq("sub_question_id", input.subQuestionId);
  await createOptionInternal(input.subQuestionId, label, count ?? 0);
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function updateOption(input: {
  optionId: string;
  label: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Option label is required");
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.options.get(input.optionId);
    if (!row) throw new NotFoundError("Option not found");
    const sq = mem.subQuestions.get(row.sub_question_id);
    if (!sq) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(sq.item_id);
    if (!item) throw new NotFoundError("Item not found");
    mem.options.set(input.optionId, { ...row, label, updated_at: nowIso() });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId } = await templateIdForOption(input.optionId);
  const { error } = await supabase
    .from("inspection_template_sub_question_options")
    .update({ label })
    .eq("id", input.optionId);
  if (error) throw error;
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function deleteOption(input: {
  optionId: string;
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.options.get(input.optionId);
    if (!row) throw new NotFoundError("Option not found");
    const sq = mem.subQuestions.get(row.sub_question_id);
    if (!sq) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(sq.item_id);
    if (!item) throw new NotFoundError("Item not found");
    mem.options.delete(input.optionId);
    const remaining = Array.from(mem.options.values())
      .filter((o) => o.sub_question_id === row.sub_question_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    remaining.forEach((o, index) => {
      mem.options.set(o.id, { ...o, sort_order: index });
    });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId, subQuestionId } = await templateIdForOption(input.optionId);
  const { error } = await supabase
    .from("inspection_template_sub_question_options")
    .delete()
    .eq("id", input.optionId);
  if (error) throw error;
  const { data: remaining } = await supabase
    .from("inspection_template_sub_question_options")
    .select("id")
    .eq("sub_question_id", subQuestionId)
    .order("sort_order", { ascending: true });
  for (const [index, opt] of (remaining ?? []).entries()) {
    await supabase
      .from("inspection_template_sub_question_options")
      .update({ sort_order: index })
      .eq("id", opt.id);
  }
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}

export async function reorderOptions(input: {
  subQuestionId: string;
  orderedIds: string[];
  actorId: string | null;
}): Promise<InspectionTemplateDetail> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const sq = mem.subQuestions.get(input.subQuestionId);
    if (!sq) throw new NotFoundError("Sub-question not found");
    const item = mem.items.get(sq.item_id);
    if (!item) throw new NotFoundError("Item not found");
    const rows = Array.from(mem.options.values()).filter(
      (o) => o.sub_question_id === input.subQuestionId,
    );
    const next = reindexOrders(rows, input.orderedIds, (r) => r.id);
    for (const row of next) mem.options.set(row.id, { ...row, updated_at: nowIso() });
    await touchTemplate(item.template_id, input.actorId);
    return getTemplate(item.template_id);
  }
  const supabase = createServiceClient();
  const { templateId } = await templateIdForSubQuestion(input.subQuestionId);
  for (const [index, id] of input.orderedIds.entries()) {
    const { error } = await supabase
      .from("inspection_template_sub_question_options")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("sub_question_id", input.subQuestionId);
    if (error) throw error;
  }
  await touchTemplate(templateId, input.actorId);
  return getTemplate(templateId);
}
