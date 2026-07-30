/**
 * Deterministic Baxter help / capability answers (no vector search required).
 * Scope matches the question: overview only for general_capabilities.
 */
import "server-only";

import { detectPemIntent, pemHelpDefinitionAnswer } from "@/lib/baxter-data/pem-neats/intent";
import { detectConceptQuestion } from "@/lib/baxter/concept-vocabulary";
import {
  classifyCapabilityQuestion,
  isGeneralCapabilitiesQuestion,
  type CapabilityQuestionClassification,
} from "@/lib/baxter/capability-intent";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";
import { isMonitoringCapabilityKnown } from "@/lib/baxter-ai/governance/capabilities";
import { parseGoogleWorkspaceUrl } from "@/lib/connectors/google/google-url";
import { isGoogleWorkspaceConfigured } from "@/lib/connectors/google/auth";
import { getDriveFile } from "@/lib/connectors/google/drive";
import { GoogleConnectorError } from "@/lib/connectors/google/errors";
import type { Profile } from "@/lib/research/db-types";
import {
  findCapabilityByTopic,
  getCapabilityRuntimeHealth,
  listCapabilitiesForRole,
  type BaxterCapability,
  type CapabilityRuntimeHealth,
} from "./capability-registry";

export type CapabilityHelpAnswer = {
  answer: string;
  links: Array<{ label: string; href: string }>;
};

/** True when the question is about Baxter/tools/navigation — not a live task lookup. */
export function detectCapabilityHelpIntent(question: string): boolean {
  const classified = classifyCapabilityQuestion(question);
  if (classified.kind === "implied_action" || classified.kind === "none") {
    // Definitions / how-tos still use capability help
    const concept = detectConceptQuestion(question);
    if (concept.kind === "how_to") return true;
    if (concept.kind === "definition") return true;
    if (pemHelpDefinitionAnswer(question)) return true;
    return false;
  }
  if (classified.kind === "resource_access_check") {
    // Handled by answerResourceAccessCheck (async) — not the sync overview path.
    return false;
  }
  // Named-system capability FAQs win over loose PEM "record_lookup" false positives
  // (e.g. "Do you have access to BuilderTrend?").
  if (classified.kind === "specific_capability" || classified.kind === "general_capabilities") {
    return true;
  }
  if (detectPemIntent(question).intent === "record_lookup") return false;
  return true;
}

/**
 * Whether answerBaxterQuestion should prefer Knowledge retrieval over the
 * deterministic capability short-circuit (definitions with a KB title).
 */
export function shouldPreferKnowledgeForConcept(question: string): boolean {
  const concept = detectConceptQuestion(question);
  if (concept.kind !== "definition" || concept.knowledgeSearchTerms.length === 0) return false;
  // Deterministic PEM/tool definitions short-circuit; don't force an empty KB → OpenAI path.
  if (pemHelpDefinitionAnswer(question)) return false;
  return true;
}

function linkFor(
  cap: BaxterCapability,
  role: string | null | undefined,
): Array<{ label: string; href: string }> {
  const isAdmin = role === "admin" || role === "super_admin";
  const links: Array<{ label: string; href: string }> = [];
  if (cap.createRoute) links.push({ label: `Create ${cap.name}`, href: cap.createRoute });
  if (cap.webRoute) links.push({ label: `Open ${cap.name}`, href: cap.webRoute });
  if (cap.adminRoute && isAdmin) links.push({ label: `Open ${cap.name}`, href: cap.adminRoute });
  return links;
}

