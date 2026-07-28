import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep PDF extraction on the Node serverless path (unpdf serverless PDF.js build).
  serverExternalPackages: ["unpdf"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.supabase.co https://maps.gstatic.com https://maps.googleapis.com https://*.googleusercontent.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://places.googleapis.com",
              // PDF viewer: same-origin stream for uploads; Drive preview for Google PDFs.
              "frame-src 'self' https://drive.google.com https://*.google.com",
              "object-src 'self'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      // Knowledge PDF stream stays frameable by Baxter (global X-Frame-Options: SAMEORIGIN).
      // Do not attach a second CSP here — browsers AND multiple CSP headers.
    ];
  },
};

export default nextConfig;
