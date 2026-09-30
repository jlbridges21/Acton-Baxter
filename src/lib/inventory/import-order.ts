import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getBaxterVisionProvider } from "@/lib/baxter-ai/vision";
import { getEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { enqueueJob, getJobById, patchJobMetadata } from "@/lib/jobs/queue";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  arithmeticMismatch,
  buildComOrderSchema,
  extractBuildComOrderFromLayout,
  shouldQueueVisionImport,
  textLayerIsUsable,
  type ParsedBuildComOrder,
  type ParsedOrderLine,
  type PdfPageLayout,
} from "./build-com-parse";
import { createInventoryItem, listInventoryVocab } from "./store";
import type { InventoryItem } from "./types";
import { readBuildComPdfLayout } from "./pdf-layout";
import type {
  CommitImportLine,
  ImportDraft,
  ImportDraftLine,
  ImportDuplicate,
} from "./import-types";
import {
  readInventoryFile,
  sha256Hex,
  signInventoryFile,
  sourcePdfPath,
  storeOrderPdf,
  storeProductPhoto,
} from "./order-files";

export type { CommitImportLine, ImportDraft, ImportDraftLine, ImportDuplicate };

type StoredOrder = {
  id: string;
  vendor: string | null;
  orderNumber: string | null;
  sha256: string | null;
  storagePath: string | null;
  jobId: string | null;
  customProjectLabel: string | null;
  deletedAt: string | null;
};

const globalOrders = globalThis as typeof globalThis & { __baxterInventoryOrders?: StoredOrder[] };

function orders(): StoredOrder[] {
  if (!globalOrders.__baxterInventoryOrders) globalOrders.__baxterInventoryOrders = [];
  return globalOrders.__baxterInventoryOrders;
}

export function resetInventoryOrdersForTests() {
  globalOrders.__baxterInventoryOrders = [];
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

const VISION_PROMPT = `Extract a build.com order from this page image. Return JSON only:
{"orderNumber": string|null, "lines": [{"itemName": string, "sku": string, "description": string|null, "quantity": integer|null, "unitCostCents": integer|null, "lineTotalCents": integer|null}]}
Rules: integer cents, never floats. Copy digits exactly. SKU is the Model number. description is Color/Finish. quantity × unitCostCents must equal lineTotalCents when both are printed — if they disagree, still return both printed numbers and do not invent a match. Do not include subtotal, tax, or shipping as line items.`;

const VISION_CORRECTION = `Your previous JSON failed schema validation. Return corrected JSON only. Do not invent values.
Issues:
`;

function toDraftLine(
  line: ParsedOrderLine,
  photoStoragePath: string | null,
  photoUrl: string | null,
): ImportDraftLine {
  return {
    itemName: line.itemName,
    sku: line.sku,
    description: line.description,
    quantity: line.quantity,
    unitCostCents: line.unitCostCents,
    lineTotalCents: line.lineTotalCents,
    productUrl: line.productUrl,
    photoStoragePath,
    photoUrl,
    source: line.source,
    flags: line.flags,
    pageNumber: line.pageNumber,
  };
}

async function persistPhotos(sha256: string, lines: ParsedOrderLine[]): Promise<ImportDraftLine[]> {
  const drafts: ImportDraftLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    let photoStoragePath: string | null = null;
    let photoUrl: string | null = null;
    if (line.photoPng && line.photoPng.length > 32) {
      try {
        photoStoragePath = await storeProductPhoto({ sha256, index, png: line.photoPng });
        photoUrl = await signInventoryFile(photoStoragePath);
      } catch {
        photoStoragePath = null;
        photoUrl = null;
      }
    }
    drafts.push(toDraftLine(line, photoStoragePath, photoUrl));
  }
  return drafts;
}

export async function findInventoryOrderDuplicate(input: {
  sha256: string;
  orderNumber: string | null;
}): Promise<ImportDuplicate | null> {
  if (shouldUseMemory()) {
    const hit = orders().find(
      (order) =>
        !order.deletedAt &&
        (order.sha256 === input.sha256 ||
          (input.orderNumber != null && order.orderNumber === input.orderNumber)),
    );
    if (!hit) return null;
    return {
      orderId: hit.id,
      orderNumber: hit.orderNumber,
      match: hit.sha256 === input.sha256 ? "file" : "order_number",
    };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inventory_orders")
    .select("id, order_number, source_pdf_sha256")
    .is("deleted_at", null)
    .or(
      [
        `source_pdf_sha256.eq.${input.sha256}`,
        input.orderNumber ? `order_number.eq.${input.orderNumber}` : null,
      ]
        .filter(Boolean)
        .join(","),
    );
  if (error) throw error;
  const row = (data ?? [])[0] as
    { id: string; order_number: string | null; source_pdf_sha256: string | null } | undefined;
  if (!row) return null;
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    match: row.source_pdf_sha256 === input.sha256 ? "file" : "order_number",
  };
}