function formatOverview(
  role: string | null | undefined,
  health: CapabilityRuntimeHealth,
): CapabilityHelpAnswer {
  const caps = listCapabilitiesForRole(role, health);
  const bullets: string[] = [];
  const pushIf = (key: string, line: string) => {
    if (caps.some((c) => c.key === key && (c.enabled || c.key === "gohighlevel")))
      bullets.push(line);
  };

  pushIf(
    "knowledge_center",
    "• Acton knowledge — procedures, policies, Google Workspace sources admins have made available, and uploaded files",
  );
  pushIf(
    "pem_neat",
    "• PEM NEATs — generate and review PEM sales intelligence, assessments, handoff fields, and answer questions about saved PEMs",
  );
  if (health.ghlConfigured && health.ghlEnabled) {
    bullets.push(
      "• CRM — look up GHL contacts and opportunities, and perform approved updates with confirmation where enabled",
    );
  } else {
    bullets.push(
      "• CRM — GoHighLevel can be connected by admins; it is not currently available for live lookups",
    );
  }
  pushIf(
    "property_research",
    "• Property Research — start new research or revisit previous reports",
  );
  if (caps.some((c) => c.key === "process_rulebook" && health.rulebookKnown)) {
    bullets.push("• Process support — answer questions from the Process Rulebook");
  }
  if (caps.some((c) => c.key === "process_monitoring" && c.enabled)) {
    bullets.push("• Process Monitoring — when enabled, surface pipeline health signals");
  }
  if (health.slackSearchEnabled) {
    bullets.push(
      "• Slack — search conversations Baxter is authorized to access; DM Baxter or @mention in allowed channels",
    );
  } else {
    bullets.push("• Slack — DM Baxter or @mention Baxter in allowed channels");
  }

  bullets.push(
    "• Writing and analysis — summarize, draft, explain, and reason through general work",
  );

  if (role === "admin" || role === "super_admin") {
    bullets.push(
      "• Admin tools — Knowledge Center, Integrations, Users, Settings, Governance, and Evaluations",
    );
  }

  const links: Array<{ label: string; href: string }> = [];
  const pem = caps.find((c) => c.key === "pem_neat");
  const property = caps.find((c) => c.key === "property_research");
  if (pem?.webRoute) links.push({ label: "Open PEM NEATs", href: pem.webRoute });
  if (property?.webRoute) links.push({ label: "Property Research", href: property.webRoute });
  if (
    (role === "admin" || role === "super_admin") &&
    caps.find((c) => c.key === "knowledge_center")?.adminRoute
  ) {
    links.push({
      label: "Knowledge Center",
      href: caps.find((c) => c.key === "knowledge_center")!.adminRoute!,
    });
  }

  return {
    answer: [
      "I can help with most of the systems already connected to Baxter:",
      "",
      ...bullets,
      "",
      "A couple of limits: I don't have a direct BuilderTrend API connection (I can prepare PEM handoff fields for copy/paste), and I won't make CRM changes without the confirmation flow.",
      "You can use me here or in Slack.",
    ].join("\n"),
    links,
  };
}

