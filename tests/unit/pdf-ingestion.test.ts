import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  extractPdfText,
  isPdfSignature,
  normalizePdfText,
  parsePdf,
  splitPdfTextIntoPages,
} from "@/lib/knowledge-import/pdf";
import { parseKnowledgeUpload } from "@/lib/knowledge-import/parser";
import { importKnowledgeUpload, previewKnowledgeUpload } from "@/lib/knowledge-import/import";
import { resetKnowledgeUploadsMemoryForTests } from "@/lib/knowledge-import/storage";
import { resetKnowledgeMemoryForTests, getKnowledgeEntry } from "@/lib/knowledge/store";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/errors";
import { scoreKnowledgeMatch } from "@/lib/knowledge/retrieval";
import {
  fixtureCorruptPdf,
  fixtureEmptyPdf,
  fixtureImageOnlyPdf,
  fixtureMultiPageTextPdf,
  fixtureNotPdf,
  fixturePasswordProtectedPdf,
  fixtureTextPdf,
} from "../fixtures/pdf-fixtures";

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

describe("PDF extraction — server / Node (no DOMMatrix dependency)", () => {
  it("extracts text without requiring a pre-existing DOMMatrix global", async () => {
    const had = "DOMMatrix" in globalThis;
    const previous = (globalThis as { DOMMatrix?: unknown }).DOMMatrix;
    delete (globalThis as { DOMMatrix?: unknown }).DOMMatrix;

    try {
      expect(typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix).toBe("undefined");
      const result = await extractPdfText(fixtureTextPdf("Hello Baxter"));
      expect(result.success).toBe(true);
      expect(result.errorCode).toBeNull();
      expect(result.extractionMethod).toBe("pdf_text");
      expect(result.text).toContain("Hello Baxter");
      expect(result.userMessage).toBeNull();
      // Must not surface browser/runtime internals.
      expect(JSON.stringify(result)).not.toMatch(/DOMMatrix/i);
    } finally {
      if (had) (globalThis as { DOMMatrix?: unknown }).DOMMatrix = previous;
    }
  });

  it("extracts multi-page content and page metadata", async () => {
    const result = await extractPdfText(fixtureMultiPageTextPdf());
    expect(result.success).toBe(true);
    expect(result.pageCount).toBeGreaterThanOrEqual(2);
    expect(result.text).toContain("ALPHA");
    expect(result.text).toContain("BRAVO");
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.pages.some((p) => p.text.includes("ALPHA"))).toBe(true);
    expect(result.pages.some((p) => p.text.includes("BRAVO"))).toBe(true);
  });

  it("differentiates image-only / no-text from parser failure", async () => {
    const noText = await extractPdfText(fixtureImageOnlyPdf());
    expect(noText.success).toBe(true);
    expect(noText.errorCode).toBe("PDF_NO_TEXT");
    expect(noText.extractionMethod).toBe("none");
    expect(noText.userMessage).toMatch(/scanned|image-only/i);

    const parsed = await parsePdf("scan.pdf", fixtureImageOnlyPdf());
    expect(parsed.extractionStatus).toBe("empty");
    expect(parsed.metadata.errorCode).toBe("PDF_NO_TEXT");
    expect(parsed.warnings.join(" ")).not.toMatch(/DOMMatrix/i);
  });

  it("returns PDF_INVALID for corrupt and non-PDF bytes", async () => {
    const corrupt = await extractPdfText(fixtureCorruptPdf());
    expect(corrupt.success).toBe(false);
    expect(["PDF_INVALID", "PDF_PARSE_FAILED"]).toContain(corrupt.errorCode);
    expect(corrupt.userMessage).toBeTruthy();
    expect(corrupt.userMessage).not.toMatch(/DOMMatrix|at Object|node_modules/i);

    const empty = await extractPdfText(fixtureEmptyPdf());
    expect(empty.errorCode).toBe("PDF_INVALID");

    expect(isPdfSignature(fixtureNotPdf())).toBe(false);
    const notPdf = await extractPdfText(fixtureNotPdf());
    expect(notPdf.errorCode).toBe("PDF_INVALID");
  });

  it("detects password-protected PDFs", async () => {
    const result = await extractPdfText(fixturePasswordProtectedPdf());
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PDF_PASSWORD_PROTECTED");
    expect(result.userMessage).toMatch(/password protected/i);
  });

  it("normalizes whitespace without rewriting content", () => {
    expect(normalizePdfText("A\u0000\n\n\nB\t\tC")).toBe("A\n\nB C");
    expect(splitPdfTextIntoPages("PageA\fPageB", 2)).toEqual([
      { pageNumber: 1, text: "PageA" },
      { pageNumber: 2, text: "PageB" },
    ]);
  });
});

