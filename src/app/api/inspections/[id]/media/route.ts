/**
 * Legacy FormData upload removed — clients must use prepare → direct storage → complete.
 * Kept as a clear 410 so old clients fail loudly instead of silently buffering through Vercel.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        message:
          "Direct FormData upload is retired. Use /media/prepare, upload to storage, then /media/complete.",
      },
    },
    { status: 410 },
  );
}
