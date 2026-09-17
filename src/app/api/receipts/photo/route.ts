import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createReceiptPhotoSignedUrl, uploadReceiptPhoto } from "@/lib/receipts";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireActiveUser();
    const rate = checkRateLimit(`receipt-photo:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rate.allowed) throw new RateLimitError();

    const form = await request.formData();
    const file = form.get("file") ?? form.get("photo");
    if (!(file instanceof File)) {
      throw new ValidationError("Choose a receipt photo under the `file` field");
    }
    if (file.size <= 0) throw new ValidationError("Photo file is empty");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError("Photo is too large after processing (max 6MB)");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadReceiptPhoto({
      userId: user.id,
      buffer,
      mimeType: file.type || "image/jpeg",
      filename: file.name || "receipt.jpg",
    });

    const signedUrl = await createReceiptPhotoSignedUrl(uploaded.storagePath, 600);

    return jsonOk(
      {
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        signedUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error, "POST /api/receipts/photo");
  }
}
