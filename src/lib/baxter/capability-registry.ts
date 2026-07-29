/**
 * Live Baxter capability catalog — derived from tools, admin routes, and connector health.
 * Prefer this over hardcoded marketing copy in identity prompts.
 */
import { BAXTER_ADMIN_CARDS, BAXTER_TOOLS } from "@/lib/baxter/tools";
import { getAdminNavLinks } from "@/lib/baxter/admin-nav";
import { PROCESS_MONITORING_UI_ENABLED } from "@/lib/baxter/feature-flags";
import { isGhlConfigured, isGhlEnabled } from "@/lib/connectors/ghl/config";
import { isGoogleWorkspaceConfigured } from "@/lib/connectors/google/auth";
import { isActiveRulebookKnown } from "@/lib/rulebook/capabilities";
import { isSlackSearchEnabled } from "@/lib/baxter-data/slack/config";

export type BaxterCapabilityAudience = "employee" | "admin";
export type BaxterCapabilityStatus =
  "available" | "connected" | "disconnected" | "admin_only" | "limited" | "disabled";

export type BaxterCapability = {
  key: string;
  name: string;
  shortDescription: string;
  detailedDescription: string;
  category:
    | "assistant"
    | "knowledge"
    | "pem_neat"
    | "property_research"
    | "crm"
    | "process"
    | "admin"
    | "slack";
  audience: BaxterCapabilityAudience[];
  rolesAllowed: Array<"new_user" | "user" | "admin" | "super_admin" | "*">;
  status: BaxterCapabilityStatus;
  enabled: boolean;
  webRoute: string | null;
  createRoute: string | null;
  adminRoute: string | null;
  supportedActions: string[];
  limitations: string[];
  helpTopics: string[];
  synonyms: string[];
  sourceOfTruth: "baxter_tools" | "admin_nav" | "connectors" | "feature_flags" | "runtime";
};

export type CapabilityRuntimeHealth = {
  googleConfigured: boolean;
  ghlConfigured: boolean;
  ghlEnabled: boolean;
  rulebookKnown: boolean;
  monitoringKnown: boolean;
  monitoringUiEnabled: boolean;
  slackSearchEnabled: boolean;
};

export function getCapabilityRuntimeHealth(
  overrides?: Partial<CapabilityRuntimeHealth>,
): CapabilityRuntimeHealth {
  return {
    googleConfigured: isGoogleWorkspaceConfigured(),
    ghlConfigured: isGhlConfigured(),
    ghlEnabled: isGhlEnabled(),
    rulebookKnown: isActiveRulebookKnown(),
    monitoringKnown: false,
    monitoringUiEnabled: PROCESS_MONITORING_UI_ENABLED,
    slackSearchEnabled: isSlackSearchEnabled(),
    ...overrides,
  };
}

function roleAllows(
  rolesAllowed: BaxterCapability["rolesAllowed"],
  role: string | null | undefined,
): boolean {
  if (rolesAllowed.includes("*")) return true;
  if (!role) return rolesAllowed.includes("user");
  return rolesAllowed.includes(role as BaxterCapability["rolesAllowed"][number]);
}