function answerSpecificCapability(
  question: string,
  classified: CapabilityQuestionClassification,
  role: string | null | undefined,
  profile: Profile | null,
  health: CapabilityRuntimeHealth,
): CapabilityHelpAnswer | null {
  const q = question.toLowerCase();
  const topic = classified.topic;

  if (topic === "buildertrend" || /\bbuildertrend\b/.test(q)) {
    return {
      answer:
        "No. Baxter does not currently have a direct BuilderTrend API connection. I can prepare BuilderTrend handoff fields from a PEM NEAT for copy/paste.",
      links: [{ label: "Open PEM NEATs", href: "/pem-neats" }],
    };
  }

  if (topic === "slack" || /\bslack\b/.test(q)) {
    if (health.slackSearchEnabled) {
      return {
        answer:
          "Yes. I can search Slack conversations Baxter is authorized to access, including live channel history when permissions allow.",
        links: [{ label: "Slack integrations", href: "/settings/integrations" }],
      };
    }
    return {
      answer:
        "I can answer in Slack DMs and @mentions. Live Slack Search needs to be enabled/connected under Settings → Integrations for channel history recall.",
      links: [{ label: "Integrations", href: "/settings/integrations" }],
    };
  }

  if (topic === "pem_neat" || /\b(pem|neat)\b/.test(q)) {
    if (/\b(generate|create|make|start|run)\b/.test(q)) {
      return {
        answer:
          "Yes. I can generate a PEM NEAT from a meeting transcript. Open PEM NEATs to create one, or use /pem in Slack for a quick handoff to the web form.",
        links: [
          { label: "Open PEM NEATs", href: "/pem-neats" },
          { label: "Create PEM NEAT", href: "/pem-neats/new" },
        ],
      };
    }
    return {
      answer:
        "Yes. I can help with PEM NEATs — generate them, answer questions about saved PEMs, and prepare BuilderTrend handoff fields.",
      links: [
        { label: "Open PEM NEATs", href: "/pem-neats" },
        { label: "Create PEM NEAT", href: "/pem-neats/new" },
      ],
    };
  }

  if (
    (topic === "ghl" || /\b(gohighlevel|ghl|crm)\b/.test(q)) &&
    /\b(update|change|move|write)\b/.test(q)
  ) {
    if (!health.ghlConfigured || !health.ghlEnabled) {
      return {
        answer:
          "GoHighLevel isn't currently connected, so I can't look up or update CRM records right now. An admin can connect it under Integrations.",
        links:
          role === "admin" || role === "super_admin"
            ? [{ label: "Integrations", href: "/admin/connectors" }]
            : [],
      };
    }
    const write = canUserWriteGhl(profile);
    if (write.canWrite) {
      return {
        answer:
          "Yes. I can propose supported GoHighLevel updates and I'll ask you to confirm before anything is changed.",
        links: [],
      };
    }
    return {
      answer:
        write.reason || "I can look it up, but your role isn't allowed to perform GHL writes.",
      links: [],
    };
  }

  if (topic === "ghl" || /\b(gohighlevel|ghl|crm)\b/.test(q)) {
    if (!health.ghlConfigured || !health.ghlEnabled) {
      return {
        answer:
          "GoHighLevel isn't currently connected, so I can't look up CRM contacts or opportunities right now.",
        links:
          role === "admin" || role === "super_admin"
            ? [{ label: "Integrations", href: "/admin/connectors" }]
            : [],
      };
    }
    return {
      answer:
        "Yes. I can search GoHighLevel contacts and opportunities when the CRM connector is connected.",
      links: [],
    };
  }

  if (
    topic === "google" ||
    /\bgoogle (drive|docs|workspace|sheets)\b/.test(q) ||
    /\bread google\b/.test(q)
  ) {
    if (health.googleConfigured) {
      return {
        answer:
          "Yes. I can access Google Workspace documents that Baxter’s connected Google account has permission to view. For Knowledge answers, admins also select files/folders in the Knowledge Center.",
        links:
          role === "admin" || role === "super_admin"
            ? [{ label: "Knowledge Center", href: "/admin/knowledge" }]
            : [],
      };
    }
    return {
      answer:
        "Google Workspace integration exists but is currently disconnected or not configured. An admin can connect it under Integrations.",
      links:
        role === "admin" || role === "super_admin"
          ? [{ label: "Integrations", href: "/admin/connectors" }]
          : [],
    };
  }

  if (topic === "property_research" || /\b(research a property|property research)\b/.test(q)) {
    return {
      answer: "Yes. Open Property Research to start a new report or revisit previous ones.",
      links: [
        { label: "Property Research", href: "/dashboard" },
        { label: "New Property Research", href: "/reports/new" },
      ],
    };
  }

  if (/\bdomo\b/.test(q)) {
    return {
      answer: "No. Baxter does not currently have a Domo connector.",
      links: [],
    };
  }

  if (/\bclear (this )?chat\b|\bnew chat\b|\/clear\b/.test(q)) {
    return {
      answer:
        "Use **/clear** (or **New chat** on the web) to start a fresh conversation. That resets conversation context so prior prospects aren't carried forward.",
      links: [],
    };
  }

  if (/\b(add knowledge|knowledge center|uploaded files|upload)\b/.test(q)) {
    if (role === "admin" || role === "super_admin") {
      return {
        answer:
          "Admins add and approve knowledge in the Knowledge Center, including uploads and Google Workspace sources.",
        links: [{ label: "Knowledge Center", href: "/admin/knowledge" }],
      };
    }
    return {
      answer:
        "Approved Acton knowledge lives in Baxter's Knowledge Center. Ask an admin if you need something uploaded or connected from Google Workspace.",
      links: [],
    };
  }

  if (/\bconnect google\b|\bgoogle drive\b/.test(q) && /\b(how|where|connect)\b/.test(q)) {
    if (role === "admin" || role === "super_admin") {
      return {
        answer: health.googleConfigured
          ? "Google Workspace is connected. Manage folders/sources under Integrations and the Knowledge Center."
          : "Connect Google Workspace under Integrations, then select folders/files for the Knowledge Center.",
        links: [
          { label: "Integrations", href: "/admin/connectors" },
          { label: "Knowledge Center", href: "/admin/knowledge" },
        ],
      };
    }
    return {
      answer:
        "An admin connects Google Workspace under Integrations. Once files are selected for the Knowledge Center, I can use them in answers.",
      links: [],
    };
  }

  const topicCap = findCapabilityByTopic(question, role);
  if (topicCap) {
    const links = linkFor(topicCap, role);
    const limit = topicCap.limitations[0] ? ` ${topicCap.limitations[0]}` : "";
    return {
      answer: `${topicCap.shortDescription}${limit}`.trim(),
      links,
    };
  }

  return null;
}

