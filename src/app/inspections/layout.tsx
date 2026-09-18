import type { Metadata, Viewport } from "next";

/**
 * Inspections-scoped PWA metadata.
 * Manifest is linked only from this segment so desktop installs of the rest of
 * Baxter are not steered to /inspections.
 *
 * iOS home-screen installs get a separate cookie jar from Safari — users sign in
 * once inside the standalone app; the session persists across launches (same as
 * /receipts).
 */
export const metadata: Metadata = {
  title: "Site Inspections",
  description: "Field site inspection checklists for Acton ADU.",
  applicationName: "Baxter Site Inspections",
  manifest: "/inspections/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Baxter Inspections",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "/icons/inspections-apple-touch.png", sizes: "180x180" }],
    icon: [
      { url: "/icons/inspections-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/inspections-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1f3a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function InspectionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
