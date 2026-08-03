import "server-only";

import { assertCanManageKnowledge } from "./permissions";
import {
  createKnowledgeEntry,
  createKnowledgeSource,
  deleteKnowledgeEntry,
  deleteKnowledgeSource,
  setKnowledgeEntryStatus,
  updateKnowledgeEntry,
  updateKnowledgeSource,
} from "./store";
import type { KnowledgeEntryWriteInput, KnowledgeSourceWriteInput } from "./schemas";
import type { KnowledgeStatus } from "./types";

export async function adminCreateKnowledgeEntry(
  role: string,
  userId: string,
  input: KnowledgeEntryWriteInput,
) {
  assertCanManageKnowledge(role);
  return createKnowledgeEntry(input, userId);
}

export async function adminUpdateKnowledgeEntry(
  role: string,
  userId: string,
  id: string,
  input: KnowledgeEntryWriteInput,
) {
  assertCanManageKnowledge(role);
  return updateKnowledgeEntry(id, input, userId);
}

export async function adminSetKnowledgeStatus(
  role: string,
  userId: string,
  id: string,
  status: KnowledgeStatus,
) {
  assertCanManageKnowledge(role);
  return setKnowledgeEntryStatus(id, status, userId);
}

export async function adminDeleteKnowledgeEntry(role: string, id: string, userId?: string) {
  assertCanManageKnowledge(role);
  return deleteKnowledgeEntry(id, { userId });
}

export async function adminCreateKnowledgeSource(
  role: string,
  userId: string,
  input: KnowledgeSourceWriteInput,
) {
  assertCanManageKnowledge(role);
  return createKnowledgeSource(input, userId);
}

export async function adminUpdateKnowledgeSource(
  role: string,
  id: string,
  input: KnowledgeSourceWriteInput,
) {
  assertCanManageKnowledge(role);
  return updateKnowledgeSource(id, input);
}

export async function adminDeleteKnowledgeSource(role: string, id: string) {
  assertCanManageKnowledge(role);
  return deleteKnowledgeSource(id);
}

/**
 * Non-admin knowledge create: status is always forced to draft server-side,
 * regardless of any status in the submitted payload. Visibility is forced to internal.
 */
export async function userCreateKnowledgeDraft(
  userId: string,
  input: {
    title: string;
    content: string;
    summary?: string | null;
    category?: string | null;
    tags?: string[] | string;
    source_name?: string | null;
    source_type?: KnowledgeEntryWriteInput["source_type"];
    source_url?: string | null;
    /** Ignored — always forced to internal. */
    visibility?: KnowledgeEntryWriteInput["visibility"];
    /** Ignored — always forced to draft. */
    status?: KnowledgeEntryWriteInput["status"];
    change_note?: string | null;
  },
) {
  return createKnowledgeEntry(
    {
      title: input.title,
      content: input.content,
      summary: input.summary ?? null,
      category: input.category ?? undefined,
      tags: input.tags,
      source_name: input.source_name ?? null,
      source_type: input.source_type ?? "manual",
      source_url: input.source_url ?? null,
      change_note: input.change_note ?? null,
      status: "draft",
      visibility: "internal",
    } satisfies KnowledgeEntryWriteInput,
    userId,
  );
}