function resourceLabel(resourceType: string | null): string {
  switch (resourceType) {
    case "document":
      return "Google Doc";
    case "spreadsheet":
      return "Google Sheet";
    case "presentation":
      return "Google Slides deck";
    case "folder":
      return "Google Drive folder";
    default:
      return "Google Drive file";
  }
}

/**
 * Attempt a live access check for a specific resource (Google URL, etc.).
 * Returns null when the question is not a resource access check.
 */
export async function answerResourceAccessCheck(input: {
  question: string;
  role?: string | null;
  /** Optional inject for tests. */
  getDriveFileFn?: typeof getDriveFile;
  isGoogleConfiguredFn?: () => boolean;
}): Promise<CapabilityHelpAnswer | null> {
  const classified = classifyCapabilityQuestion(input.question);
  if (classified.kind !== "resource_access_check") return null;

  const role = input.role ?? null;

  if (classified.googleUrl) {
    const parsed = parseGoogleWorkspaceUrl(classified.googleUrl);
    const label = resourceLabel(parsed.resourceType);
    const configured = (input.isGoogleConfiguredFn ?? isGoogleWorkspaceConfigured)();
    if (!configured) {
      return {
        answer:
          "I couldn’t verify access because Baxter’s Google Workspace connection is currently unavailable. An admin can reconnect it under Integrations.",
        links:
          role === "admin" || role === "super_admin"
            ? [{ label: "Integrations", href: "/admin/connectors" }]
            : [],
      };
    }
    if (!parsed.fileId && !parsed.folderId) {
      return {
        answer: `I couldn’t parse a Google file ID from that link, so I can’t check access yet.`,
        links: [],
      };
    }
    const fileId = parsed.fileId ?? parsed.folderId!;
    const fetchFile = input.getDriveFileFn ?? getDriveFile;
    try {
      const file = await fetchFile(fileId);
      const title = file.name?.trim() || "Untitled";
      const openHref = file.webViewLink || classified.googleUrl;
      return {
        answer: `Yes. I can access that ${label}. It’s titled “${title}”.`,
        links: openHref ? [{ label: title, href: openHref }] : [],
      };
    } catch (error) {
      const code =
        error instanceof GoogleConnectorError
          ? error.code
          : error instanceof Error && "code" in error
            ? String((error as { code?: string }).code ?? "")
            : "";
      const status =
        error instanceof GoogleConnectorError
          ? error.statusCode
          : error instanceof Error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : null;

      if (
        code === "BAXTER_GOOGLE_PERMISSION_DENIED" ||
        code === "BAXTER_GOOGLE_SHARED_DRIVE_ACCESS_DENIED" ||
        status === 403
      ) {
        return {
          answer: `No. I can’t access that ${label} with Baxter’s current Google Workspace permissions.`,
          links: [],
        };
      }
      if (code === "BAXTER_GOOGLE_FOLDER_NOT_FOUND" || status === 404) {
        return {
          answer: `I couldn’t find or access that ${label} from the connected Google Workspace account.`,
          links: [],
        };
      }
      if (
        code === "BAXTER_GOOGLE_AUTH_FAILED" ||
        code === "BAXTER_GOOGLE_NOT_CONFIGURED" ||
        status === 401
      ) {
        return {
          answer:
            "I couldn’t verify access because Baxter’s Google Workspace connection is currently unavailable.",
          links:
            role === "admin" || role === "super_admin"
              ? [{ label: "Integrations", href: "/admin/connectors" }]
              : [],
        };
      }
      return {
        answer: `I couldn’t verify access to that ${label} right now (${code || "google_error"}).`,
        links: [],
      };
    }
  }

  if (classified.slackChannel) {
    const health = getCapabilityRuntimeHealth({
      monitoringKnown: isMonitoringCapabilityKnown(),
    });
    const channel = `#${classified.slackChannel.replace(/^#/, "")}`;
    if (!health.slackSearchEnabled) {
      return {
        answer: `I can try to read ${channel} once Slack Search is connected. Enable it under Settings → Integrations, then ask me something concrete from that channel.`,
        links: [{ label: "Integrations", href: "/settings/integrations" }],
      };
    }
    return {
      answer: `I can attempt to read ${channel} when Baxter is a member and your Slack authorization allows it. Ask me a specific question about that channel (for example, the latest update or what someone said) and I’ll retrieve it.`,
      links: [],
    };
  }

  return null;
}