async function draftFromParsed(
  sha256: string,
  storagePath: string,
  parsed: ParsedBuildComOrder,
): Promise<ImportDraft> {
  const lines = await persistPhotos(sha256, parsed.lines);
  const duplicate = await findInventoryOrderDuplicate({ sha256, orderNumber: parsed.orderNumber });
  return {
    sha256,
    storagePath,
    orderNumber: parsed.orderNumber,
    vendor: parsed.vendor,
    source: parsed.source,
    correctionAttempted: parsed.correctionAttempted,
    textUsable: parsed.textUsable,
    lines,
    duplicate,
  };
}

async function visionOrderFromPages(pages: PdfPageLayout[]): Promise<ParsedBuildComOrder> {
  const provider = getBaxterVisionProvider();
  const collected: ParsedOrderLine[] = [];
  let orderNumber: string | null = null;
  let correctionAttempted = false;
  for (const page of pages) {
    const image = page.images[0]?.png;
    if (!image) continue;
    const first = await provider.analyzeImageJson({
      mimeType: "image/png",
      base64Data: image.toString("base64"),
      filename: `order-page-${page.pageNumber}.png`,
      prompt: VISION_PROMPT,
    });
    let raw = parseVisionJson(first.content);
    let parsed = visionPageSchema.safeParse(raw);
    if (!parsed.success) {
      correctionAttempted = true;
      const correction = await provider.analyzeImageJson({
        mimeType: "image/png",
        base64Data: image.toString("base64"),
        filename: `order-page-${page.pageNumber}.png`,
        prompt: `${VISION_CORRECTION}${parsed.error.issues.map((issue) => issue.message).join("\n")}\n\n${first.content.slice(0, 8000)}`,
      });
      raw = parseVisionJson(correction.content);
      parsed = visionPageSchema.safeParse(raw);
      if (!parsed.success) continue;
    }
    if (!orderNumber && parsed.data.orderNumber) orderNumber = parsed.data.orderNumber;
    for (const line of parsed.data.lines) {
      const draft = {
        itemName: line.itemName,
        sku: line.sku,
        description: line.description ?? null,
        quantity: line.quantity,
        unitCostCents: line.unitCostCents,
        lineTotalCents: line.lineTotalCents,
        productUrl: null,
        photoPng: null,
        source: "vision" as const,
        pageNumber: page.pageNumber,
      };
      const flags = ["vision"];
      if (!draft.sku) flags.push("missing_sku");
      if (draft.quantity == null) flags.push("missing_quantity");
      if (arithmeticMismatch(draft)) flags.push("arithmetic_mismatch");
      collected.push({ ...draft, flags });
    }
  }
  const order = {
    orderNumber,
    vendor: "build.com" as const,
    lines: collected,
    source: "vision" as const,
    correctionAttempted,
    textUsable: false,
    subtotalCents: null,
  };
  buildComOrderSchema.parse({
    ...order,
    lines: order.lines.map(({ photoPng: _png, ...line }) => line),
  });
  return order;
}

const visionPageSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40).nullable().optional(),
  lines: z.array(
    z.object({
      itemName: z.string().trim().min(1),
      sku: z.string().trim().default(""),
      description: z.string().trim().nullable().optional(),
      quantity: z.number().int().positive().nullable(),
      unitCostCents: z.number().int().nonnegative().nullable(),
      lineTotalCents: z.number().int().nonnegative().nullable(),
    }),
  ),
});

function parseVisionJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    throw new ValidationError("Vision fallback did not return JSON");
  }
}

export async function parseBuildComPdf(
  buffer: Buffer,
): Promise<
  { status: "ready"; draft: ImportDraft } | { status: "pending"; jobId: string; sha256: string }
> {
  if (buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new ValidationError("Upload a build.com order PDF");
  }
  const pages = await readBuildComPdfLayout(buffer);
  const stored = await storeOrderPdf(buffer);
  if (!textLayerIsUsable(pages)) {
    if (shouldQueueVisionImport(pages.length)) {
      const job = await enqueueJob({
        jobType: "inventory_order_import",
        metadata: { storagePath: stored.storagePath, sha256: stored.sha256 },
      });
      return { status: "pending", jobId: job.id, sha256: stored.sha256 };
    }
    const parsed = await visionOrderFromPages(pages);
    return {
      status: "ready",
      draft: await draftFromParsed(stored.sha256, stored.storagePath, parsed),
    };
  }
  const parsed = extractBuildComOrderFromLayout(pages);
  if (!parsed.lines.length) {
    throw new ValidationError("No line items were found in this build.com order PDF");
  }
  return {
    status: "ready",
    draft: await draftFromParsed(stored.sha256, stored.storagePath, parsed),
  };
}

export async function runInventoryOrderImportJob(job: {
  id: string;
  metadata: Record<string, unknown>;
}) {
  const storagePath = typeof job.metadata.storagePath === "string" ? job.metadata.storagePath : "";
  const file = await readInventoryFile(storagePath);
  if (!file) throw new ValidationError("Order PDF for this import is missing");
  const pages = await readBuildComPdfLayout(file.bytes);
  const parsed = textLayerIsUsable(pages)
    ? extractBuildComOrderFromLayout(pages)
    : await visionOrderFromPages(pages);
  const sha256 =
    typeof job.metadata.sha256 === "string" ? job.metadata.sha256 : sha256Hex(file.bytes);
  const draft = await draftFromParsed(sha256, storagePath, parsed);
  await patchJobMetadata(job.id, { draft });
}

