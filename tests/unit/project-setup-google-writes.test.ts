import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_DOCS_READONLY_SCOPE,
  GOOGLE_SHEETS_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
  hasGoogleWriteScopes,
  requiredScopesGranted,
  resolveGoogleAccessMode,
} from "@/lib/connectors/google/credentials/types";
import { googleWritesEnabledFromScopes } from "@/lib/project-setup/capabilities";
import {
  columnAContainsProjectNumber,
  computeNextProjectNumberFromColumnA,
  formatFpPaidDateForSheet,
} from "@/lib/project-setup/project-number";
import { GoogleConnectorError } from "@/lib/connectors/google/errors";

const listChildren = vi.fn();
const findChildByName = vi.fn();
const createFolder = vi.fn();
const copyFile = vi.fn();
const countDriveTree = vi.fn();
const appendSheetRow = vi.fn();
const readSheetColumn = vi.fn();

vi.mock("@/lib/connectors/google/connections", () => ({
  getActiveGoogleConnectionPublic: vi.fn(async () => ({
    google_account_email: "baxter@actonadu.com",
  })),
  getActiveGoogleConnection: vi.fn(async () => ({
    granted_scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents.readonly",
    ],
    status: "connected",
  })),
}));

vi.mock("@/lib/project-setup/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-setup/store")>();
  return {
    ...actual,
    updateProjectSetupStep: vi.fn(async () => ({})),
    updateProjectSetupRun: vi.fn(async () => ({})),
    isProjectNumberInUse: vi.fn(async () => false),
  };
});

vi.mock("@/lib/connectors/google/writes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/connectors/google/writes")>(
    "@/lib/connectors/google/writes",
  );
  return {
    ...actual,
    listChildren: (...args: unknown[]) => listChildren(...args),
    findChildByName: (...args: unknown[]) => findChildByName(...args),
    createFolder: (...args: unknown[]) => createFolder(...args),
    copyFile: (...args: unknown[]) => copyFile(...args),
    countDriveTree: (...args: unknown[]) => countDriveTree(...args),
    appendSheetRow: (...args: unknown[]) => appendSheetRow(...args),
    readSheetColumn: (...args: unknown[]) => readSheetColumn(...args),
  };
});

const googleWritesEnabledMock = vi.fn(async () => true);
vi.mock("@/lib/project-setup/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-setup/capabilities")>();
  return {
    ...actual,
    googleWritesEnabled: () => googleWritesEnabledMock(),
    slackProvisioningEnabled: () => false,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  googleWritesEnabledMock.mockResolvedValue(true);
});

describe("Google scope validator + write gating", () => {
  const readOnly = [
    "openid",
    "email",
    GOOGLE_DRIVE_READONLY_SCOPE,
    GOOGLE_DOCS_READONLY_SCOPE,
    GOOGLE_SHEETS_READONLY_SCOPE,
  ];
  const readWrite = [
    "openid",
    "email",
    GOOGLE_DRIVE_SCOPE,
    GOOGLE_DOCS_READONLY_SCOPE,
    GOOGLE_SHEETS_SCOPE,
  ];
  const mixed = [GOOGLE_DRIVE_SCOPE, GOOGLE_DOCS_READONLY_SCOPE, GOOGLE_SHEETS_READONLY_SCOPE];

  it("treats full write scopes as satisfying read requirements", () => {
    expect(requiredScopesGranted(readOnly)).toBe(true);
    expect(requiredScopesGranted(readWrite)).toBe(true);
    expect(requiredScopesGranted(mixed)).toBe(true);
    expect(requiredScopesGranted(["openid"])).toBe(false);
  });

  it("gates googleWritesEnabledFromScopes on both write scopes", () => {
    expect(hasGoogleWriteScopes(readOnly)).toBe(false);
    expect(googleWritesEnabledFromScopes(readOnly)).toBe(false);
    expect(hasGoogleWriteScopes(readWrite)).toBe(true);
    expect(googleWritesEnabledFromScopes(readWrite)).toBe(true);
    expect(hasGoogleWriteScopes(mixed)).toBe(false);
  });

  it("resolves access mode labels", () => {
    expect(resolveGoogleAccessMode(readOnly)).toBe("read_only");
    expect(resolveGoogleAccessMode(readWrite)).toBe("read_write");
    expect(resolveGoogleAccessMode([])).toBe("unknown");
  });
});

