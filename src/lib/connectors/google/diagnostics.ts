import "server-only";

import { getEnv } from "@/lib/env";
import {
  getGoogleCredentialStatus,
  isGoogleWorkspaceConfigured,
  isPrivateKeyFormatValid,
  mintAccessToken,
  getGoogleConnectionSnapshot,
} from "./auth";
import { getFolderMetadata, listFilesInFolder, listSharedDrives } from "./drive";
import { normalizeGoogleFolderId } from "./folder-id";
import { listGoogleSyncFolders } from "./folders";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME } from "./types";
import { isSupportedGoogleMime } from "./parser";
import { GoogleWorkspaceConnector } from "./sync";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";
import { resolveGoogleCredentialProvider } from "./credentials/resolve";
import { getGoogleAuthMode, isGoogleOAuthConfigured } from "./oauth-config";

function getGoogleConnector() {
  return new GoogleWorkspaceConnector();
}

export async function testGoogleAuthentication() {
  const mode = getGoogleAuthMode();
  const status = getGoogleCredentialStatus();

  try {
    const provider = await resolveGoogleCredentialProvider();
    const health = await provider.health();
    const identity = await provider.getIdentity();
    return {
      pass: health.ok,
      code: health.code,
      message: health.message,
      authMode: provider.mode,
      email: identity.email ?? status.clientEmail,
      clientEmail: identity.email ?? status.clientEmail,
      driveAccess: health.ok ? "available" : "unknown",
      docsAccess: health.ok ? "available" : "unknown",
      sheetsAccess: health.ok ? "available" : "unknown",
      access: "Read-only Google Drive, Docs, and Sheets",
      serviceAccountWarning:
        provider.mode === "service_account" ? status.serviceAccountExternalWarning : null,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_AUTH_FAILED")
        : "BAXTER_GOOGLE_AUTH_FAILED";
    return {
      pass: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 240) : "Authentication failed",
      authMode: mode,
      email: status.clientEmail,
      clientEmail: status.clientEmail,
      driveAccess: "unavailable",
      docsAccess: "unavailable",
      sheetsAccess: "unavailable",
      access: "Read-only Google Drive, Docs, and Sheets",
      oauthConfigured: isGoogleOAuthConfigured(),
      guidance:
        mode === "workspace_oauth"
          ? [
              "Click Connect Google Workspace and sign in as baxter@actonadu.com.",
              "Ensure GOOGLE_OAUTH_* and GOOGLE_TOKEN_ENCRYPTION_KEY are set in Vercel.",
              "Enable Drive, Docs, and Sheets APIs in Google Cloud Console.",
            ]
          : [
              "Verify GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.",
              "Enable Drive, Docs, and Sheets APIs.",
              "Prefer Workspace OAuth for Acton Shared Drives.",
            ],
    };
  }
}

export async function testGoogleRootFolder() {
  const env = getEnv();
  const status = getGoogleCredentialStatus();
  const raw = status.rootFolderRaw || env.GOOGLE_DRIVE_ROOT_FOLDER;
  const folders = await listGoogleSyncFolders();
  const active = folders.find((f) => f.status === "active");
  const folderSource = active?.folder_id || raw;
  if (!folderSource?.trim()) {
    return {
      pass: false,
      code: "BAXTER_GOOGLE_NOT_CONFIGURED",
      message: "No Knowledge root selected. Browse Shared Drives or add a folder.",
      guidance: [
        "Connect Google Workspace as baxter@actonadu.com.",
        "Open Shared Drives and connect Acton ADU Shared Drive as a root.",
      ],
    };
  }
  const folderId = normalizeGoogleFolderId(folderSource);
  try {
    await mintAccessToken();
    const meta = await getFolderMetadata(folderId);
    const sample = await listFilesInFolder(meta.id);
    return {
      pass: true,
      code: null,
      folderId: meta.id,
      folderName: meta.name,
      sharedDrive: Boolean(meta.driveId),
      driveId: meta.driveId ?? null,
      sampleItemCount: sample.length,
      guidance: meta.driveId
        ? "Shared Drive folder detected and readable by the connected Google account."
        : "Folder is readable by the connected Google account.",
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_PERMISSION_DENIED")
        : "BAXTER_GOOGLE_PERMISSION_DENIED";
    const guidance =
      code === "BAXTER_GOOGLE_DRIVE_API_DISABLED"
        ? [
            "Open Google Cloud Console.",
            `Select project ${status.projectIdPresent ? "(GOOGLE_PROJECT_ID)" : "matching your OAuth client"}.`,
            "Go to APIs & Services → Library.",
            'Search for "Google Drive API" (publisher: Google Enterprise API).',
            "Click Enable.",
            "Return here and test again.",
          ]
        : code === "BAXTER_GOOGLE_SHARED_DRIVE_NOT_VISIBLE"
          ? [
              "The connected account cannot see this Shared Drive.",
              "Connect as baxter@actonadu.com (Workspace OAuth), not the external service account.",
              "Confirm baxter@actonadu.com is a Shared Drive member.",
            ]
          : [
              "Confirm the connected Google account can open this folder in drive.google.com.",
              "Prefer Workspace OAuth over the external service account for Shared Drives.",
              "Enable Drive, Docs, and Sheets APIs if needed.",
            ];
    return {
      pass: false,
      code,
      folderId,
      message: error instanceof Error ? error.message.slice(0, 240) : "Folder test failed",
      guidance,
    };
  }
}

export async function listGoogleSharedDrivesDiagnostic() {
  try {
    const drives = await listSharedDrives();
    return {
      pass: true,
      code: null,
      drives,
      message:
        drives.length === 0
          ? "No Shared Drives visible to the connected account."
          : `Found ${drives.length} Shared Drive(s).`,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_PERMISSION_DENIED")
        : "BAXTER_GOOGLE_PERMISSION_DENIED";
    return {
      pass: false,
      code,
      drives: [],
      message:
        error instanceof Error ? error.message.slice(0, 240) : "Could not list Shared Drives",
    };
  }
}

export async function listGoogleSampleFiles(limit = 8) {
  const env = getEnv();
  const folderId = normalizeGoogleFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER || "");
  if (!folderId) {
    const folders = await listGoogleSyncFolders();
    const active = folders.find((f) => f.status === "active");
    if (!active) {
      return { pass: false, files: [], message: "No root folder or sync folder configured." };
    }
    const files = (await listFilesInFolder(active.folder_id)).slice(0, limit);
    return {
      pass: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink ?? null,
        supported: isSupportedGoogleMime(f.mimeType),
      })),
    };
  }
  const files = (await listFilesInFolder(folderId)).slice(0, limit);
  return {
    pass: true,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink ?? null,
      supported: isSupportedGoogleMime(f.mimeType),
    })),
  };
}

