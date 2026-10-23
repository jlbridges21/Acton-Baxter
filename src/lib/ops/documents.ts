/**
 * Sam Operations documents: private storage (bucket `ops-documents`), always associated with a
 * legal entity and an employee or contract. Uploading a new version keeps the old one
 * (supersedes_id) — nothing is overwritten. Access is checked per viewer: HR administrators and
 * leadership see all; employees see only their own documents.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/agents/audit";
import { agentDb, eq, usesAgentMemoryStore } from "@/lib/agents/store";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import type { OpsAccess } from "./org";

export const OPS_BUCKET = "ops-documents";

const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", magic: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: (b) => b.subarray(0, 4).toString("hex") === "504b0304",
  },
  png: { mime: "image/png", magic: (b) => b.subarray(0, 4).toString("hex") === "89504e47" },
  jpg: { mime: "image/jpeg", magic: (b) => b.subarray(0, 3).toString("hex") === "ffd8ff" },
  jpeg: { mime: "image/jpeg", magic: (b) => b.subarray(0, 3).toString("hex") === "ffd8ff" },
  txt: { mime: "text/plain", magic: (b) => !b.subarray(0, 4096).includes(0) },
};
const MAX_BYTES = 25 * 1024 * 1024;

export type OpsDocumentRow = {
  id: string;
  entity_id: string | null;
  person_id: string | null;
  contract_id: string | null;
  instance_id: string | null;
  step_id: string | null;
  category: string;
  title: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string | null;
  signed: boolean;
  status: "received" | "verified" | "rejected" | "filed" | "archived";
  version: number;
  supersedes_id: string | null;
  drive_file_id: string | null;
  extracted_text: string | null;
  restricted: boolean;
  retention_until: string | null;
  uploaded_by: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

const memoryFiles = new Map<string, Buffer>();

export function validateOpsFile(filename: string, buf: Buffer) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename)?.[1] ?? "").toLowerCase();
  const t = TYPES[ext];
  if (!t)
    throw new ValidationError(
      `".${ext || "?"}" files aren't accepted. Use PDF, DOCX, PNG, JPG, or TXT.`,
    );
  if (buf.byteLength === 0) throw new ValidationError("The file is empty.");
  if (buf.byteLength > MAX_BYTES) throw new ValidationError("Files must be 25 MB or smaller.");
  if (!t.magic(buf)) throw new ValidationError(`The file doesn't look like a real .${ext} file.`);
  return { ext, mime: t.mime };
}

export async function personForProfile(profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const [row] = await agentDb().select<{ id: string }>("ops_people", {
    filters: [eq("profile_id", profileId)],
    limit: 1,
  });
  return row?.id ?? null;
}

/** Throws unless the viewer may see this document. */
export async function assertCanSeeDocument(doc: OpsDocumentRow, access: OpsAccess) {
  if (access.canViewAll) return;
  const own = await personForProfile(access.userId);
  if (!own || doc.person_id !== own) throw new NotFoundError("Document not found.");
}

