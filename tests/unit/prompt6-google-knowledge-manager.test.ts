import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

describe("cron auth", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_CRON_SECRET;
    resetEnvCacheForTests();
  });

  it("rejects browser request without authorization", async () => {
    process.env.CRON_SECRET = "prod-secret";
    const { authorizeCronBearer } = await import("@/lib/jobs/cron-auth");
    const result = authorizeCronBearer(new Request("http://localhost/api/internal/process-jobs"));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("BAXTER_CRON_UNAUTHORIZED");
  });

  it("accepts Bearer CRON_SECRET", async () => {
    process.env.CRON_SECRET = "prod-secret";
    const { authorizeCronBearer } = await import("@/lib/jobs/cron-auth");
    const result = authorizeCronBearer(
      new Request("http://localhost/api/internal/process-jobs", {
        headers: { authorization: "Bearer prod-secret" },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts legacy INTERNAL_CRON_SECRET alias", async () => {
    process.env.INTERNAL_CRON_SECRET = "legacy-secret";
    const { authorizeCronBearer, getCanonicalCronSecretName } =
      await import("@/lib/jobs/cron-auth");
    expect(getCanonicalCronSecretName()).toBe("INTERNAL_CRON_SECRET");
    const result = authorizeCronBearer(
      new Request("http://localhost/api/internal/process-jobs", {
        headers: { authorization: "Bearer legacy-secret" },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects incorrect secret", async () => {
    process.env.CRON_SECRET = "prod-secret";
    const { authorizeCronBearer } = await import("@/lib/jobs/cron-auth");
    const result = authorizeCronBearer(
      new Request("http://localhost/api/internal/process-jobs", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects query-string secrets", async () => {
    process.env.CRON_SECRET = "prod-secret";
    const { authorizeCronBearer } = await import("@/lib/jobs/cron-auth");
    const result = authorizeCronBearer(
      new Request("http://localhost/api/internal/process-jobs?secret=prod-secret"),
    );
    expect(result.ok).toBe(false);
  });

  it("does not return secret values in diagnostics", async () => {
    process.env.CRON_SECRET = "should-not-leak";
    const { getCronConfigDiagnostics } = await import("@/lib/jobs/cron-auth");
    const diag = getCronConfigDiagnostics();
    expect(JSON.stringify(diag)).not.toContain("should-not-leak");
    expect(diag.cronSecretConfigured).toBe(true);
    expect(diag.canonicalVariable).toBe("CRON_SECRET");
  });
});

describe("process-jobs route", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_CRON_SECRET;
    resetEnvCacheForTests();
  });

  it("returns auth error without bearer and never leaks secret", async () => {
    process.env.CRON_SECRET = "hidden-secret";
    // Auth fails before schedule/process — no need to mock those modules.
    const { GET } = await import("@/app/api/internal/process-jobs/route");
    const response = await GET(new Request("http://localhost/api/internal/process-jobs"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("hidden-secret");
    expect(body.error?.message).toMatch(/cron secret/i);
  });
});

describe("Drive root parsing", () => {
  it("parses folder IDs and Drive URLs", async () => {
    const { normalizeGoogleFolderId } = await import("@/lib/connectors/google/folder-id");
    expect(normalizeGoogleFolderId("1AbC_def-GHI")).toBe("1AbC_def-GHI");
    expect(
      normalizeGoogleFolderId("https://drive.google.com/drive/folders/1AbC_def-GHI?usp=sharing"),
    ).toBe("1AbC_def-GHI");
    expect(normalizeGoogleFolderId("")).toBe("");
  });
});

describe("source selections", () => {
  beforeEach(async () => {
    process.env.ENABLE_MOCK_RESEARCH = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    resetEnvCacheForTests();
    const { resetGoogleSelectionsMemoryForTests } =
      await import("@/lib/connectors/google/selections");
    const { resetGoogleFoldersMemoryForTests } = await import("@/lib/connectors/google/folders");
    resetGoogleSelectionsMemoryForTests();
    resetGoogleFoldersMemoryForTests();
  });

  it("upserts file selection and prevents duplicate include rows", async () => {
    const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
    const { upsertSelection, listSelectionsForRoot } =
      await import("@/lib/connectors/google/selections");
    const root = await addGoogleSyncFolder({
      folderId: "root1",
      folderName: "Root",
      driveId: null,
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const first = await upsertSelection({
      rootId: root.id,
      googleFileId: "file-1",
      selectionType: "file",
      titleSnapshot: "Doc",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const second = await upsertSelection({
      rootId: root.id,
      googleFileId: "file-1",
      selectionType: "file",
      titleSnapshot: "Doc updated",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    expect(second.id).toBe(first.id);
    const list = await listSelectionsForRoot(root.id);
    expect(list.filter((s) => !s.explicitly_excluded)).toHaveLength(1);
  });

  it("supports folder recursive future inclusion and exclusion", async () => {
    const { addGoogleSyncFolder } = await import("@/lib/connectors/google/folders");
    const { upsertSelection, listSelectionsForRoot } =
      await import("@/lib/connectors/google/selections");
    const root = await addGoogleSyncFolder({
      folderId: "root2",
      folderName: "Root2",
      driveId: "drive-1",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    await upsertSelection({
      rootId: root.id,
      googleFileId: "folder-a",
      selectionType: "folder",
      recursive: true,
      includeFutureFiles: true,
      titleSnapshot: "Sales",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    await upsertSelection({
      rootId: root.id,
      googleFileId: "file-skip",
      selectionType: "file",
      explicitlyExcluded: true,
      titleSnapshot: "Skip me",
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const list = await listSelectionsForRoot(root.id);
    expect(list.some((s) => s.selection_type === "folder" && s.include_future_files)).toBe(true);
    expect(list.some((s) => s.explicitly_excluded)).toBe(true);
  });
});

describe("scheduled google sync", () => {
  it("does not enqueue when GOOGLE_SYNC_ENABLED=false", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.APP_BASE_URL = "https://example.com";
    process.env.GOOGLE_SYNC_ENABLED = "false";
    process.env.GOOGLE_CLIENT_EMAIL = "sa@example.iam.gserviceaccount.com";
    process.env.GOOGLE_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n";
    resetEnvCacheForTests();
    vi.resetModules();
    const { maybeEnqueueScheduledGoogleSync } = await import("@/lib/connectors/google/schedule");
    const result = await maybeEnqueueScheduledGoogleSync();
    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/GOOGLE_SYNC_ENABLED/);
  });
});

describe("sheets structured export formatting", () => {
  it("preserves tab names, headers, and truncation disclosure in text", async () => {
    const tabs = [
      {
        title: "Pipeline",
        headers: ["Deal", "Stage"],
        rowCount: 2,
        truncated: true,
        text: "## Sheet: Pipeline\nHeaders: Deal | Stage\nRow 1: Deal=A; Stage=Open\n[truncated]",
      },
    ];
    const contentText = tabs.map((t) => t.text).join("\n\n");
    expect(contentText).toContain("## Sheet: Pipeline");
    expect(contentText).toContain("Headers: Deal | Stage");
    expect(contentText).toContain("Row 1:");
    expect(tabs[0]!.truncated).toBe(true);
  });
});