/**
 * Build a deterministic capability/help answer when appropriate.
 * Returns null when the question should use the normal retrieval pipeline.
 * Does NOT dump the full overview for narrow “can you / access” questions.
 */
export function answerCapabilityHelp(input: {
  question: string;
  role?: string | null;
  profile?: Profile | null;
}): CapabilityHelpAnswer | null {
  const question = input.question.trim();
  const classified = classifyCapabilityQuestion(question);

  if (classified.kind === "implied_action" || classified.kind === "resource_access_check") {
    return null;
  }

  // Concept definitions / how-tos still allowed even if classifier says none
  const pemDef = pemHelpDefinitionAnswer(question);
  const concept = detectConceptQuestion(question);
  if (classified.kind === "none") {
    if (!pemDef && concept.kind !== "definition" && concept.kind !== "how_to") {
      return null;
    }
  } else if (!detectCapabilityHelpIntent(question) && !pemDef) {
    return null;
  }

  const role = input.role ?? null;
  const health = getCapabilityRuntimeHealth({
    monitoringKnown: isMonitoringCapabilityKnown(),
  });

  if (pemDef) {
    return {
      answer: pemDef,
      links: [
        { label: "Open PEM NEATs", href: "/pem-neats" },
        { label: "Create PEM NEAT", href: "/pem-neats/new" },
      ],
    };
  }

  if (classified.kind === "general_capabilities" || isGeneralCapabilitiesQuestion(question)) {
    return formatOverview(role, health);
  }

  if (/\bwho (are|is) (you|baxter)|what (are|is) (you|baxter)\b/i.test(question)) {
    return {
      answer:
        "I'm Baxter, Acton ADU's internal AI teammate. I help employees find approved knowledge, work with PEM NEATs, look up connected systems like GoHighLevel when available, run Property Research, and answer Process Rulebook questions — here and in Slack.",
      links: [],
    };
  }

  const specific = answerSpecificCapability(
    question,
    classified,
    role,
    input.profile ?? null,
    health,
  );
  if (specific) return specific;

  if (concept.kind === "how_to") {
    const topic = findCapabilityByTopic(question, role);
    if (topic) {
      return {
        answer: topic.detailedDescription,
        links: linkFor(topic, role),
      };
    }
  }

  // Narrow questions must never fall through to the full overview.
  if (classified.kind === "specific_capability") {
    return {
      answer:
        "I can help with that if it’s one of Baxter’s connected systems. Ask about a specific tool (Slack, GHL, PEM NEATs, Knowledge, Property Research), or ask “what can you do?” for the full overview.",
      links: [],
    };
  }

  return null;
}

/** Compact capability list for system prompts (identity / capability questions only). */
export function buildCapabilityPromptBlock(role?: string | null): string {
  const health = getCapabilityRuntimeHealth({
    monitoringKnown: isMonitoringCapabilityKnown(),
  });
  const caps = listCapabilitiesForRole(role, health);
  return [
    "Current Baxter capabilities (authoritative; do not invent tools):",
    ...caps.map((c) => {
      const status =
        c.status === "disconnected"
          ? "disconnected"
          : c.status === "connected"
            ? "connected"
            : c.enabled
              ? "available"
              : "unavailable";
      const route = c.webRoute || c.createRoute || (c.adminRoute ?? "");
      return `- ${c.name} [${status}]${route ? ` → ${route}` : ""}: ${c.shortDescription}`;
    }),
    "Hard limits:",
    "- No direct BuilderTrend API — PEM BuilderTrend fields are copy/paste handoff only",
    "- No autonomous CRM writes — confirmation required when writes are enabled",
    "- Google access is limited to Knowledge Center–connected sources unless Baxter’s Google account can open a specific shared file",
    "Response scope: answer only the capability or access check asked — do not dump the full capability list unless the user asked what Baxter can do overall.",
  ].join("\n");
}
