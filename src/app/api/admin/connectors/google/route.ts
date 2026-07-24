import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getGoogleConnector, resolveAndAddFolder } from "@/lib/connectors/google";
import {
  removeGoogleSyncFolder,
  updateGoogleSyncFolder,
  getGoogleSyncFolder,
} from "@/lib/connectors/google";
import {
  dryRunGoogleSync,
  getGoogleAdminOverview,
  listGoogleSampleFiles,
  testGoogleAuthentication,
  testGoogleRootFolder,
  testGoogleSourceThroughBaxter,
} from "@/lib/connectors/google/diagnostics";

export async function GET() {
  try {
    await requireAdmin();
    const overview = await getGoogleAdminOverview();
    return jsonOk(overview);
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
        action: z.enum([
          "add_folder",
          "remove_folder",
          "pause",
          "resume",
          "sync",
          "test_auth",
          "test_root_folder",
          "list_sample_files",
          "dry_run_sync",
          "test_google_through_baxter",
        ]),
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
      const result = await getGoogleConnector().sync(
        folder ? { folderId: folder.folder_id } : undefined,
      );
      return jsonOk({ result });
    }

    if (parsed.action === "test_auth") {
      return jsonOk({ result: await testGoogleAuthentication() });
    }
    if (parsed.action === "test_root_folder") {
      return jsonOk({ result: await testGoogleRootFolder() });
    }
    if (parsed.action === "list_sample_files") {
      return jsonOk({ result: await listGoogleSampleFiles() });
    }
    if (parsed.action === "dry_run_sync") {
      return jsonOk({ result: await dryRunGoogleSync() });
    }
    return jsonOk({ result: await testGoogleSourceThroughBaxter(user.id) });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/google");
  }
}
