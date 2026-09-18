import { NextResponse } from "next/server";

/**
 * Scoped web app manifest for /inspections only.
 * Linked from inspections layout metadata — installing from this page launches
 * standalone on /inspections without hijacking the rest of Baxter.
 *
 * iOS standalone uses a separate cookie jar from Safari; one login inside the
 * installed app persists for subsequent launches (same pattern as Receipts).
 */
export function GET() {
  const manifest = {
    name: "Baxter Site Inspections",
    short_name: "Inspections",
    description: "Field site inspection checklists for Acton ADU.",
    start_url: "/inspections",
    scope: "/inspections",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f7fa",
    theme_color: "#0b1f3a",
    icons: [
      {
        src: "/icons/inspections-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/inspections-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/inspections-512.png",
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
