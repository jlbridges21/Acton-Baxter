import type { NextConfig } from "next";
import { securityHeaderRules } from "./src/lib/http/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep PDF extraction / zip export on the Node serverless path.
  serverExternalPackages: ["unpdf", "archiver", "ffmpeg-static"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    // Embed is a separate rule: no X-Frame-Options, frame-ancestors *.
    // A second CSP on the same path would be ANDed and block framing.
    return securityHeaderRules();
  },
};

export default nextConfig;
