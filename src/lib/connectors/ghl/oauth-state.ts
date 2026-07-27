import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { GhlConnectorError } from "./errors";

const STATE_TTL_MS = 15 * 60 * 1000;
const SAFE_RETURN = "/admin/connectors/ghl";

type GhlOAuthStateRow = {
  id: string;
  state: string;
  admin_user_id: string;
  return_path: string;
  expires_at: string;
  consumed_at: string | null;
};

function sanitizeReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return SAFE_RETURN;
  if (!raw.startsWith("/admin/")) return SAFE_RETURN;
  if (raw.includes("://") || raw.includes("//") || raw.includes("\\")) return SAFE_RETURN;
  return raw.slice(0, 200);
}

export async function createGhlOAuthState(input: {
  adminUserId: string;
  returnPath?: string | null;
}): Promise<{ state: string; expiresAt: string }> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const supabase = createServiceClient();

  const { error } = await supabase.from("ghl_oauth_states").insert({
    state,
    admin_user_id: input.adminUserId,
    return_path: sanitizeReturnPath(input.returnPath),
    expires_at: expiresAt,
  });

  if (error) {
    throw new GhlConnectorError(`Could not store GHL OAuth state: ${error.message}`, {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 500,
      expose: true,
    });
  }

  return { state, expiresAt };
}

export async function consumeGhlOAuthState(input: {
  state: string;
  adminUserId: string;
}): Promise<{ returnPath: string }> {
  if (!input.state?.trim()) {
    throw new GhlConnectorError("Missing GHL OAuth state.", {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 400,
      expose: true,
    });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_oauth_states")
    .select("*")
    .eq("state", input.state)
    .maybeSingle();

  if (error || !data) {
    throw new GhlConnectorError("Invalid or unknown GHL OAuth state.", {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 400,
      expose: true,
    });
  }

  const row = data as GhlOAuthStateRow;

  if (row.consumed_at) {
    throw new GhlConnectorError("GHL OAuth state was already used.", {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 400,
      expose: true,
    });
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new GhlConnectorError("GHL OAuth state expired. Start Connect GoHighLevel again.", {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 400,
      expose: true,
    });
  }

  if (row.admin_user_id !== input.adminUserId) {
    throw new GhlConnectorError("GHL OAuth state does not match the signed-in admin.", {
      code: "BAXTER_GHL_AUTH_FAILED",
      statusCode: 403,
      expose: true,
    });
  }

  const { error: updateError } = await supabase
    .from("ghl_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null);

  if (updateError) {
    throw new GhlConnectorError("Could not consume GHL OAuth state.", {
      code: "BAXTER_GHL_BAD_REQUEST",
      statusCode: 500,
      expose: true,
    });
  }

  return { returnPath: sanitizeReturnPath(row.return_path) };
}

export async function cleanupExpiredGhlOAuthStates(): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ghl_oauth_states")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
