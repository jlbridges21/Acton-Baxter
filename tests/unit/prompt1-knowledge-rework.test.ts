import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { knowledgeEntryWriteSchema } from "@/lib/knowledge/schemas";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  resetKnowledgeMemoryForTests,
  setKnowledgeEntryStatus,
} from "@/lib/knowledge/store";
import { KnowledgeError, KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { parseMarkdown, parsePlainText } from "@/lib/knowledge-import/text";
import { parseCsv } from "@/lib/knowledge-import/csv";
import { parseXlsx } from "@/lib/knowledge-import/xlsx";
import { parseKnowledgeUpload } from "@/lib/knowledge-import/parser";
import { importKnowledgeUpload, previewKnowledgeUpload } from "@/lib/knowledge-import/import";
import { resetKnowledgeUploadsMemoryForTests } from "@/lib/knowledge-import/storage";
import { getNavContext } from "@/lib/baxter/tools";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.APP_BASE_URL = "https://example.com";
  process.env.ENABLE_MOCK_RESEARCH = "true";
  resetEnvCacheForTests();
  resetKnowledgeMemoryForTests();
  resetKnowledgeUploadsMemoryForTests();
});

describe("simplified knowledge entry schema", () => {
  it("requires only title and content", () => {
    const parsed = knowledgeEntryWriteSchema.parse({
      title: "How Acton ADU Builds ADUs",
      content: "A short test procedure.",
    });
    expect(parsed.source_type).toBe("manual");
    expect(parsed.visibility).toBe("internal");
    expect(parsed.category == null || parsed.category === undefined).toBe(true);
  });

  it("rejects empty title or content", () => {
    expect(() =>
      knowledgeEntryWriteSchema.parse({ title: "   ", content: "Valid content here" }),
    ).toThrow();
    expect(() =>
      knowledgeEntryWriteSchema.parse({ title: "Valid title", content: "  " }),
    ).toThrow();
  });

  it("creates draft and approved entries with defaults", async () => {
    const draft = await createKnowledgeEntry(
      {
        title: "Draft entry",
        content: "Draft body content",
        source_type: "manual",
        visibility: "internal",
        status: "draft",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    expect(draft.status).toBe("draft");
    expect(draft.category).toBe("General");
    expect(draft.source_name).toBe("Manual entry");

    const approved = await createKnowledgeEntry(
      {
        title: "Approved entry",
        content: "Approved body content",
        source_type: "manual",
        visibility: "internal",
        status: "approved",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBeTruthy();
  });
});

describe("knowledge delete safety", () => {
  it("deletes unused manual entries", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Disposable",
        content: "Temporary content",
        source_type: "manual",
        visibility: "internal",
        status: "draft",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    const result = await deleteKnowledgeEntry(entry.id);
    expect(result).toEqual({ deleted: true });
  });

  it("removes Google-managed entries from Baxter instead of blocking", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Google doc",
        content: "Synced content",
        source_type: "Google Drive",
        visibility: "internal",
        status: "approved",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    const result = await deleteKnowledgeEntry(entry.id, {
      userId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result).toMatchObject({ removedFromBaxter: true });
    if ("entry" in result) {
      expect(result.entry.status).toBe("archived");
    }
  });

  it("returns not found for missing ids", async () => {
    await expect(
      deleteKnowledgeEntry("00000000-0000-4000-8000-000000000099"),
    ).rejects.toBeInstanceOf(KnowledgeError);
  });

  it("archives instead path remains available via status", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Archive me",
        content: "Temporary content",
        source_type: "manual",
        visibility: "internal",
        status: "approved",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    const archived = await setKnowledgeEntryStatus(
      entry.id,
      "archived",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(archived.status).toBe("archived");
  });
});

describe("document parsing", () => {
  it("parses markdown and plain text", () => {
    const md = parseMarkdown("guide.md", "# Hello\n\n- one\n- two");
    expect(md.title).toBe("guide");
    expect(md.content).toContain("# Hello");
    expect(md.extractionStatus).toBe("success");

    const txt = parsePlainText("notes.txt", "Plain notes");
    expect(txt.extension).toBe("txt");
    expect(txt.content).toContain("Plain notes");
  });

  it("parses csv with headers and rows", () => {
    const parsed = parseCsv("pipeline.csv", "Deal,Stage\nAlpha,Open\nBeta,Won\n");
    expect(parsed.content).toContain("Headers: Deal | Stage");
    expect(parsed.content).toContain("Row 1:");
    expect(parsed.extractionStatus).toBe("success");
  });

  it("parses xlsx sheet names and headers", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Deal", "Stage"],
      ["Alpha", "Open"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Pipeline");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    const parsed = parseXlsx("sales.xlsx", buffer);
    expect(parsed.content).toContain("## Sheet: Pipeline");
    expect(parsed.content).toContain("Headers: Deal | Stage");
  });

  it("rejects unsupported types and oversized files", async () => {
    await expect(
      parseKnowledgeUpload({ filename: "clip.mp4", buffer: Buffer.from("x") }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.UPLOAD_UNSUPPORTED });

    process.env.KNOWLEDGE_UPLOAD_MAX_MB = "0.00001"; // ~10 bytes
    try {
      await expect(
        parseKnowledgeUpload({
          filename: "big.txt",
          buffer: Buffer.from("x".repeat(200)),
        }),
      ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.UPLOAD_TOO_LARGE });
    } finally {
      delete process.env.KNOWLEDGE_UPLOAD_MAX_MB;
    }
  });
});

describe("upload import + duplicates", () => {
  it("imports markdown as uploaded_document and detects duplicates", async () => {
    const buffer = Buffer.from("# Procedure\n\nDo the thing.");
    const preview = await previewKnowledgeUpload({
      filename: "procedure.md",
      buffer,
    });
    expect(preview.duplicateEntryId).toBeNull();

    const imported = await importKnowledgeUpload({
      filename: "procedure.md",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "approved",
    });
    expect(imported.entryId).toBeTruthy();

    await expect(
      importKnowledgeUpload({
        filename: "procedure.md",
        buffer,
        userId: "00000000-0000-4000-8000-000000000001",
        status: "draft",
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.UPLOAD_DUPLICATE });
  });
});

describe("knowledge navigation contexts", () => {
  it("treats knowledge and google connector routes as knowledge nav", () => {
    expect(getNavContext("/admin/knowledge")).toBe("knowledge");
    expect(getNavContext("/admin/knowledge/upload")).toBe("knowledge");
    expect(getNavContext("/admin/connectors/google")).toBe("knowledge");
    expect(getNavContext("/admin/slack")).toBe("platform-admin");
  });
});
