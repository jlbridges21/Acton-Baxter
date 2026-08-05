import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { previewKnowledgeUpload, importKnowledgeUpload } from "@/lib/knowledge-import/import";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_FILES = 10;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const form = await request.formData();
    const action = String(form.get("action") ?? "preview");
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      throw new KnowledgeError("Choose at least one file to upload.", "VALIDATION_ERROR", {
        statusCode: 400,
      });
    }
    if (files.length > MAX_FILES) {
      throw new KnowledgeError(
        `You can upload at most ${MAX_FILES} files at once.`,
        KNOWLEDGE_ERROR_CODES.UPLOAD_TOO_LARGE,
        { statusCode: 413 },
      );
    }

    if (action === "preview") {
      const previews = [];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const preview = await previewKnowledgeUpload({
          filename: file.name,
          buffer,
          mimeType: file.type || null,
        });
        previews.push({
          ...preview,
          // Do not echo full content for huge files in list responses — keep bounded for UI.
          previewText: preview.content.slice(0, 2500),
          truncatedPreview: preview.content.length > 2500,
          content: undefined,
        });
      }
      return jsonOk({ previews });
    }

    if (action === "import") {
      const formString = z.preprocess(
        (value) => (value == null || value === "" ? undefined : String(value)),
        z.string().optional(),
      );
      const parsed = z
        .object({
          status: z.preprocess(
            (value) => (value == null || value === "" ? "draft" : String(value)),
            z.enum(["draft", "approved"]),
          ),
          category: formString,
          tags: formString,
          titles: formString,
          allowEmpty: formString,
          allowDuplicate: formString,
          jurisdiction_key: formString,
          doc_kind: z.preprocess(
            (value) => (value == null || value === "" ? undefined : String(value)),
            z.enum(["building_code", "ordinance", "design_guideline", "other_code"]).optional(),
          ),
        })
        .parse({
          status: form.get("status"),
          category: form.get("category"),
          tags: form.get("tags"),
          titles: form.get("titles"),
          allowEmpty: form.get("allowEmpty"),
          allowDuplicate: form.get("allowDuplicate"),
          jurisdiction_key: form.get("jurisdiction_key"),
          doc_kind: form.get("doc_kind"),
        });

      const titles = parsed.titles ? (JSON.parse(parsed.titles) as Record<string, string>) : {};
      const tags = parsed.tags
        ? parsed.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : ["uploaded"];

      const results = [];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const imported = await importKnowledgeUpload({
          filename: file.name,
          buffer,
          mimeType: file.type || null,
          userId: user.id,
          title: titles[file.name] ?? null,
          status: parsed.status,
          category: parsed.category ?? "General",
          tags,
          jurisdiction_key: parsed.jurisdiction_key ?? null,
          doc_kind: parsed.doc_kind ?? null,
          allowEmpty: parsed.allowEmpty === "true",
          allowDuplicate: parsed.allowDuplicate === "true",
        });
        results.push({
          filename: file.name,
          entryId: imported.entryId,
          uploadId: imported.uploadId,
          warnings: imported.warnings,
        });
      }
      return jsonOk({ results }, { status: 201 });
    }

    throw new KnowledgeError("Unknown upload action.", "VALIDATION_ERROR", { statusCode: 400 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/knowledge/upload");
  }
}
