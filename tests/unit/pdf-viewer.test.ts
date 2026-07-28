import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isPdfKnowledgeEntry,
  knowledgePdfStreamPath,
  resolveKnowledgeSourceFile,
} from "@/lib/knowledge/source-file";
import { pdfPagesFromMeta } from "@/components/admin/knowledge-center/pdf-knowledge-viewer";
import {
  createKnowledgeEntry,
  patchKnowledgeEntrySyncFields,
  resetKnowledgeMemoryForTests,
} from "@/lib/knowledge/store";
import { resetEnvCacheForTests } from "@/lib/env";
import { importKnowledgeUpload } from "@/lib/knowledge-import/import";
import {
  resetKnowledgeUploadsMemoryForTests,
  findUploadById,
} from "@/lib/knowledge-import/storage";
import { fixtureMultiPageTextPdf, fixtureTextPdf } from "../fixtures/pdf-fixtures";
import { GET as sourceFileGET } from "@/app/api/admin/knowledge/[id]/source-file/route";

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    profile: { role: "admin" },
  })),
}));

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

describe("Knowledge PDF viewer — same-origin stream", () => {
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
    expect(pages.map((p) => p.pageNumber)).toEqual([2, 1]);
    expect(pages[0]?.text).toBe("Second");
  });

  it("points iframe/open URLs at same-origin Baxter stream, never Supabase", async () => {
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
    expect(source.viewUrl).toBe(knowledgePdfStreamPath(imported.entryId));
    expect(source.openUrl).toBe(knowledgePdfStreamPath(imported.entryId));
    expect(source.viewUrl).toContain("mode=stream");
    expect(source.viewUrl).not.toMatch(/supabase\.co/i);
    expect(source.openUrl).not.toMatch(/supabase\.co/i);
    expect(source.viewUrl).not.toMatch(/signed/i);
  });

  it("streams PDF bytes with inline disposition and application/pdf", async () => {
    const buffer = fixtureMultiPageTextPdf();
    const imported = await importKnowledgeUpload({
      filename: "multi.pdf",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "approved",
    });
    const upload = await findUploadById(
      ((await resolveKnowledgeSourceFile(imported.entryId)).uploadId as string) ?? "",
    );
    expect(upload?.bytes?.byteLength).toBeGreaterThan(0);

    const response = await sourceFileGET(
      new Request(
        `http://localhost/api/admin/knowledge/${imported.entryId}/source-file?mode=stream`,
      ),
      { params: Promise.resolve({ id: imported.entryId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(response.headers.get("Cache-Control")).toMatch(/private/);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("supports Range requests with 206 Partial Content", async () => {
    const buffer = fixtureTextPdf("RANGE_OK");
    const imported = await importKnowledgeUpload({
      filename: "range.pdf",
      buffer,
      userId: "00000000-0000-4000-8000-000000000001",
      status: "approved",
    });

    const response = await sourceFileGET(
      new Request(
        `http://localhost/api/admin/knowledge/${imported.entryId}/source-file?mode=stream`,
        {
          headers: { Range: "bytes=0-3" },
        },
      ),
      { params: Promise.resolve({ id: imported.entryId }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toMatch(/^bytes 0-3\//);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString("utf8")).toBe("%PDF");
  });

  it("rejects unauthorized stream requests", async () => {
    const { requireAdmin } = await import("@/lib/auth/session");
    const { AuthorizationError } = await import("@/lib/errors");
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthorizationError("Admin access required"));

    const response = await sourceFileGET(
      new Request(
        "http://localhost/api/admin/knowledge/00000000-0000-4000-8000-000000000099/source-file?mode=stream",
      ),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) },
    );
    expect(response.status).toBe(403);
  });

  it("fails safely when original upload is missing", async () => {
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
    expect(source.viewUrl).toBeNull();

    const response = await sourceFileGET(
      new Request(`http://localhost/api/admin/knowledge/${entry.id}/source-file?mode=stream`),
      { params: Promise.resolve({ id: entry.id }) },
    );
    expect(response.status).toBe(404);
  });

  it("keeps Google PDF open URL and Drive preview for embedding when available", async () => {
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
    expect(source.viewUrl).toContain("drive.google.com/file/d/FILE123/preview");
    expect(source.openUrl).toContain("FILE123");
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
  });

  it("CSP allows same-origin frames and Drive previews", () => {
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain("frame-src 'self' https://drive.google.com");
    expect(config).toContain("object-src 'self'");
    expect(config).not.toMatch(/frame-src[^;]*supabase/i);
  });
});
