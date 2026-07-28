import { describe, expect, it } from "vitest";
import { isPdfKnowledgeEntry, resolveKnowledgeSourceFile } from "@/lib/knowledge/source-file";
import { pdfPagesFromMeta } from "@/components/admin/knowledge-center/pdf-knowledge-viewer";
import {
  createKnowledgeEntry,
  patchKnowledgeEntrySyncFields,
  resetKnowledgeMemoryForTests,
} from "@/lib/knowledge/store";
import { resetEnvCacheForTests } from "@/lib/env";
import { importKnowledgeUpload } from "@/lib/knowledge-import/import";
import { resetKnowledgeUploadsMemoryForTests } from "@/lib/knowledge-import/storage";
import { fixtureTextPdf } from "../fixtures/pdf-fixtures";
import { beforeEach } from "vitest";

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

describe("Knowledge PDF viewer helpers", () => {
  it("recognizes uploaded PDF entries", () => {
    expect(
      isPdfKnowledgeEntry({
        mimeType: "application/pdf",
        filename: "handbook.pdf",
        metadata: {},
      }),
    ).toBe(true);
    expect(
      isPdfKnowledgeEntry({
        mimeType: "text/plain",
        filename: "notes.txt",
        metadata: {},
      }),
    ).toBe(false);
  });

  it("groups extracted text by pdfPages metadata", () => {
    const pages = pdfPagesFromMeta({
      pdfPages: [
        { pageNumber: 2, text: "Second" },
        { pageNumber: 1, text: "First" },
      ],
    });
    expect(pages).toEqual([
      { pageNumber: 2, text: "Second" },
      { pageNumber: 1, text: "First" },
    ]);
  });

  it("resolves uploaded PDF to authenticated stream when signed URL unavailable", async () => {
    const buffer = fixtureTextPdf("VIEWER_TOKEN");
    const imported = await importKnowledgeUpload({
      filename: "handbook.pdf",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "approved",
    });

    const source = await resolveKnowledgeSourceFile(imported.entryId);
    expect(source.kind).toBe("upload_pdf");
    expect(source.available).toBe(true);
    expect(source.viewUrl).toContain(`/api/admin/knowledge/${imported.entryId}/source-file`);
    expect(source.mimeType).toBe("application/pdf");
  });

  it("resolves Google PDF to Drive preview / open URL", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Drive Handbook.pdf",
        content: "## Page 1\nHello",
        source_type: "Google Drive",
        source_url: "https://drive.google.com/file/d/FILE123/view",
        status: "approved",
        visibility: "internal",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    await patchKnowledgeEntrySyncFields(entry.id, {
      source_external_id: "FILE123",
      metadata: {
        googleManaged: true,
        mimeType: "application/pdf",
        google: { fileId: "FILE123", mimeType: "application/pdf" },
        pdfPages: [{ pageNumber: 1, text: "Hello" }],
      },
    });

    const source = await resolveKnowledgeSourceFile(entry.id);
    expect(source.kind).toBe("google_pdf");
    expect(source.available).toBe(true);
    expect(source.viewUrl).toContain("drive.google.com/file/d/FILE123/preview");
    expect(source.openUrl).toContain("FILE123");
  });

  it("degrades gracefully when original upload is missing", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Orphan PDF",
        content: "## Page 1\nStill here",
        source_type: "uploaded_document",
        status: "approved",
        visibility: "internal",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    await patchKnowledgeEntrySyncFields(entry.id, {
      metadata: {
        uploaded: true,
        mimeType: "application/pdf",
        originalFilename: "orphan.pdf",
        uploadId: "00000000-0000-4000-8000-000000000099",
        pdfPages: [{ pageNumber: 1, text: "Still here" }],
      },
    });

    const source = await resolveKnowledgeSourceFile(entry.id);
    expect(source.kind).toBe("upload_pdf");
    expect(source.available).toBe(false);
    expect(source.unavailableReason).toMatch(/Original PDF unavailable/i);
  });

  it("does not treat non-PDF knowledge as a PDF source", async () => {
    const entry = await createKnowledgeEntry(
      {
        title: "Plain note",
        content: "Hello",
        source_type: "manual",
        status: "approved",
        visibility: "internal",
      },
      "00000000-0000-4000-8000-000000000001",
    );
    const source = await resolveKnowledgeSourceFile(entry.id);
    expect(source.kind).toBe("none");
    expect(source.available).toBe(false);
  });
});
