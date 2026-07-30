/**
 * Deterministic Baxter help / capability answers (no vector search required).
 */
import "server-only";

import { detectPemIntent, pemHelpDefinitionAnswer } from "@/lib/baxter-data/pem-neats/intent";
import { detectConceptQuestion } from "@/lib/baxter/concept-vocabulary";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";
import { isMonitoringCapabilityKnown } from "@/lib/baxter-ai/governance/capabilities";
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

function isCapabilityOrHelpQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) return false;
  const concept = detectConceptQuestion(question);
  if (concept.kind === "how_to" || concept.kind === "capability_overview") return true;
  // Definitions may use Knowledge first — still allow capability help as fallback.
  if (pemHelpDefinitionAnswer(question)) return true;
  if (concept.kind === "definition") return true;
  if (
    /\b(what can you (do|help)|what (all )?can (baxter|you) help|what tools|how do you (work|help)|who (are|is) (you|baxter)|what (are|is) (you|baxter))\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(can you|are you able to|do you (support|have access))\b/i.test(q) &&
    /\b(buildertrend|gohighlevel|ghl|google|domo|crm|property research|update|read|access)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(where (do i|can i|are)|how (do i|to))\b/i.test(q) &&
    /\b(pem|neat|knowledge|google|drive|property|report|ghl|crm|clear|chat|connect|generate|create|settings|users|integrations|rulebook|monitoring|transcript|buildertrend|handoff|slack)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(clear (this )?chat|new chat)\b/i.test(q)) return true;
  if (
    /\bwhat is (a |an )?(pem|neat|palo|type\s*[12]|slack recall|property research|process monitoring|rulebook|ghl|knowledge)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

/** True when the question is about Baxter/tools/navigation — not a live task lookup. */
export function detectCapabilityHelpIntent(question: string): boolean {
  if (!isCapabilityOrHelpQuestion(question)) return false;
  // Prospect-specific PEM lookups are handled by the PEM evidence provider.
  if (detectPemIntent(question).intent === "record_lookup") return false;
  const concept = detectConceptQuestion(question);
  if (concept.isConcept) return true;
  // "Can you tell me Lori's stage?" is CRM work, not capability help.
  if (
    /\bcan you (tell|show|look|find|get|check|move|update)\b/i.test(question) &&
    /\b(lori|wong|contact|opportunity|stage|appointment|budget|pain|pem)\b/i.test(question) &&
    !/\bbuildertrend\b/i.test(question) &&
    !/\bwhat can you\b/i.test(question)
  ) {
    // Still allow honest "can you update BuilderTrend/GHL/Google?" capability questions.
    if (/\b(buildertrend|gohighlevel|ghl|google (drive|docs|workspace)|domo)\b/i.test(question)) {
      return true;
    }
    if (
      /\b(update|move|change|write)\b/i.test(question) &&
      /\b(ghl|gohighlevel|crm|opportunity)\b/i.test(question)
    ) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Whether answerBaxterQuestion should prefer Knowledge retrieval over the
 * deterministic capability short-circuit (definitions with a KB title).
 */
export function shouldPreferKnowledgeForConcept(question: string): boolean {
  const concept = detectConceptQuestion(question);
  return concept.kind === "definition" && concept.knowledgeSearchTerms.length > 0;
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
  bullets.push(
    "• Writing and analysis — summarize, draft, explain, and reason through general work",
  );
  bullets.push("• Slack — DM Baxter or @mention Baxter in allowed channels");

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

function answerCanYou(
  question: string,
  role: string | null | undefined,
  profile: Profile | null,
  health: CapabilityRuntimeHealth,
): CapabilityHelpAnswer | null {
  const q = question.toLowerCase();

  if (/\bbuildertrend\b/.test(q)) {
    return {
      answer:
        "I can prepare the BuilderTrend Custom Fields from a PEM NEAT for copy/paste, but Baxter is not directly connected to BuilderTrend.",
      links: [{ label: "Open PEM NEATs", href: "/pem-neats" }],
    };
  }

  if (
    /\b(gohighlevel|ghl|crm opportunity|opportunity)\b/.test(q) &&
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

  if (/\bgoogle (drive|docs|workspace|sheets)\b/.test(q) || /\bread google\b/.test(q)) {
    if (health.googleConfigured) {
      return {
        answer:
          "Yes — I can use Google Workspace files that admins have added to Baxter's Knowledge Center. I don't freely search every Acton Drive file unless it's been made available through that connector.",
        links:
          role === "admin" || role === "super_admin"
            ? [{ label: "Knowledge Center", href: "/admin/knowledge" }]
            : [],
      };
    }
    return {
      answer:
        "Google Workspace integration exists but is currently disconnected or not configured. An admin can connect it under Integrations, then select files/folders for the Knowledge Center.",
      links:
        role === "admin" || role === "super_admin"
          ? [{ label: "Integrations", href: "/admin/connectors" }]
          : [],
    };
  }

  if (/\b(research a property|property research)\b/.test(q)) {
    return {
      answer: "Yes. Open Property Research to start a new report or revisit previous ones.",
      links: [
        { label: "Property Research", href: "/dashboard" },
        { label: "New Property Research", href: "/reports/new" },
      ],
    };
  }

  return null;
}

function answerWhereHow(
  question: string,
  role: string | null | undefined,
  health: CapabilityRuntimeHealth,
): CapabilityHelpAnswer | null {
  const q = question.toLowerCase();

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

  if (/\b(property research|old property|previous (property )?report)\b/.test(q)) {
    return {
      answer: "Open Property Research on the dashboard to see previous reports or start a new one.",
      links: [
        { label: "Property Research", href: "/dashboard" },
        { label: "New Property Research", href: "/reports/new" },
      ],
    };
  }

  if (/\b(settings|users|diagnostics|integrations|rulebook|monitoring|governance)\b/.test(q)) {
    const cap = findCapabilityByTopic(question, role);
    if (cap) {
      const links = linkFor(cap, role);
      if (
        links.length === 0 &&
        cap.audience.includes("admin") &&
        role !== "admin" &&
        role !== "super_admin"
      ) {
        return {
          answer: `${cap.name} is an admin area. Ask an admin if you need access.`,
          links: [],
        };
      }
      return {
        answer: `${cap.shortDescription}${links[0] ? `\n\nOpen: ${links[0].href}` : ""}`,
        links,
      };
    }
  }

  const topic = findCapabilityByTopic(question, role);
  if (topic && /\b(where|how)\b/.test(q)) {
    const links = linkFor(topic, role);
    return {
      answer: [
        topic.detailedDescription,
        topic.limitations[0] ? `\nLimit: ${topic.limitations[0]}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      links,
    };
  }

  return null;
}

/**
 * Build a deterministic capability/help answer when appropriate.
 * Returns null when the question should use the normal retrieval pipeline.
 */
export function answerCapabilityHelp(input: {
  question: string;
  role?: string | null;
  profile?: Profile | null;
}): CapabilityHelpAnswer | null {
  const question = input.question.trim();
  if (!detectCapabilityHelpIntent(question)) return null;

  const role = input.role ?? null;
  const health = getCapabilityRuntimeHealth({
    monitoringKnown: isMonitoringCapabilityKnown(),
  });

  const pemDef = pemHelpDefinitionAnswer(question);
  if (pemDef) {
    return {
      answer: pemDef,
      links: [
        { label: "Open PEM NEATs", href: "/pem-neats" },
        { label: "Create PEM NEAT", href: "/pem-neats/new" },
      ],
    };
  }

  const q = question.toLowerCase();
  if (
    /\bwhat can you (do|help)|what (all )?can (baxter|you) help|what tools|how (can|do) you help|capabilities\b/.test(
      q,
    )
  ) {
    return formatOverview(role, health);
  }

  const canYou = answerCanYou(question, role, input.profile ?? null, health);
  if (canYou) return canYou;

  const whereHow = answerWhereHow(question, role, health);
  if (whereHow) return whereHow;

  if (/\bwho (are|is) (you|baxter)|what (are|is) (you|baxter)\b/.test(q)) {
    return {
      answer:
        "I'm Baxter, Acton ADU's internal AI teammate. I help employees find approved knowledge, work with PEM NEATs, look up connected systems like GoHighLevel when available, run Property Research, and answer Process Rulebook questions — here and in Slack.",
      links: [],
    };
  }

  return formatOverview(role, health);
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
    "- Google access is limited to Knowledge Center–connected sources",
  ].join("\n");
}