export async function uploadOpsDocument(input: {
  filename: string;
  buffer: Buffer;
  category: string;
  title?: string;
  entityId: string | null;
  personId?: string | null;
  contractId?: string | null;
  instanceId?: string | null;
  stepId?: string | null;
  signed?: boolean;
  access: OpsAccess;
  actorLabel: string;
}): Promise<OpsDocumentRow> {
  const own = await personForProfile(input.access.userId);
  // Employees may upload only their own documents (e.g. onboarding paperwork).
  if (!input.access.canConfigure && (!input.personId || input.personId !== own))
    throw new AuthorizationError("You can only upload your own documents.");
  if (!input.personId && !input.contractId && !input.access.canConfigure)
    throw new ValidationError("Choose the employee or contract this document belongs to.");
  const { ext, mime } = validateOpsFile(input.filename, input.buffer);
  const category = input.category.trim().slice(0, 80);
  if (!category) throw new ValidationError("Choose a document category.");
  const prior = input.personId
    ? (
        await agentDb().select<OpsDocumentRow>("ops_documents", {
          filters: [eq("person_id", input.personId), eq("category", category)],
          order: { col: "version", ascending: false },
          limit: 1,
        })
      )[0]
    : null;
  const path = `${input.entityId ?? "unassigned"}/${randomUUID()}.${ext}`;
  if (usesAgentMemoryStore()) memoryFiles.set(path, input.buffer);
  else {
    const { error } = await createServiceClient()
      .storage.from(OPS_BUCKET)
      .upload(path, input.buffer, { contentType: mime, upsert: false });
    if (error) throw new Error(`Couldn't store the file: ${error.message}`);
  }
  let extracted: string | null = null;
  if (ext === "pdf" || ext === "docx" || ext === "txt") {
    try {
      const { parseKnowledgeUpload } = await import("@/lib/knowledge-import/parser");
      extracted = (
        await parseKnowledgeUpload({
          filename: input.filename,
          buffer: input.buffer,
          mimeType: mime,
        })
      ).content.slice(0, 200_000);
    } catch {
      extracted = null;
    }
  }
  const [row] = await agentDb().insert<OpsDocumentRow>("ops_documents", {
    entity_id: input.entityId,
    person_id: input.personId ?? null,
    contract_id: input.contractId ?? null,
    instance_id: input.instanceId ?? null,
    step_id: input.stepId ?? null,
    category,
    title: (input.title ?? input.filename).slice(0, 200),
    filename: input.filename.replace(/[^\w .()-]/g, "_").slice(0, 160),
    mime_type: mime,
    size_bytes: input.buffer.byteLength,
    storage_path: path,
    signed: Boolean(input.signed),
    status: "received",
    version: (prior?.version ?? 0) + 1,
    supersedes_id: prior?.id ?? null,
    drive_file_id: null,
    extracted_text: extracted,
    restricted: true,
    retention_until: null,
    uploaded_by: input.access.userId,
    verified_by: null,
  });
  await recordAudit({
    actor: { userId: input.access.userId, label: input.actorLabel },
    action: "ops.document_uploaded",
    targetType: "ops_document",
    targetId: row!.id,
    summary: `Uploaded a ${category} document (v${row!.version}).`,
    details: {
      personId: input.personId ?? null,
      contractId: input.contractId ?? null,
      entityId: input.entityId,
    },
  });
  return row!;
}

export async function getOpsDocument(id: string): Promise<OpsDocumentRow> {
  const [row] = await agentDb().select<OpsDocumentRow>("ops_documents", {
    filters: [eq("id", id)],
  });
  if (!row) throw new NotFoundError("Document not found.");
  return row;
}

export async function readOpsDocumentBytes(doc: OpsDocumentRow): Promise<Buffer> {
  if (!doc.storage_path) throw new NotFoundError("The file is no longer stored.");
  if (usesAgentMemoryStore()) {
    const b = memoryFiles.get(doc.storage_path);
    if (!b) throw new NotFoundError("The file is no longer stored.");
    return b;
  }
  const { data, error } = await createServiceClient()
    .storage.from(OPS_BUCKET)
    .download(doc.storage_path);
  if (error || !data) throw new NotFoundError("The file is no longer stored.");
  return Buffer.from(await data.arrayBuffer());
}

export async function listOpsDocuments(
  filter: { personId?: string; contractId?: string; instanceId?: string },
  access: OpsAccess,
): Promise<OpsDocumentRow[]> {
  const filters = [];
  if (filter.personId) filters.push(eq("person_id", filter.personId));
  if (filter.contractId) filters.push(eq("contract_id", filter.contractId));
  if (filter.instanceId) filters.push(eq("instance_id", filter.instanceId));
  if (!access.canViewAll) {
    const own = await personForProfile(access.userId);
    if (!own) return [];
    filters.push(eq("person_id", own));
  }
  return agentDb().select<OpsDocumentRow>("ops_documents", {
    filters,
    order: { col: "created_at", ascending: false },
    limit: 500,
  });
}

export async function setDocumentStatus(
  id: string,
  status: OpsDocumentRow["status"],
  access: OpsAccess,
  actorLabel: string,
  patch: Partial<OpsDocumentRow> = {},
) {
  if (!access.canConfigure)
    throw new AuthorizationError("Only HR administrators and leadership can verify documents.");
  const [row] = await agentDb().update<OpsDocumentRow>("ops_documents", [eq("id", id)], {
    status,
    ...(status === "verified" ? { verified_by: access.userId } : {}),
    ...patch,
  });
  await recordAudit({
    actor: { userId: access.userId, label: actorLabel },
    action: `ops.document_${status}`,
    targetType: "ops_document",
    targetId: id,
    summary: `Document marked ${status}.`,
  });
  return row!;
}
