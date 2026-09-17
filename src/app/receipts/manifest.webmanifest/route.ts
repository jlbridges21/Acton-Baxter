import { NextResponse } from "next/server";

/**
 * Scoped web app manifest for /receipts only.
 * Linked from receipts layout metadata — not site-wide — so installing from
 * this page launches standalone on /receipts without hijacking the rest of Baxter.
 *
 * No service worker / offline cache in this prompt (deliberate deferral).
 */
export function GET() {
  const manifest = {
    name: "Baxter Receipts",
    short_name: "Receipts",
    description: "Log Acton ADU job receipts from the field.",
    start_url: "/receipts",
    scope: "/receipts",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f7fa",
    theme_color: "#0b1f3a",
    icons: [
      {
        src: "/icons/receipts-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/receipts-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/receipts-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