export async function dryRunGoogleSync() {
  const env = getEnv();
  const folders = await listGoogleSyncFolders();
  const targets =
    folders.length > 0
      ? folders.filter((f) => f.status === "active")
      : env.GOOGLE_DRIVE_ROOT_FOLDER
        ? [
            {
              folder_id: normalizeGoogleFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER),
              folder_name: "root",
            },
          ]
        : [];

  if (targets.length === 0) {
    return {
      pass: false,
      message: "No folders configured for dry-run.",
      discovered: 0,
    };
  }

  const existing = await listAllKnowledgeEntriesForRetrieval();
  let discovered = 0;
  let docs = 0;
  let sheets = 0;
  let textFiles = 0;
  let unsupported = 0;
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let unchanged = 0;

  for (const folder of targets) {
    const files = await listFilesInFolder(folder.folder_id);
    for (const file of files) {
      discovered += 1;
      if (file.mimeType === GOOGLE_DOC_MIME) docs += 1;
      else if (file.mimeType === GOOGLE_SHEET_MIME) sheets += 1;
      else if (isSupportedGoogleMime(file.mimeType)) textFiles += 1;
      else {
        unsupported += 1;
        continue;
      }
      const match = existing.find(
        (entry) => entry.source_type === "Google Drive" && entry.source_external_id === file.id,
      );
      if (!match) wouldCreate += 1;
      else if (match.updated_at && file.modifiedTime && match.updated_at < file.modifiedTime) {
        wouldUpdate += 1;
      } else unchanged += 1;
    }
  }

  return {
    pass: true,
    discovered,
    googleDocs: docs,
    googleSheets: sheets,
    textOrMarkdown: textFiles,
    unsupported,
    wouldCreate,
    wouldUpdate,
    unchanged,
    note: "Dry-run does not modify the Knowledge Base.",
  };
}

export async function testGoogleSourceThroughBaxter(userId: string) {
  const entries = await listAllKnowledgeEntriesForRetrieval();
  const google = entries.find(
    (entry) =>
      entry.status === "approved" &&
      entry.visibility === "internal" &&
      entry.source_type === "Google Drive",
  );
  if (!google) {
    return {
      pass: false,
      message: "No approved Google Drive knowledge entries exist yet. Run a real sync first.",
    };
  }

  const question = google.title.toLowerCase().includes("baxter")
    ? "Who is Baxter?"
    : `What does the document “${google.title}” cover?`;

  const search = await searchApprovedKnowledge({ query: question, limit: 5 });
  const found = search.some((row) => row.id === google.id);
  const answer = await answerBaxterQuestion({
    question,
    userId,
    userName: "Google diagnostic",
    channel: "web",
  });
  const used = answer.sources.some(
    (source) =>
      source.knowledgeEntryId === google.id ||
      source.sourceUrl === google.source_url ||
      source.title === google.title,
  );

  return {
    pass: found && used && Boolean(google.source_url),
    question,
    entryId: google.id,
    entryTitle: google.title,
    sourceUrl: google.source_url,
    retrieved: found,
    citedInAnswer: used,
    answerMode: answer.answerMode ?? null,
    answerPreview: answer.answer.slice(0, 240),
  };
}

export async function googleAdminConfigSnapshot() {
  const status = getGoogleCredentialStatus();
  const snapshot = await getGoogleConnectionSnapshot();
  return {
    ...status,
    privateKeyValidFormat: status.privateKeyFormatValid,
    syncEnabled: (() => {
      try {
        return getEnv().GOOGLE_SYNC_ENABLED;
      } catch {
        return true;
      }
    })(),
    syncIntervalMinutes: (() => {
      try {
        return getEnv().GOOGLE_SYNC_INTERVAL_MINUTES;
      } catch {
        return 180;
      }
    })(),
    connection: snapshot.connection,
    identityNote:
      status.authMode === "workspace_oauth"
        ? "API calls use the connected Workspace user (preferred for Acton Shared Drives)."
        : "GOOGLE_CLIENT_EMAIL is the service-account principal. It is often external to Acton Workspace.",
  };
}

export async function getGoogleAdminOverview() {
  const connector = getGoogleConnector();
  const [health, folders, auth, config] = await Promise.all([
    connector.health(),
    listGoogleSyncFolders(),
    testGoogleAuthentication(),
    googleAdminConfigSnapshot(),
  ]);
  const { computeGoogleManagerHealth } = await import("./manager-health");
  const managerHealth = await computeGoogleManagerHealth({
    authenticated: auth.pass,
  });
  return {
    config,
    health,
    managerHealth,
    folders,
    authenticated: auth.pass,
    authCode: auth.code,
    authResult: auth,
  };
}

export { isGoogleWorkspaceConfigured, isPrivateKeyFormatValid };
