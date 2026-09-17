import type { Metadata, Viewport } from "next";

/**
 * Receipts-scoped PWA metadata.
 * Manifest is linked only from this segment so desktop installs of the rest of
 * Baxter are not steered to /receipts.
 */
export const metadata: Metadata = {
  title: "Log Expense",
  description: "Log job receipts for Acton ADU — take a photo or enter manually.",
  applicationName: "Baxter Receipts",
  manifest: "/receipts/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Baxter Receipts",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "/icons/receipts-apple-touch.png", sizes: "180x180" }],
    icon: [
      { url: "/icons/receipts-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/receipts-512.png", sizes: "512x512", type: "image/png" },
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

export default function ReceiptsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