/** Build the current capability catalog (machine-readable; filter by role at answer time). */
export function buildBaxterCapabilityCatalog(
  health: CapabilityRuntimeHealth = getCapabilityRuntimeHealth(),
): BaxterCapability[] {
  const pemTool = BAXTER_TOOLS.find((t) => t.key === "pem-neat");
  const propertyTool = BAXTER_TOOLS.find((t) => t.key === "property-research");
  const knowledgeCard = BAXTER_ADMIN_CARDS.find((c) => c.key === "knowledge-base");
  const integrationsCard = BAXTER_ADMIN_CARDS.find((c) => c.key === "integrations");
  const adminLinks = getAdminNavLinks();
  const usersHref = adminLinks.find((l) => l.href === "/admin/users")?.href ?? "/admin/users";
  const diagnosticsHref =
    adminLinks.find((l) => l.href === "/admin/settings")?.href ?? "/admin/settings";
  const rulebookHref =
    adminLinks.find((l) => l.href === "/admin/baxter/rulebook")?.href ?? "/admin/baxter/rulebook";
  const monitoringHref =
    adminLinks.find((l) => l.href === "/admin/baxter/monitoring")?.href ??
    "/admin/baxter/monitoring";
  const governanceHref =
    adminLinks.find((l) => l.href === "/admin/baxter/governance")?.href ??
    "/admin/baxter/governance";

  const catalog: BaxterCapability[] = [
    {
      key: "web_chat",
      name: "Baxter web chat",
      shortDescription: "Ask Baxter questions in the Acton Baxter web app.",
      detailedDescription:
        "Employees can chat with Baxter in the web app for Acton knowledge, PEM NEATs, CRM lookups, Property Research navigation, and general work help.",
      category: "assistant",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin", "*"],
      status: "available",
      enabled: true,
      webRoute: "/",
      createRoute: null,
      adminRoute: null,
      supportedActions: ["Ask questions", "Clear conversation with /clear or New chat"],
      limitations: ["Does not permanently change Baxter behavior from a single chat message"],
      helpTopics: ["how to clear chat", "what can baxter do"],
      synonyms: ["chat", "web assistant", "ask baxter"],
      sourceOfTruth: "runtime",
    },
    {
      key: "slack_chat",
      name: "Baxter in Slack",
      shortDescription: "DM Baxter or @mention Baxter in allowed Slack channels.",
      detailedDescription:
        "Baxter answers the same way in Slack DMs and @mentions as in web chat, with clickable links back into Baxter where appropriate.",
      category: "slack",
      audience: ["employee", "admin"],
      rolesAllowed: ["*", "user", "admin", "super_admin"],
      status: "available",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: "/admin/slack",
      supportedActions: ["DM Baxter", "@mention Baxter", "/clear in Slack"],
      limitations: ["Only works in allowed Slack workspaces/channels configured by admins"],
      helpTopics: ["slack", "dm baxter"],
      synonyms: ["slack", "dm", "@baxter"],
      sourceOfTruth: "connectors",
    },
    {
      key: "slack_search",
      name: "Slack Search",
      shortDescription:
        "Search live Slack conversations your account is authorized to access — what someone said, recent updates, decisions, and channel discussions.",
      detailedDescription:
        "Baxter can search Slack conversations your account has access to and use them to answer questions about recent discussions, updates, decisions, and messages. Examples: what someone said, latest update on a topic, who mentioned something, channel/time-window summaries, and thread context. It only searches content your Slack permissions allow. Slack is conversational context, not automatic approved policy. Baxter does not copy Slack history into Knowledge.",
      category: "slack",
      audience: ["employee", "admin"],
      rolesAllowed: ["*", "user", "admin", "super_admin"],
      status: health.slackSearchEnabled ? "available" : "disabled",
      enabled: health.slackSearchEnabled,
      webRoute: "/settings/integrations",
      createRoute: null,
      adminRoute: "/admin/slack",
      supportedActions: [
        "What did someone say",
        "Latest update on a topic",
        "Who mentioned something",
        "When did we decide",
        "Summarize a channel/time window",
        "Combine Slack with PEM/GHL/Knowledge",
      ],
      limitations: [
        "Only searches Slack content your Slack authorization allows",
        "Does not invent organizational memory or mirror Slack into Knowledge",
        "Private channels and DMs require connecting Slack Search under Settings → Integrations",
        "Public channel history can use Baxter’s bot access when you message from Slack",
      ],
      helpTopics: [
        "search slack",
        "what can you search in slack",
        "what did someone say",
        "latest on",
        "who mentioned",
        "connect slack",
      ],
      synonyms: [
        "slack search",
        "slack history",
        "what did jess say",
        "last message",
        "conversation",
        "who mentioned",
      ],
      sourceOfTruth: "connectors",
    },
    {
      key: "knowledge_center",
      name: "Knowledge Center",
      shortDescription:
        knowledgeCard?.description ??
        "Approved Acton knowledge, uploads, and Google Workspace sources.",
      detailedDescription:
        "Baxter answers company questions from approved Knowledge Center entries and selected Google Workspace files admins have connected. Uploaded PDFs, Docs, Sheets, images, and presentations can be indexed when configured.",
      category: "knowledge",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin", "*"],
      status: health.googleConfigured ? "connected" : "available",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: knowledgeCard?.href ?? "/admin/knowledge",
      supportedActions: [
        "Answer from approved knowledge",
        "Cite sources",
        "Use hybrid/semantic retrieval when indexed",
      ],
      limitations: [
        health.googleConfigured
          ? "Google Workspace access is limited to files/folders admins have made available to Baxter — not every file in Drive"
          : "Google Workspace integration exists but is currently disconnected or not configured",
        "Does not invent official Acton policy when no approved source covers it",
      ],
      helpTopics: ["where do i add knowledge", "knowledge center", "google drive", "citations"],
      synonyms: [
        "knowledge base",
        "knowledge center",
        "uploaded files",
        "google drive",
        "google docs",
        "google sheets",
      ],
      sourceOfTruth: "connectors",
    },
    {
      key: "pem_neat",
      name: pemTool?.name ?? "Partnership Evaluation Meeting NEAT",
      shortDescription:
        pemTool?.description ??
        "Generate and review PEM sales intelligence, assessments, and BuilderTrend handoff fields.",
      detailedDescription:
        "Open Partnership Evaluation Meeting NEAT, add a prospect and salesperson, paste the transcript, and Generate. Baxter saves Notes, Email, Assessment, and Transcript intelligence, including BuilderTrend custom fields for copy/paste. Completed NEATs can be reopened, edited, regenerated, and asked about in chat.",
      category: "pem_neat",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin"],
      status: pemTool?.enabled === false ? "disabled" : "available",
      enabled: pemTool?.enabled !== false,
      webRoute: pemTool?.href ?? "/pem-neats",
      createRoute: "/pem-neats/new",
      adminRoute: null,
      supportedActions: [
        "Generate PEM NEAT",
        "Save and reopen meetings",
        "Edit transcript and regenerate",
        "Sales assessment / coaching",
        "Follow-up email draft",
        "BuilderTrend custom-field handoff (copy/paste)",
        "Answer questions about completed PEM NEATs",
      ],
      limitations: [
        "Baxter is not directly connected to BuilderTrend — handoff fields are prepared for copy/paste only",
        "Does not modify a saved NEAT when answering questions about it",
      ],
      helpTopics: [
        "what is a pem",
        "what is a pem neat",
        "how do i generate a pem neat",
        "buildertrend fields",
        "grade a sales meeting",
        "paste transcript",
      ],
      synonyms: [
        "pem",
        "neat",
        "pem neat",
        "partnership evaluation",
        "sales meeting",
        "sales assessment",
        "buildertrend handoff",
        "transcript",
      ],
      sourceOfTruth: "baxter_tools",
    },
    {
      key: "property_research",
      name: propertyTool?.name ?? "Property Research Tool",
      shortDescription:
        propertyTool?.description ??
        "Research property, parcel, zoning, and planning information for PEM preparation.",
      detailedDescription:
        "Start new property research or reopen previous reports from the Property Research dashboard.",
      category: "property_research",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin", "*"],
      status: propertyTool?.enabled === false ? "disabled" : "available",
      enabled: propertyTool?.enabled !== false,
      webRoute: propertyTool?.href ?? "/dashboard",
      createRoute: "/reports/new",
      adminRoute: null,
      supportedActions: ["New property research", "Open previous reports"],
      limitations: [],
      helpTopics: [
        "where do i see property research",
        "old property reports",
        "research a property",
      ],
      synonyms: ["property research", "parcel", "zoning", "reports", "property tool"],
      sourceOfTruth: "baxter_tools",
    },
    {
      key: "gohighlevel",
      name: "GoHighLevel CRM",
      shortDescription: health.ghlConfigured
        ? "Look up live GHL contacts and opportunities; approved updates require confirmation."
        : "GoHighLevel integration exists but is not currently connected.",
      detailedDescription: health.ghlConfigured
        ? "Baxter can read live GoHighLevel CRM data when connected: contacts (including address, owner, tags, custom fields), opportunities (pipeline/stage/value), and recent conversations/messages. Supported CRM updates require confirmation before anything changes."
        : "GoHighLevel can be connected by admins under Integrations. Until connected, Baxter cannot look up live CRM records.",
      category: "crm",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin", "*"],
      status: health.ghlConfigured && health.ghlEnabled ? "connected" : "disconnected",
      enabled: health.ghlConfigured && health.ghlEnabled,
      webRoute: null,
      createRoute: null,
      adminRoute: integrationsCard?.href ?? "/admin/connectors",
      supportedActions: health.ghlConfigured
        ? [
            "Look up contacts and opportunities",
            "Answer CRM questions from live data",
            "Propose supported updates with confirmation",
          ]
        : [],
      limitations: [
        "Does not autonomously change CRM records",
        "Write actions require authorization and explicit confirmation",
        "Does not claim BuilderTrend or Domo API access",
      ],
      helpTopics: ["can you update ghl", "gohighlevel", "crm", "opportunity stage"],
      synonyms: ["ghl", "gohighlevel", "crm", "opportunity", "contact", "pipeline"],
      sourceOfTruth: "connectors",
    },
    {
      key: "process_rulebook",
      name: "Process Rulebook",
      shortDescription: health.rulebookKnown
        ? "Answer responsibility and required-data questions from the active Process Rulebook."
        : "Process Rulebook admin tooling exists; claim answers only when an active rulebook is loaded.",
      detailedDescription:
        "When an active Process Rulebook is configured, Baxter can answer RACI / responsibility and required-data questions from it.",
      category: "process",
      audience: ["employee", "admin"],
      rolesAllowed: ["user", "admin", "super_admin", "*"],
      status: health.rulebookKnown ? "available" : "limited",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: rulebookHref,
      supportedActions: health.rulebookKnown
        ? ["Answer RACI / responsibility questions", "Cite rulebook evidence"]
        : [],
      limitations: health.rulebookKnown
        ? []
        : ["No active Process Rulebook is currently confirmed in runtime"],
      helpTopics: ["process rulebook", "raci", "who is responsible"],
      synonyms: ["rulebook", "raci", "process", "responsibility"],
      sourceOfTruth: "runtime",
    },
    {
      key: "process_monitoring",
      name: "Process Monitoring",
      shortDescription:
        health.monitoringKnown && health.monitoringUiEnabled
          ? "Proactive monitoring for unowned/stale deals and missing required data (when enabled)."
          : "Process Monitoring is not currently advertised as active.",
      detailedDescription:
        "When enabled by admins, Baxter can surface monitoring signals for GHL pipeline health. Do not claim proactive monitoring unless it is enabled.",
      category: "process",
      audience: ["admin"],
      rolesAllowed: ["admin", "super_admin"],
      status: health.monitoringKnown && health.monitoringUiEnabled ? "available" : "disabled",
      enabled: health.monitoringKnown && health.monitoringUiEnabled,
      webRoute: null,
      createRoute: null,
      adminRoute: monitoringHref,
      supportedActions:
        health.monitoringKnown && health.monitoringUiEnabled
          ? ["Detect unowned opportunities", "Detect stale deals", "Config health checks"]
          : [],
      limitations: ["Only claim when monitoring is enabled/configured"],
      helpTopics: ["process monitoring", "monitoring"],
      synonyms: ["monitoring", "alerts", "stale deals"],
      sourceOfTruth: "feature_flags",
    },
    {
      key: "integrations_admin",
      name: "Integrations",
      shortDescription:
        integrationsCard?.description ??
        "Connect Google Workspace, Slack, GoHighLevel, and related connectors.",
      detailedDescription: "Admins manage connector health and credentials under Integrations.",
      category: "admin",
      audience: ["admin"],
      rolesAllowed: ["admin", "super_admin"],
      status: "admin_only",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: integrationsCard?.href ?? "/admin/connectors",
      supportedActions: ["Connect Google Workspace", "Manage Slack", "Manage GoHighLevel"],
      limitations: ["Admin-only"],
      helpTopics: ["how do i connect google drive", "integrations", "connectors"],
      synonyms: ["integrations", "connectors", "google drive connect"],
      sourceOfTruth: "admin_nav",
    },
    {
      key: "users_admin",
      name: "Users",
      shortDescription: "Manage Baxter user roles and access.",
      detailedDescription: "Admins manage employee roles and access under Users.",
      category: "admin",
      audience: ["admin"],
      rolesAllowed: ["admin", "super_admin"],
      status: "admin_only",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: usersHref,
      supportedActions: ["Manage roles"],
      limitations: ["Admin-only"],
      helpTopics: ["users", "roles"],
      synonyms: ["users", "roles", "permissions"],
      sourceOfTruth: "admin_nav",
    },
    {
      key: "settings_admin",
      name: "Settings",
      shortDescription: "Baxter platform settings and diagnostics entry points.",
      detailedDescription: "Admins configure platform settings under Settings.",
      category: "admin",
      audience: ["admin"],
      rolesAllowed: ["admin", "super_admin"],
      status: "admin_only",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: diagnosticsHref,
      supportedActions: ["Open settings"],
      limitations: ["Admin-only"],
      helpTopics: ["settings", "diagnostics"],
      synonyms: ["settings", "diagnostics", "configuration"],
      sourceOfTruth: "admin_nav",
    },
    {
      key: "governance_admin",
      name: "Baxter Governance",
      shortDescription: "Runtime/governance standards for Baxter behavior.",
      detailedDescription: "Admins review Baxter governance and runtime standards.",
      category: "admin",
      audience: ["admin"],
      rolesAllowed: ["admin", "super_admin"],
      status: "admin_only",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: governanceHref,
      supportedActions: ["Review governance"],
      limitations: ["Admin-only"],
      helpTopics: ["governance"],
      synonyms: ["governance", "runtime"],
      sourceOfTruth: "admin_nav",
    },
    {
      key: "general_writing",
      name: "Writing and analysis",
      shortDescription: "Summarize, draft, explain, and reason through general work.",
      detailedDescription:
        "Baxter can help with drafting, summarization, and general explanations. Customer-facing copy should be marked for human review.",
      category: "assistant",
      audience: ["employee", "admin"],
      rolesAllowed: ["*", "user", "admin", "super_admin"],
      status: "available",
      enabled: true,
      webRoute: null,
      createRoute: null,
      adminRoute: null,
      supportedActions: ["Summarize", "Draft", "Explain", "Reason"],
      limitations: [
        "Not customer-facing as an autonomous actor",
        "Not a decision-maker for important Acton calls",
      ],
      helpTopics: ["draft", "summarize", "write"],
      synonyms: ["writing", "draft", "summarize", "explain"],
      sourceOfTruth: "runtime",
    },
  ];

  return catalog;
}

