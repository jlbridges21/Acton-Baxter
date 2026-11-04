import { readLocalAsset } from "@/lib/configurator/asset-storage";
import { usesMemoryConfiguratorStore } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

/** Local/dev mode only: serve processed renderings from .configurator-local/assets. */
export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!usesMemoryConfiguratorStore()) return new Response(null, { status: 404 });
  const { path } = await context.params;
  const body = await readLocalAsset(path.join("/"));
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
