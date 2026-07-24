import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getGoogleConnector, resolveAndAddFolder } from "@/lib/connectors/google";
import {
  listGoogleSyncFolders,
  removeGoogleSyncFolder,
  updateGoogleSyncFolder,
  getGoogleSyncFolder,
} from "@/lib/connectors/google";
import { enqueueJob } from "@/lib/jobs/queue";

export async function GET() {
  try {
    await requireAdmin();
    const connector = getGoogleConnector();
    const [health, folders] = await Promise.all([connector.health(), listGoogleSyncFolders()]);
    return jsonOk({ health, folders });
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors/google");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = z
      .object({
        action: z.enum(["add_folder", "remove_folder", "pause", "resume", "sync"]),
        folderId: z.string().optional(),
        id: z.string().uuid().optional(),
      })
      .parse(body);

    if (parsed.action === "add_folder") {
      if (!parsed.folderId) throw new Error("folderId is required");
      const folder = await resolveAndAddFolder({
        folderId: parsed.folderId,
        userId: user.id,
      });
      return jsonOk({ folder }, { status: 201 });
    }

    if (parsed.action === "remove_folder") {
      if (!parsed.id) throw new Error("id is required");
      await removeGoogleSyncFolder(parsed.id);
      return jsonOk({ deleted: true });
    }

    if (parsed.action === "pause" || parsed.action === "resume") {
      if (!parsed.id) throw new Error("id is required");
      const folder = await updateGoogleSyncFolder(parsed.id, {
        status: parsed.action === "pause" ? "paused" : "active",
      });
      return jsonOk({ folder });
    }

    if (parsed.action === "sync") {
      const folder = parsed.id ? await getGoogleSyncFolder(parsed.id) : null;
      // Prefer immediate sync for admin UX; also enqueue for cron reuse.
      const result = await getGoogleConnector().sync(
        folder ? { folderId: folder.folder_id } : undefined,
      );
      await enqueueJob({
        jobType: "google_knowledge_sync",
        metadata: folder ? { folderId: folder.folder_id } : {},
      });
      return jsonOk({ result });
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google");
  }
}