export function listCapabilitiesForRole(
  role: string | null | undefined,
  health?: CapabilityRuntimeHealth,
): BaxterCapability[] {
  const isAdmin = role === "admin" || role === "super_admin";
  return buildBaxterCapabilityCatalog(health).filter((cap) => {
    if (!cap.enabled && cap.key !== "gohighlevel" && cap.key !== "process_monitoring") {
      // Still expose disconnected GHL honestly; hide other disabled tools.
      if (cap.status === "disabled") return false;
    }
    if (cap.status === "disabled" && cap.key === "process_monitoring") return isAdmin;
    if (!roleAllows(cap.rolesAllowed, role)) return false;
    if (cap.audience.includes("admin") && !cap.audience.includes("employee") && !isAdmin) {
      return false;
    }
    return true;
  });
}

export function findCapabilityByTopic(
  question: string,
  role: string | null | undefined,
): BaxterCapability | null {
  const q = question.toLowerCase();
  const caps = listCapabilitiesForRole(role);
  let best: BaxterCapability | null = null;
  let bestScore = 0;
  for (const cap of caps) {
    let score = 0;
    for (const syn of cap.synonyms) {
      if (q.includes(syn.toLowerCase())) score += syn.length;
    }
    for (const topic of cap.helpTopics) {
      if (q.includes(topic.toLowerCase())) score += topic.length + 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cap;
    }
  }
  return bestScore > 0 ? best : null;
}

export function capabilityRegistryStats(health?: CapabilityRuntimeHealth): {
  total: number;
  enabled: number;
} {
  const all = buildBaxterCapabilityCatalog(health);
  return {
    total: all.length,
    enabled: all.filter((c) => c.enabled).length,
  };
}