describe("year rollover + date formatting", () => {
  it("increments within year and rolls to YY001", () => {
    expect(
      computeNextProjectNumberFromColumnA([["L01-26017"]], { referenceYear: 26 }).nextNumber,
    ).toBe("L01-26018");
    expect(
      computeNextProjectNumberFromColumnA([["L01-26017"]], { referenceYear: 27 }),
    ).toMatchObject({ nextNumber: "L01-27001", rolledOver: true });
  });

  it("formats FP paid dates for Sheets", () => {
    expect(formatFpPaidDateForSheet("2026-07-31")).toBe("7/31/2026");
  });
});

describe("append idempotency helpers", () => {
  it("detects existing project numbers in column A", () => {
    expect(columnAContainsProjectNumber([["L01-26017"], ["L01-26018"]], "l01-26018")).toBe(true);
    expect(columnAContainsProjectNumber([["L01-26017"]], "L01-26018")).toBe(false);
  });

  it("orders Master Log columns A–I", async () => {
    const { execute } = (await import("@/lib/project-setup/steps")).PROJECT_SETUP_STEPS.find(
      (s) => s.key === "append_master_log_row",
    )!;

    readSheetColumn.mockResolvedValue([["L01-26017"]]);
    appendSheetRow.mockResolvedValue({
      updatedRange: "Master Project Log!A42:I42",
      updatedRows: 1,
    });

    const baseCtx = {
      run: {
        id: "run-1",
        status: "running" as const,
        dryRun: false,
        initiatedBy: "u1",
        triggerChannel: "web" as const,
        ghlContactId: "c1",
        contactSnapshot: {
          id: "c1",
          name: "Pat Example",
          firstName: "Pat",
          lastName: "Example",
          email: null,
          phone: null,
          address: "123 Main St, San Jose, CA 95110",
          city: "San Jose",
          state: "CA",
          postalCode: "95110",
          assignedUserId: null,
          assignedUserName: null,
        },
        salesRep: "Jesse",
        projectNumber: "L01-26018",
        projectLastName: "Example",
        folderName: "L01-26018 Example",
        charterName: "Example Project Charter",
        slackChannelName: "l01-26018-example",
        fpPaidDate: "2026-07-31",
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      settings: {
        id: 1 as const,
        memberEmails: [] as string[],
        testMode: true,
        testMemberEmails: ["jackson.bridges@actonadu.com"],
        templateFolderId: "tmpl",
        projectsParentFolderId: "parent",
        masterCharterSpreadsheetId: "sheet",
        masterLogTabName: "Master Project Log",
        updatedBy: null,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      priorOutputs: { allocate_project_number: { projectNumber: "L01-26018" } },
      stepId: "step-1",
      partialOutput: {},
    };

    const result = await execute(baseCtx);

    expect(appendSheetRow).toHaveBeenCalledWith(
      expect.objectContaining({
        values: [
          "L01-26018",
          "Example",
          "Jesse",
          "7/31/2026",
          "Pat Example",
          "123 Main St",
          "San Jose",
          "95110",
          "San Jose",
        ],
      }),
    );
    expect(result.outputJson.updatedRange).toBe("Master Project Log!A42:I42");

    readSheetColumn.mockResolvedValue([["L01-26018"]]);
    appendSheetRow.mockClear();
    const again = await execute({ ...baseCtx, priorOutputs: {} });
    expect(again.outputJson.alreadyPresent).toBe(true);
    expect(appendSheetRow).not.toHaveBeenCalled();
  });
});

describe("recursive folder copy", () => {
  it("mirrors nested tree, skips shortcuts, resumes missing only", async () => {
    const { copyTemplateFolderTree } = await import("@/lib/project-setup/folder-copy");
    const { GOOGLE_FOLDER_MIME } = await import("@/lib/connectors/google/types");
    const { GOOGLE_SHORTCUT_MIME } = await import("@/lib/connectors/google/writes");

    findChildByName.mockResolvedValue(null);
    createFolder
      .mockResolvedValueOnce({
        id: "dest-root",
        name: "L01-26018 Example",
        mimeType: GOOGLE_FOLDER_MIME,
        webViewLink: "https://drive.google.com/dest",
      })
      .mockResolvedValueOnce({
        id: "dest-sub",
        name: "Docs",
        mimeType: GOOGLE_FOLDER_MIME,
      });

    listChildren
      // source root
      .mockResolvedValueOnce([
        { id: "src-sub", name: "Docs", mimeType: GOOGLE_FOLDER_MIME },
        { id: "src-file", name: "readme.txt", mimeType: "text/plain" },
        { id: "src-short", name: "link", mimeType: GOOGLE_SHORTCUT_MIME },
      ])
      // dest root (empty initially)
      .mockResolvedValueOnce([])
      // source Docs
      .mockResolvedValueOnce([{ id: "src-inner", name: "notes.txt", mimeType: "text/plain" }])
      // dest Docs empty
      .mockResolvedValueOnce([]);

    copyFile
      .mockResolvedValueOnce({
        id: "copied-readme",
        name: "readme.txt",
        mimeType: "text/plain",
      })
      .mockResolvedValueOnce({
        id: "copied-notes",
        name: "notes.txt",
        mimeType: "text/plain",
      });

    countDriveTree
      .mockResolvedValueOnce({ folders: 1, files: 2, shortcuts: 1 })
      .mockResolvedValueOnce({ folders: 1, files: 2, shortcuts: 0 });

    const first = await copyTemplateFolderTree({
      templateFolderId: "tmpl",
      projectsParentFolderId: "parent",
      folderName: "L01-26018 Example",
    });
    expect(first.destinationFolderId).toBe("dest-root");
    expect(first.skipped).toHaveLength(1);
    expect(first.verification.match).toBe(true);
    expect(copyFile).toHaveBeenCalledTimes(2);

    // Resume: prior dest exists; one file already present
    findChildByName.mockReset();
    createFolder.mockReset();
    listChildren.mockReset();
    copyFile.mockReset();
    countDriveTree.mockReset();

    listChildren
      .mockResolvedValueOnce([
        { id: "src-sub", name: "Docs", mimeType: GOOGLE_FOLDER_MIME },
        { id: "src-file", name: "readme.txt", mimeType: "text/plain" },
      ])
      .mockResolvedValueOnce([
        { id: "dest-sub", name: "Docs", mimeType: GOOGLE_FOLDER_MIME },
        { id: "copied-readme", name: "readme.txt", mimeType: "text/plain" },
      ])
      .mockResolvedValueOnce([{ id: "src-inner", name: "notes.txt", mimeType: "text/plain" }])
      .mockResolvedValueOnce([]);

    copyFile.mockResolvedValueOnce({
      id: "copied-notes-2",
      name: "notes.txt",
      mimeType: "text/plain",
    });
    countDriveTree
      .mockResolvedValueOnce({ folders: 1, files: 2, shortcuts: 0 })
      .mockResolvedValueOnce({ folders: 1, files: 2, shortcuts: 0 });

    const resumed = await copyTemplateFolderTree({
      templateFolderId: "tmpl",
      projectsParentFolderId: "parent",
      folderName: "L01-26018 Example",
      priorDestinationFolderId: "dest-root",
    });
    expect(createFolder).not.toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledTimes(1);
    expect(resumed.copiedFiles).toBe(1);
  });

  it("fails loudly on unexpected existing destination folder", async () => {
    const { copyTemplateFolderTree } = await import("@/lib/project-setup/folder-copy");
    const { GOOGLE_FOLDER_MIME } = await import("@/lib/connectors/google/types");
    findChildByName.mockResolvedValue({
      id: "other",
      name: "L01-26018 Example",
      mimeType: GOOGLE_FOLDER_MIME,
    });
    await expect(
      copyTemplateFolderTree({
        templateFolderId: "tmpl",
        projectsParentFolderId: "parent",
        folderName: "L01-26018 Example",
      }),
    ).rejects.toThrow(/did not create it/);
  });

  it("fails verification when counts mismatch", async () => {
    const { copyTemplateFolderTree } = await import("@/lib/project-setup/folder-copy");
    const { GOOGLE_FOLDER_MIME } = await import("@/lib/connectors/google/types");
    findChildByName.mockResolvedValue(null);
    createFolder.mockResolvedValue({
      id: "dest-root",
      name: "L01-26018 Example",
      mimeType: GOOGLE_FOLDER_MIME,
      webViewLink: "https://drive/x",
    });
    listChildren.mockResolvedValueOnce([{ id: "f1", name: "a.txt", mimeType: "text/plain" }]);
    listChildren.mockResolvedValueOnce([]);
    copyFile.mockResolvedValue({ id: "c1", name: "a.txt", mimeType: "text/plain" });
    countDriveTree
      .mockResolvedValueOnce({ folders: 0, files: 2, shortcuts: 0 })
      .mockResolvedValueOnce({ folders: 0, files: 1, shortcuts: 0 });

    await expect(
      copyTemplateFolderTree({
        templateFolderId: "tmpl",
        projectsParentFolderId: "parent",
        folderName: "L01-26018 Example",
      }),
    ).rejects.toThrow(/verification failed/);
  });
});

describe("charter copy idempotency", () => {
  it("reuses existing charter file", async () => {
    const step = (await import("@/lib/project-setup/steps")).PROJECT_SETUP_STEPS.find(
      (s) => s.key === "copy_charter_spreadsheet",
    )!;

    findChildByName.mockResolvedValue({
      id: "charter-1",
      name: "Example Project Charter",
      mimeType: "application/vnd.google-apps.spreadsheet",
      webViewLink: "https://docs.google.com/charter",
    });

    const result = await step.execute({
      run: {
        id: "run-1",
        status: "running",
        dryRun: false,
        initiatedBy: "u1",
        triggerChannel: "web",
        ghlContactId: "c1",
        contactSnapshot: {
          id: "c1",
          name: "Pat",
          firstName: "Pat",
          lastName: "Example",
          email: null,
          phone: null,
          address: null,
          city: null,
          state: null,
          postalCode: null,
          assignedUserId: null,
          assignedUserName: null,
        },
        salesRep: "Jesse",
        projectNumber: "L01-26018",
        projectLastName: "Example",
        folderName: "L01-26018 Example",
        charterName: "Example Project Charter",
        slackChannelName: "l01-26018-example",
        fpPaidDate: "2026-07-31",
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      settings: {
        id: 1,
        memberEmails: [],
        testMode: true,
        testMemberEmails: [],
        templateFolderId: "tmpl",
        projectsParentFolderId: "parent",
        masterCharterSpreadsheetId: "master",
        masterLogTabName: "Master Project Log",
        updatedBy: null,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      priorOutputs: {
        copy_template_folder: { destinationFolderId: "dest-root" },
      },
      stepId: "s1",
      partialOutput: {},
    });

    expect(result.outputJson.alreadyPresent).toBe(true);
    expect(copyFile).not.toHaveBeenCalled();
  });
});

describe("permission error mapping", () => {
  it("names the connected account in employee-readable errors", async () => {
    const { toEmployeeGoogleError } = await import("@/lib/connectors/google/writes");
    const err = await toEmployeeGoogleError(
      new GoogleConnectorError("forbidden", {
        code: "BAXTER_GOOGLE_PERMISSION_DENIED",
        statusCode: 403,
      }),
      { resourceLabel: "the 02 Projects folder" },
    );
    expect(err.message).toMatch(/baxter@actonadu\.com lacks edit access to the 02 Projects folder/);
  });
});
