import "server-only";

import { evaluateGhlHealth } from "@/lib/connectors/ghl/health";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import type { MonitoringCheck } from "./types";
import type { FindingCandidate, MonitoringContext } from "../types";

/**
 * Check GHL feed health.
 */
export const feedHealthCheck: MonitoringCheck = {
  key: "feed-health",
  description: "Verify GHL connector health and core CRM capabilities",

  async run(_ctx: MonitoringContext): Promise<FindingCandidate[]> {
    const candidates: FindingCandidate[] = [];

    if (!isGhlConfigured()) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:ghl:not_configured",
        severity: "critical",
        entityType: "feed",
        title: "GHL not configured",
        evidence: {
          reason: "GHL integration is not configured",
        },
        recommendation: "Configure GoHighLevel PIT credentials in environment settings.",
      });
      return candidates;
    }

    const health = await evaluateGhlHealth().catch((_error) => null);

    if (!health) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:ghl:check_failed",
        severity: "critical",
        entityType: "feed",
        title: "GHL health check failed",
        evidence: { reason: "evaluateGhlHealth threw or returned nothing" },
        recommendation: "Review GHL connector logs and credentials.",
      });
      return candidates;
    }

    const unhealthy =
      health.overall === "offline" ||
      health.overall === "disabled" ||
      health.overall === "not_configured" ||
      health.overall === "reauthorization_required";

    if (unhealthy) {
      candidates.push({
        checkKey: "feed-health",
        dedupeKey: "feed_health:ghl:unhealthy",
        severity: "critical",
        entityType: "feed",
        title: "GHL feed unhealthy",
        evidence: {
          overall: health.overall,
          details: health.details,
          failedChecks: health.checks.filter((c) => !c.ok).map((c) => c.check),
        },
        recommendation:
          "Check GHL token validity and API access. Review Advanced diagnostics on the GHL connector page.",
      });
    }

    return candidates;
  },
};
