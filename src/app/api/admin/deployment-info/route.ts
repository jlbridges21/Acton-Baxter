import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    await requireAdmin();
    return jsonOk({
      app: "Acton Property Research",
      packageName: "acton-property-research",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commitSha:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.NEXT_PUBLIC_GIT_SHA ??
        process.env.NEXT_PUBLIC_APP_VERSION ??
        null,
      commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      region: process.env.VERCEL_REGION ?? null,
      buildTimestamp: new Date().toISOString(),
      mockResearchEnabled: process.env.ENABLE_MOCK_RESEARCH === "true",
      starterPageExpected: false,
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/deployment-info");
  }
}
