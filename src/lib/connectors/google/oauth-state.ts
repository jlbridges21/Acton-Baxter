import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { GoogleConnectorError } from "./errors";

const STATE_TTL_MS = 15 * 60 * 1000;
const SAFE_RETURN = "/admin/connectors/google";

type OauthStateRow = {
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

export async function createGoogleOAuthState(input: {
  adminUserId: string;
  returnPath?: string | null;
}): Promise<{ state: string; expiresAt: string }> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const supabase = createServiceClient();
  const { error } = await supabase.from("google_oauth_states").insert({
    state,
    admin_user_id: input.adminUserId,
    return_path: sanitizeReturnPath(input.returnPath),
    expires_at: expiresAt,
  });
  if (error) {
    throw new GoogleConnectorError(`Could not store OAuth state: ${error.message}`, {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 500,
      expose: true,
    });
  }
  return { state, expiresAt };
}

export async function consumeGoogleOAuthState(input: {
  state: string;
  adminUserId: string;
}): Promise<{ returnPath: string }> {
  if (!input.state?.trim()) {
    throw new GoogleConnectorError("Missing OAuth state.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 400,
      expose: true,
    });
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_oauth_states")
    .select("*")
    .eq("state", input.state)
    .maybeSingle();

  if (error || !data) {
    throw new GoogleConnectorError("Invalid or unknown OAuth state.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 400,
      expose: true,
    });
  }

  const row = data as OauthStateRow;
  if (row.consumed_at) {
    throw new GoogleConnectorError("OAuth state was already used.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 400,
      expose: true,
    });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new GoogleConnectorError("OAuth state expired. Start Connect Google Workspace again.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 400,
      expose: true,
    });
  }
  if (row.admin_user_id !== input.adminUserId) {
    throw new GoogleConnectorError("OAuth state does not match the signed-in admin.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 403,
      expose: true,
    });
  }

  const { error: updateError } = await supabase
    .from("google_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null);

  if (updateError) {
    throw new GoogleConnectorError("Could not consume OAuth state.", {
      code: "BAXTER_GOOGLE_OAUTH_STATE_INVALID",
      statusCode: 500,
      expose: true,
    });
  }

  return { returnPath: sanitizeReturnPath(row.return_path) };
}