describe("PDF upload → Knowledge ingestion", () => {
  it("ingests a normal text PDF into Knowledge without DOMMatrix errors", async () => {
    const buffer = fixtureTextPdf("UNIQUE_PDF_TOKEN_ZETA_991");
    const preview = await previewKnowledgeUpload({
      filename: "zeta.pdf",
      buffer,
      mimeType: "application/pdf",
    });
    expect(preview.extractionStatus).toBe("success");
    expect(preview.content).toContain("UNIQUE_PDF_TOKEN_ZETA_991");
    expect(preview.warnings.join(" ")).not.toMatch(/DOMMatrix/i);

    const imported = await importKnowledgeUpload({
      filename: "zeta.pdf",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "approved",
    });
    const entry = await getKnowledgeEntry(imported.entryId);
    expect(entry?.content).toContain("UNIQUE_PDF_TOKEN_ZETA_991");
    expect(scoreKnowledgeMatch(entry!, "UNIQUE_PDF_TOKEN_ZETA_991")).toBeGreaterThan(0);
  });

  it("rejects failed PDF extraction from becoming an indexed entry", async () => {
    await expect(
      importKnowledgeUpload({
        filename: "locked.pdf",
        buffer: fixturePasswordProtectedPdf(),
        userId: "00000000-0000-4000-8000-000000000001",
        status: "draft",
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.UPLOAD_PARSE_FAILED });
  });

  it("retries do not create duplicates after a successful import", async () => {
    const buffer = fixtureTextPdf("DEDUP_PDF_TOKEN");
    await importKnowledgeUpload({
      filename: "dedup.pdf",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "draft",
    });
    await expect(
      importKnowledgeUpload({
        filename: "dedup.pdf",
        buffer,
        userId: "00000000-0000-4000-8000-000000000001",
        status: "draft",
      }),
    ).rejects.toMatchObject({ code: KNOWLEDGE_ERROR_CODES.UPLOAD_DUPLICATE });
  });

  it("still parses non-PDF uploads (no regression)", async () => {
    const parsed = await parseKnowledgeUpload({
      filename: "notes.txt",
      buffer: Buffer.from("Plain notes stay intact"),
    });
    expect(parsed.extractionStatus).toBe("success");
    expect(parsed.content).toContain("Plain notes stay intact");
  });
});

describe("Google Drive PDF shares the same extractor", () => {
  it("routes Drive PDFs through parseKnowledgeUpload / extractPdfText", async () => {
    const buffer = fixtureTextPdf("DRIVE_PDF_SHARED_PARSER");
    const parsed = await parseKnowledgeUpload({
      filename: "drive-doc.pdf",
      buffer,
      mimeType: "application/pdf",
    });
    expect(parsed.content).toContain("DRIVE_PDF_SHARED_PARSER");
    expect(parsed.metadata.extractionMethod).toBe("pdf_text");

    // Confirm Drive parser module still imports the shared path (static contract).
    const googleParserSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/lib/connectors/google/parser.ts", import.meta.url), "utf8"),
    );
    expect(googleParserSource).toContain('import("@/lib/knowledge-import/parser")');
    expect(googleParserSource).toContain("parseKnowledgeUpload");
  });
});

describe("PDF diagnostics safety", () => {
  it("does not log extracted document contents", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await extractPdfText(fixtureTextPdf("SECRET_CONTENT_SHOULD_NOT_LOG"));
      const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("knowledge.pdf");
      expect(logged).not.toContain("SECRET_CONTENT_SHOULD_NOT_LOG");
    } finally {
      spy.mockRestore();
    }
  });
});
