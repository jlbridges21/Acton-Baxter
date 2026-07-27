import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { disconnectGhlConnection } from "@/lib/connectors/ghl/connections";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const confirm = body.confirm === true;

    if (!confirm) {
      return jsonOk(
        {
          error: {
            code: "BAXTER_GHL_BAD_REQUEST",
            message: "Confirmation required to disconnect GoHighLevel.",
          },
        },
        { status: 400 },
      );
    }

    await disconnectGhlConnection({ adminUserId: user.id });

    return jsonOk({
      success: true,
      message: "GoHighLevel disconnected successfully.",
    });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/ghl/disconnect");
  }
}
