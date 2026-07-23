import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { removeBrandingLogo, uploadBrandingLogo } from "@/lib/branding/update-branding";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const form = await request.formData();
    const file = form.get("file") ?? form.get("logo");
    if (!(file instanceof File)) {
      throw new ValidationError("Upload a logo file under the `file` field");
    }

    const branding = await uploadBrandingLogo({
      file,
      fileName: file.name || "logo",
      contentType: file.type || "application/octet-stream",
      updatedBy: user.id,
    });
    const withLogo = await getBrandingWithLogo();
    return jsonOk({ branding: { ...branding, logoUrl: withLogo.logoUrl } }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/branding/logo");
  }
}

export async function DELETE() {
  try {
    const user = await requireAdmin();
    const branding = await removeBrandingLogo(user.id);
    return jsonOk({ branding: { ...branding, logoUrl: null } });
  } catch (error) {
    return jsonError(error, "DELETE /api/admin/branding/logo");
  }
}
