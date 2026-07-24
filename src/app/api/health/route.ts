import { NextResponse } from "next/server";

/**
 * Public, secret-free deployment identity check.
 * Use this to confirm Vercel is serving Baxter rather than the Create Next App starter.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "Baxter",
    packageName: "baxter",
    tools: ["property-research"],
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    commitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_GIT_SHA ??
      process.env.NEXT_PUBLIC_APP_VERSION ??
      null,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    buildTimestamp: process.env.VERCEL_DEPLOYMENT_ID
      ? new Date().toISOString()
      : new Date().toISOString(),
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    starterPageExpected: false,
  });
}
