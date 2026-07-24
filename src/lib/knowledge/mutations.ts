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

export async function adminDeleteKnowledgeEntry(role: string, id: string) {
  assertCanManageKnowledge(role);
  return deleteKnowledgeEntry(id);
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
