import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { brandingUpdateSchema } from "@/lib/branding/schemas";
import { updateBrandingSettings } from "@/lib/branding/update-branding";

export async function GET() {
  try {
    await requireAdmin();
    const branding = await getBrandingWithLogo();
    return jsonOk({ branding });
  } catch (error) {
    return jsonError(error, "GET /api/admin/branding");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = brandingUpdateSchema.parse(body);
    const branding = await updateBrandingSettings({
      ...parsed,
      updatedBy: user.id,
    });
    const withLogo = await getBrandingWithLogo();
    return jsonOk({ branding: { ...branding, logoUrl: withLogo.logoUrl } });
  } catch (error) {
    return jsonError(error, "PUT /api/admin/branding");
  }
}
