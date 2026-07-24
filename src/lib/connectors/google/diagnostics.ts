import "server-only";

import { getEnv } from "@/lib/env";
import {
  getGoogleCredentialStatus,
  isGoogleWorkspaceConfigured,
  isPrivateKeyFormatValid,
  mintAccessToken,
} from "./auth";
import { getFolderMetadata, listFilesInFolder } from "./drive";
import { normalizeGoogleFolderId } from "./folder-id";
import { listGoogleSyncFolders } from "./folders";
import { GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME } from "./types";
import { isSupportedGoogleMime } from "./parser";
import { GoogleWorkspaceConnector } from "./sync";
import { listAllKnowledgeEntriesForRetrieval } from "@/lib/knowledge/store";
import { searchApprovedKnowledge } from "@/lib/knowledge/queries";
import { answerBaxterQuestion } from "@/lib/baxter-ai/answer";

function getGoogleConnector() {
  return new GoogleWorkspaceConnector();
}

export async function testGoogleAuthentication() {
  const status = getGoogleCredentialStatus();
  if (!status.configured) {
    return {
      pass: false,
      code: "BAXTER_GOOGLE_NOT_CONFIGURED",
      message: "GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY is missing.",
      clientEmail: status.clientEmail,
    };
  }
  if (!status.privateKeyFormatValid) {
    return {
      pass: false,
      code: "BAXTER_GOOGLE_PRIVATE_KEY_INVALID",
      message: "Private key does not contain valid BEGIN/END markers after normalization.",
      clientEmail: status.clientEmail,
    };
  }
  try {
    await mintAccessToken();
    return {
      pass: true,
      code: null,
      message: "Service account authenticated successfully.",
      clientEmail: status.clientEmail,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_AUTH_FAILED")
        : "BAXTER_GOOGLE_AUTH_FAILED";
    return {
      pass: false,
      code,
      message: error instanceof Error ? error.message.slice(0, 200) : "Authentication failed",
      clientEmail: status.clientEmail,
    };
  }
}

export async function testGoogleRootFolder() {
  const env = getEnv();
  const status = getGoogleCredentialStatus();
  const raw = status.rootFolderRaw || env.GOOGLE_DRIVE_ROOT_FOLDER;
  if (!raw?.trim()) {
    return {
      pass: false,
      code: "BAXTER_GOOGLE_NOT_CONFIGURED",
      message: "GOOGLE_DRIVE_ROOT_FOLDER is not set.",
    };
  }
  const folderId = normalizeGoogleFolderId(raw);
  try {
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
        ? "Shared Drive folder detected. Ensure the service account is a Shared Drive member or the folder is shared with GOOGLE_CLIENT_EMAIL."
        : "My Drive / shared folder detected. Ensure the folder is shared with GOOGLE_CLIENT_EMAIL (Viewer is enough).",
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "BAXTER_GOOGLE_FOLDER_ACCESS_DENIED")
        : "BAXTER_GOOGLE_FOLDER_ACCESS_DENIED";
    return {
      pass: false,
      code,
      folderId,
      message: error instanceof Error ? error.message.slice(0, 240) : "Folder test failed",
      guidance: [
        `Share the folder with ${status.clientEmail ?? "GOOGLE_CLIENT_EMAIL"} (Viewer).`,
        "GOOGLE_CLIENT_EMAIL is the service-account principal that performs API calls.",
        "baxter@actonadu.com is a Workspace user identity — sharing only with that address is not enough unless it is also the service account email or domain-wide delegation is configured.",
        "Enable Drive, Docs, and Sheets APIs in the Google Cloud project.",
        "Redeploy after changing Vercel environment variables.",
      ],
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

export function googleAdminConfigSnapshot() {
  const status = getGoogleCredentialStatus();
  return {
    ...status,
    privateKeyValidFormat: status.privateKeyFormatValid,
    // Never include private key material
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
    identityNote:
      "GOOGLE_CLIENT_EMAIL is the service-account principal. baxter@actonadu.com is a Workspace identity and is not automatically the same.",
  };
}

export async function getGoogleAdminOverview() {
  const connector = getGoogleConnector();
  const [health, folders, auth] = await Promise.all([
    connector.health(),
    listGoogleSyncFolders(),
    testGoogleAuthentication(),
  ]);
  const { computeGoogleManagerHealth } = await import("./manager-health");
  const managerHealth = await computeGoogleManagerHealth({
    authenticated: auth.pass,
  });
  return {
    config: googleAdminConfigSnapshot(),
    health,
    managerHealth,
    folders,
    authenticated: auth.pass,
    authCode: auth.code,
  };
}

export { isGoogleWorkspaceConfigured, isPrivateKeyFormatValid };
