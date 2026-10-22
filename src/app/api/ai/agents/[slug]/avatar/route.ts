import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { createServiceClient } from "@/lib/supabase/admin";
import { setAgentAvatar } from "@/lib/agents/admin";
import { BAXTER_AVATAR_PATH, BAXTER_SLUG } from "@/lib/agents/defaults";
import { actorOf, requireAgentAccess, requireAiContext } from "@/lib/agents/http";
import { usesAgentMemoryStore } from "@/lib/agents/store";
import { sniffImageType } from "@/lib/agents/avatar";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const AVATAR_BUCKET = "ai-agent-avatars";
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose an image to upload.");
    if (file.size > MAX_BYTES) throw new ValidationError("Portraits must be 2 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) throw new ValidationError("Upload a PNG, JPEG, or WebP image.");

    let url: string;
    let storagePath: string | null = null;
    if (usesAgentMemoryStore()) {
      url = `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
    } else {
      const supabase = createServiceClient();
      storagePath = `${agent.row.id}/${Date.now()}.${type === "jpeg" ? "jpg" : type}`;
      const { error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(storagePath, bytes, { contentType: `image/${type}`, upsert: false });
      if (error) throw new Error(`Could not store the portrait: ${error.message}`);
      url = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath).data.publicUrl;
      if (agent.row.avatar_storage_path) {
        await supabase.storage.from(AVATAR_BUCKET).remove([agent.row.avatar_storage_path]);
      }
    }
    await setAgentAvatar(agent.row.id, { url, storagePath }, actorOf(ctx));
    return jsonOk({ avatarUrl: url });
  } catch (error) {
    return jsonError(error, "POST /api/ai/agents/[slug]/avatar");
  }
}

/** Reset to the default portrait (Baxter's bundled image, or the initials fallback). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireAiContext();
    const { slug } = await params;
    const agent = await requireAgentAccess(ctx, slug, "manage");
    if (agent.row.avatar_storage_path && !usesAgentMemoryStore()) {
      await createServiceClient()
        .storage.from(AVATAR_BUCKET)
        .remove([agent.row.avatar_storage_path]);
    }
    const url = agent.row.slug === BAXTER_SLUG ? BAXTER_AVATAR_PATH : null;
    await setAgentAvatar(agent.row.id, { url, storagePath: null }, actorOf(ctx));
    return jsonOk({ avatarUrl: url });
  } catch (error) {
    return jsonError(error, "DELETE /api/ai/agents/[slug]/avatar");
  }
}
