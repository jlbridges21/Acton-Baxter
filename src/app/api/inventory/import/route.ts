import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { parseBuildComPdf } from "@/lib/inventory/import-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireActiveUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose a build.com order PDF");
    if (file.size > 25_000_000) throw new ValidationError("That PDF is larger than 25 MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseBuildComPdf(buffer);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "POST /api/inventory/import");
  }
}