export async function readInventoryImportJob(
  jobId: string,
): Promise<
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "ready"; draft: ImportDraft }
> {
  const job = await getJobById(jobId);
  if (!job || job.jobType !== "inventory_order_import")
    throw new NotFoundError("Import job not found");
  if (job.status === "failed")
    return { status: "failed", message: job.lastError ?? "Import failed" };
  const draft = job.metadata.draft;
  if (job.status === "complete" && draft && typeof draft === "object") {
    return { status: "ready", draft: draft as ImportDraft };
  }
  return { status: "pending" };
}

export async function commitInventoryImport(input: {
  sha256: string;
  vendor: string;
  orderNumber: string | null;
  jobId: string | null;
  customProjectLabel: string | null;
  lines: CommitImportLine[];
  allowDuplicate: boolean;
  actorId: string;
}): Promise<{ orderId: string; itemCount: number; items: InventoryItem[] }> {
  if (!input.lines.length) throw new ValidationError("Add at least one line before importing");
  const duplicate = await findInventoryOrderDuplicate({
    sha256: input.sha256,
    orderNumber: input.orderNumber,
  });
  if (duplicate && !input.allowDuplicate) {
    throw new ValidationError(
      `This order is already imported${duplicate.orderNumber ? ` (${duplicate.orderNumber})` : ""}. Cancel, or import it again on purpose.`,
    );
  }
  const storagePath = sourcePdfPath(input.sha256);
  const file = await readInventoryFile(storagePath);
  if (!file) throw new ValidationError("The source PDF is no longer available. Upload it again.");
  for (const line of input.lines) {
    if (!line.itemName.trim()) throw new ValidationError("Item name is required");
    if (!line.sku.trim()) throw new ValidationError("SKU is required");
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError("Quantity must be at least 1");
    }
    if (!Number.isInteger(line.unitCostCents) || line.unitCostCents < 0) {
      throw new ValidationError("Unit cost cannot be negative");
    }
    if (line.photoStoragePath && !line.photoStoragePath.startsWith(`photos/${input.sha256}/`)) {
      throw new ValidationError("Photo path does not belong to this PDF");
    }
  }

  const orderId = randomUUID();
  const vendor = input.vendor.trim() || "build.com";
  if (shouldUseMemory()) {
    orders().push({
      id: orderId,
      vendor,
      orderNumber: input.orderNumber,
      sha256: input.sha256,
      storagePath,
      jobId: input.jobId,
      customProjectLabel: input.customProjectLabel,
      deletedAt: null,
    });
  } else {
    const supabase = createServiceClient();
    const { error } = await supabase.from("inventory_orders").insert({
      id: orderId,
      vendor,
      order_number: input.orderNumber,
      job_id: input.jobId,
      custom_project_label: input.customProjectLabel,
      source_pdf_path: storagePath,
      source_pdf_sha256: input.sha256,
      imported_at: new Date().toISOString(),
      created_by: input.actorId,
      updated_by: input.actorId,
    });
    if (error) throw error;
  }

  const statuses = await listInventoryVocab("status");
  const defaultStatus = statuses.find((status) => status.isDefault) ?? statuses[0];
  const items: InventoryItem[] = [];
  for (const line of input.lines) {
    items.push(
      await createInventoryItem({
        itemName: line.itemName,
        sku: line.sku,
        quantity: line.quantity,
        unitCostCents: line.unitCostCents,
        description: line.description ?? null,
        productUrl: line.productUrl ?? null,
        photoStoragePath: line.photoStoragePath ?? null,
        orderId,
        orderNumber: input.orderNumber,
        vendor,
        jobId: input.jobId,
        customProjectLabel: input.customProjectLabel,
        statusId: defaultStatus?.id,
        actorId: input.actorId,
      }),
    );
  }
  return { orderId, itemCount: items.length, items };
}

export async function readInventoryOrderPdf(
  orderId: string,
): Promise<{ bytes: Buffer; filename: string } | null> {
  if (shouldUseMemory()) {
    const order = orders().find((row) => row.id === orderId && !row.deletedAt);
    if (!order?.storagePath) return null;
    const file = await readInventoryFile(order.storagePath);
    if (!file) return null;
    return { bytes: file.bytes, filename: `order-${order.orderNumber ?? orderId}.pdf` };
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("inventory_orders")
    .select("order_number, source_pdf_path")
    .eq("id", orderId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const path = (data?.source_pdf_path as string | null) ?? null;
  if (!path) return null;
  const file = await readInventoryFile(path);
  if (!file) return null;
  const number = (data?.order_number as string | null) ?? orderId;
  return { bytes: file.bytes, filename: `order-${number}.pdf` };
}
