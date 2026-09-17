import { NextResponse } from "next/server";
import { isAdminRole } from "@/lib/auth/roles";
import { requireActiveUser } from "@/lib/auth/session";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { createReceiptPhotoSignedUrl, getReceiptById } from "@/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Durable authenticated photo permalink for CSV export / admin viewing.
 * Checks admin auth, then redirects to a freshly signed private-bucket URL.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveUser();
    if (!isAdminRole(user.profile.role)) {
      throw new AuthorizationError("Admin access required");
    }

    const { id } = await context.params;
    const receipt = await getReceiptById(id);
    if (!receipt || receipt.deletedAt) {
      throw new ValidationError("Receipt not found");
    }
    if (!receipt.photoStoragePath) {
      throw new ValidationError("This receipt has no photo");
    }

    const signedUrl = await createReceiptPhotoSignedUrl(receipt.photoStoragePath, 120);
    if (!signedUrl) {
      throw new ValidationError("Could not open receipt photo");
    }

    return NextResponse.redirect(signedUrl, 302);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: 403 },
      );
    }
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: error.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: "PHOTO_FAILED", message: "Could not open receipt photo" } },
      { status: 500 },
    );
  }
}
