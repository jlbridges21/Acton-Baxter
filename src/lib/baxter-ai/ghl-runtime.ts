import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  canUserWriteGhl,
  createPendingAction,
  confirmPendingAction,
  cancelPendingAction,
  getPendingActionForActor,
  executeAction,
  recordActionAudit,
  type GhlPendingAction,
} from "@/lib/connectors/ghl/actions";
import { buildGhlContext, type GhlContextResult } from "@/lib/baxter-data/ghl/context-builder";
import { resolveContact, resolveOpportunity } from "@/lib/baxter-data/ghl/resolve";
import { detectGhlIntent, type GhlIntentDetection } from "@/lib/baxter-ai/ghl-intent";
import type { BaxterContextItem } from "@/lib/baxter-ai/types";
import type { Profile } from "@/lib/research/db-types";
import { listPipelines } from "@/lib/connectors/ghl/resources/pipelines";
import { getContactById } from "@/lib/connectors/ghl/resources/contacts";
import {
  listOpportunitiesByContact,
  getOpportunityById,
} from "@/lib/connectors/ghl/resources/opportunities";

export type GhlRuntimeHandleResult =
  | { handled: false }
  | {
      handled: true;
      answer: string;
      sources: Array<{
        knowledgeEntryId?: string | null;
        title: string;
        citationLabel: string;
        sourceUrl?: string | null;
        sourceType?: string;
      }>;
      answerMode: "grounded" | "clarification" | "mixed";
      confidence: "high" | "medium" | "low";
      insufficientKnowledge: boolean;
    };

function isConfirmMessage(text: string): boolean {
  return /^(confirm|yes|y|do it|proceed|approve|go ahead)\.?$/i.test(text.trim());
}

function isCancelMessage(text: string): boolean {
  return /^(cancel|no|n|stop|abort|nevermind|never mind)\.?$/i.test(text.trim());
}

function formatPendingPreview(action: GhlPendingAction): string {
  const lines = [
    "Proposed GoHighLevel update",
    "",
    `Resource: ${action.resourceName || action.resourceType} (${action.resourceType})`,
    `Action: ${action.actionType.replace(/_/g, " ")}`,
    "",
    "Before → After:",
  ];
  for (const [key, nextValue] of Object.entries(action.proposedChanges)) {
    const before = action.beforeState[key];
    lines.push(`• ${key}: ${formatValue(before)} → ${formatValue(nextValue)}`);
  }
  lines.push("");
  lines.push("Reply **confirm** to apply this change, or **cancel** to discard it.");
  lines.push("(This confirmation expires in about 10 minutes.)");
  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ghlContextToItems(result: GhlContextResult, startNumber = 1): BaxterContextItem[] {
  if (!result.hasData || !result.contextText) return [];
  return result.citations.map((citation, index) => {
    const source = result.evidenceSources[index];
    return {
      number: startNumber + index,
      id: source?.resourceId ?? `ghl-${index}`,
      title: citation,
      summary: null,
      contentExcerpt: index === 0 ? result.contextText.slice(0, 900) : citation,
      category: "GoHighLevel",
      tags: ["gohighlevel", source?.resourceType ?? "crm"],
      sourceName: "GoHighLevel",
      sourceUrl: null,
      sourceType: "GoHighLevel",
      mimeType: null,
      updatedAt: source?.retrievedAt ?? new Date().toISOString(),
      citationLabel: citation,
      relevanceScore: 0.95,
    };
  });
}

/**
 * Handle confirm/cancel of a pending GHL write in this conversation.
 */
export async function handleGhlPendingConfirmation(input: {
  question: string;
  conversationId: string;
  userId: string | null;
  externalUserId?: string | null;
  profile: Profile | null;
}): Promise<GhlRuntimeHandleResult> {
  if (!isGhlConfigured()) return { handled: false };

  const pending = await getPendingActionForActor({
    conversationId: input.conversationId,
    userId: input.userId,
    externalUserId: input.externalUserId ?? null,
  }).catch(() => null);
  if (!pending) return { handled: false };

  if (isCancelMessage(input.question)) {
    await cancelPendingAction(pending.id).catch(() => undefined);
    await recordActionAudit({
      pendingActionId: pending.id,
      actorUserId: input.userId,
      action: pending.actionType,
      resourceType: pending.resourceType,
      resourceId: pending.resourceId,
      status: "cancelled",
    }).catch(() => undefined);
    return {
      handled: true,
      answer: "Cancelled. No GoHighLevel changes were made.",
      sources: [],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  }

  if (!isConfirmMessage(input.question)) return { handled: false };

  const permission = canUserWriteGhl(input.profile);
  if (!permission.canWrite) {
    return {
      handled: true,
      answer:
        permission.reason ||
        "You are not authorized to confirm GoHighLevel updates. Ask an administrator if you need write access.",
      sources: [],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  }

  const confirmed = await confirmPendingAction(pending.id).catch(() => null);
  if (!confirmed?.success || !confirmed.action) {
    return {
      handled: true,
      answer:
        confirmed?.error ||
        "That confirmation expired or is no longer valid. Please ask me to prepare the GoHighLevel update again.",
      sources: [],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  }

  const result = await executeAction(confirmed.action.id);
  if (!result.success) {
    if (result.errorCode === "BAXTER_GHL_STALE_STATE") {
      return {
        handled: true,
        answer:
          "This record changed since I prepared the update. Nothing was changed. Please ask me to prepare the update again so you can review the latest state.",
        sources: [],
        answerMode: "clarification",
        confidence: "high",
        insufficientKnowledge: false,
      };
    }
    return {
      handled: true,
      answer: `I couldn't update GoHighLevel. Nothing was changed.${
        result.errorCode ? ` (code: ${result.errorCode})` : ""
      }`,
      sources: [],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  }

  return {
    handled: true,
    answer: `Done. Updated ${pending.resourceName || pending.resourceType} in GoHighLevel.`,
    sources: [
      {
        title: `GoHighLevel — ${pending.resourceName || pending.resourceType}`,
        citationLabel: `GoHighLevel — ${pending.resourceName || pending.resourceType}`,
        sourceType: "GoHighLevel",
        sourceUrl: null,
        knowledgeEntryId: null,
      },
    ],
    answerMode: "grounded",
    confidence: "high",
    insufficientKnowledge: false,
  };
}

/**
 * If the user asked to mutate GHL, create a pending confirmation (never write immediately).
 */
export async function handleGhlWriteProposal(input: {
  question: string;
  conversationId: string;
  userId: string | null;
  externalUserId: string | null;
  channel: "web" | "slack";
  profile: Profile | null;
}): Promise<GhlRuntimeHandleResult> {
  if (!isGhlConfigured()) return { handled: false };

  const intent = detectGhlIntent(input.question);
  if (!intent.isWriteIntent || intent.confidence < 0.7) return { handled: false };

  const permission = canUserWriteGhl(input.profile);
  if (!permission.canWrite) {
    return {
      handled: true,
      answer:
        permission.reason ||
        "You can look up GoHighLevel data, but you are not authorized to change CRM records through Baxter.",
      sources: [],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  }

  try {
    const proposal = await proposeWriteFromIntent(intent, input.question);
    if (proposal.kind === "clarify") {
      return {
        handled: true,
        answer: proposal.message,
        sources: [],
        answerMode: "clarification",
        confidence: "medium",
        insufficientKnowledge: false,
      };
    }

    const pending = await createPendingAction({
      userId: input.userId,
      externalUserId: input.externalUserId,
      conversationId: input.conversationId,
      channel: input.channel,
      actionType: proposal.actionType,
      resourceType: proposal.resourceType,
      resourceId: proposal.resourceId,
      resourceName: proposal.resourceName,
      beforeState: proposal.beforeState,
      proposedChanges: proposal.proposedChanges,
      metadata: { question: input.question },
    });

    await recordActionAudit({
      pendingActionId: pending.id,
      actorUserId: input.userId,
      conversationId: input.conversationId,
      action: pending.actionType,
      resourceType: pending.resourceType,
      resourceId: pending.resourceId,
      beforeState: pending.beforeState,
      afterState: pending.proposedChanges,
      status: "proposed",
      proposedAt: new Date().toISOString(),
    }).catch(() => undefined);

    return {
      handled: true,
      answer: formatPendingPreview(pending),
      sources: [
        {
          title: `GoHighLevel — ${pending.resourceName || pending.resourceType}`,
          citationLabel: `GoHighLevel — ${pending.resourceName || pending.resourceType}`,
          sourceType: "GoHighLevel",
          sourceUrl: null,
          knowledgeEntryId: null,
        },
      ],
      answerMode: "clarification",
      confidence: "high",
      insufficientKnowledge: false,
    };
  } catch (error) {
    return {
      handled: true,
      answer: `I couldn't prepare that GoHighLevel update: ${
        error instanceof Error ? error.message.slice(0, 200) : "unknown error"
      }`,
      sources: [],
      answerMode: "clarification",
      confidence: "low",
      insufficientKnowledge: false,
    };
  }
}

type WriteProposal =
  | { kind: "clarify"; message: string }
  | {
      kind: "pending";
      actionType: GhlPendingAction["actionType"];
      resourceType: GhlPendingAction["resourceType"];
      resourceId: string;
      resourceName: string;
      beforeState: Record<string, unknown>;
      proposedChanges: Record<string, unknown>;
    };

async function proposeWriteFromIntent(
  intent: GhlIntentDetection,
  question: string,
): Promise<WriteProposal> {
  const contactResult = await resolveContact({
    name: intent.entities.contactName || intent.entities.opportunityName,
    email: intent.entities.contactEmail,
    phone: intent.entities.contactPhone,
  });

  if (contactResult.ambiguous && contactResult.candidates?.length) {
    return {
      kind: "clarify",
      message:
        contactResult.ambiguityMessage ||
        "I found multiple matching contacts. Which one did you mean?",
    };
  }

  if (contactResult.notFound || !contactResult.entity) {
    return {
      kind: "clarify",
      message:
        "I couldn't find a matching GoHighLevel contact for that request. Try a fuller name, email, or phone.",
    };
  }

  const contact = contactResult.entity;

  if (intent.intent === "write_tag") {
    const tagName = intent.entities.tagName?.trim();
    if (!tagName) {
      return { kind: "clarify", message: "Which tag should I add or remove?" };
    }
    const adding = /add/i.test(question) || !/remove/i.test(question);
    return {
      kind: "pending",
      actionType: adding ? "add_contact_tag" : "remove_contact_tag",
      resourceType: "contact",
      resourceId: contact.id,
      resourceName: contact.name || "Contact",
      beforeState: { tags: contact.tags ?? [] },
      proposedChanges: { tagName },
    };
  }

  if (intent.intent === "write_opportunity" || /move|stage|mark/i.test(question)) {
    const opportunities = await listOpportunitiesByContact(contact.id);
    if (opportunities.length === 0) {
      return {
        kind: "clarify",
        message: `${contact.name || "That contact"} has no opportunities in GoHighLevel.`,
      };
    }
    if (opportunities.length > 1 && !intent.entities.opportunityName) {
      return {
        kind: "clarify",
        message: [
          `I found ${opportunities.length} opportunities for ${contact.name || "this contact"}:`,
          ...opportunities.map((o, i) => `${i + 1}. ${o.name || o.id}`),
          "",
          "Which one should I update?",
        ].join("\n"),
      };
    }

    let opportunity = opportunities[0]!;
    if (intent.entities.opportunityName) {
      const resolved = await resolveOpportunity({
        opportunityName: intent.entities.opportunityName,
        contactId: contact.id,
      });
      if (resolved.ambiguous) {
        return {
          kind: "clarify",
          message: resolved.ambiguityMessage || "Multiple opportunities matched. Which one?",
        };
      }
      if (resolved.entity) opportunity = resolved.entity;
    }

    const stageName = intent.entities.stageName?.trim();
    if (!stageName) {
      return {
        kind: "clarify",
        message: "Which pipeline stage should I move this opportunity to?",
      };
    }

    const pipelines = await listPipelines();
    const pipeline =
      pipelines.find((p) => p.id === opportunity.pipelineId) ||
      pipelines.find((p) =>
        (p.stages || []).some((s) => s.name?.toLowerCase() === stageName.toLowerCase()),
      );
    const stage = (pipeline?.stages || []).find(
      (s) => s.name?.toLowerCase() === stageName.toLowerCase(),
    );
    if (!stage) {
      return {
        kind: "clarify",
        message: `I couldn't find a pipeline stage named "${stageName}". Check the exact stage name in GoHighLevel.`,
      };
    }

    const currentStage =
      (pipeline?.stages || []).find((s) => s.id === opportunity.pipelineStageId)?.name ||
      opportunity.pipelineStageId ||
      "(unknown)";

    return {
      kind: "pending",
      actionType: "move_opportunity_stage",
      resourceType: "opportunity",
      resourceId: opportunity.id,
      resourceName: opportunity.name || contact.name || "Opportunity",
      beforeState: {
        pipelineStageId: opportunity.pipelineStageId,
        stageName: currentStage,
        pipelineName: pipeline?.name ?? null,
      },
      proposedChanges: {
        pipelineStageId: stage.id,
        stageName: stage.name,
        pipelineName: pipeline?.name ?? null,
      },
    };
  }

  // Generic contact field update — extract "set X to Y" lightly
  const setMatch = question.match(/(?:set|update|change)\s+(?:.+?'s\s+)?(.+?)\s+to\s+(.+)$/i);
  if (setMatch) {
    const fieldLabel = setMatch[1]!.trim();
    const newValue = setMatch[2]!.trim().replace(/[."]+$/, "");
    const fieldKey = fieldLabel.toLowerCase().includes("city")
      ? "city"
      : fieldLabel.toLowerCase().includes("phone")
        ? "phone"
        : fieldLabel.toLowerCase().includes("email")
          ? "email"
          : null;
    if (!fieldKey) {
      return {
        kind: "clarify",
        message: `I can update standard fields like phone, email, or city in Prompt 2. Custom field "${fieldLabel}" support uses the field allowlist — tell me the exact field name if it's a known custom field.`,
      };
    }
    const before = (contact as Record<string, unknown>)[fieldKey];
    return {
      kind: "pending",
      actionType: "update_contact_fields",
      resourceType: "contact",
      resourceId: contact.id,
      resourceName: contact.name || "Contact",
      beforeState: { [fieldKey]: before ?? null },
      proposedChanges: { [fieldKey]: newValue },
    };
  }

  return {
    kind: "clarify",
    message:
      "I understood you want to change GoHighLevel, but I need a clearer instruction (for example: move an opportunity to a named stage, or set a contact phone/email/city).",
  };
}

/**
 * Fetch live GHL context for CRM questions and convert to Baxter context items.
 */
export async function retrieveGhlLiveEvidence(question: string): Promise<{
  items: BaxterContextItem[];
  contextText: string;
  ambiguityWarning?: string;
  intent: GhlIntentDetection;
  handledInsight?: boolean;
}> {
  if (!isGhlConfigured()) {
    return {
      items: [],
      contextText: "",
      intent: {
        intent: "none",
        confidence: 0,
        entities: {},
        isWriteIntent: false,
        requiresConfirmation: false,
      },
    };
  }

  const intent = detectGhlIntent(question);

  if (String(intent.intent).startsWith("insight_")) {
    const insightText = await runInsightReport(intent).catch(
      (error) =>
        `I couldn't run that CRM insight: ${error instanceof Error ? error.message.slice(0, 160) : "error"}`,
    );
    return {
      items: [
        {
          number: 1,
          id: "ghl-insight",
          title: "GoHighLevel insight",
          summary: null,
          contentExcerpt: insightText.slice(0, 900),
          category: "GoHighLevel",
          tags: ["gohighlevel", "insight"],
          sourceName: "GoHighLevel",
          sourceUrl: null,
          sourceType: "GoHighLevel",
          mimeType: null,
          updatedAt: new Date().toISOString(),
          citationLabel: "GoHighLevel — CRM insight",
          relevanceScore: 0.95,
        },
      ],
      contextText: insightText,
      intent,
      handledInsight: true,
    };
  }

  const name =
    intent.entities.contactName ||
    intent.entities.opportunityName ||
    intent.entities.contactEmail ||
    intent.entities.contactPhone;
  if (
    name &&
    (intent.intent === "contact_lookup" ||
      intent.intent === "opportunity_lookup" ||
      intent.intent === "general_crm" ||
      intent.intent === "conversation_lookup" ||
      intent.intent === "calendar_query")
  ) {
    const { resolveGhlEntityGraph, formatCustomerSnapshot } =
      await import("@/lib/connectors/ghl/entity-graph");
    const graph = await resolveGhlEntityGraph(name, {
      includeAppointments: true,
      includeConversations: true,
    }).catch(() => null);
    if (graph?.ambiguous) {
      return {
        items: [],
        contextText: "",
        ambiguityWarning: graph.clarificationMessage ?? undefined,
        intent,
      };
    }
    if (graph?.contact) {
      const snapshot = formatCustomerSnapshot(graph);
      return {
        items: [
          {
            number: 1,
            id: graph.contact.id,
            title: `GoHighLevel — ${graph.contact.name || name}`,
            summary: null,
            contentExcerpt: snapshot.slice(0, 900),
            category: "GoHighLevel",
            tags: ["gohighlevel", "contact"],
            sourceName: "GoHighLevel",
            sourceUrl: null,
            sourceType: "GoHighLevel",
            mimeType: null,
            updatedAt: graph.retrievedAt,
            citationLabel: `GoHighLevel — ${graph.contact.name || name}${
              graph.opportunities[0]?.opportunity.name
                ? ` — ${graph.opportunities[0].opportunity.name}`
                : ""
            }`,
            relevanceScore: 0.95,
          },
        ],
        contextText: snapshot,
        intent,
      };
    }
  }

  const result = await buildGhlContext(question).catch(() => null);
  if (!result || !result.hasData) {
    return {
      items: [],
      contextText: "",
      intent: result?.intent ?? intent,
      ambiguityWarning: result?.ambiguityWarning,
    };
  }

  return {
    items: ghlContextToItems(result),
    contextText: result.contextText,
    ambiguityWarning: result.ambiguityWarning,
    intent: result.intent,
  };
}

async function runInsightReport(intent: GhlIntentDetection): Promise<string> {
  const {
    getUnownedOpportunities,
    getStaleOpportunities,
    getAppointmentsInRange,
    getUnreadConversations,
    formatInsightTable,
  } = await import("@/lib/connectors/ghl/insights");

  if (intent.intent === "insight_unowned") {
    const report = await getUnownedOpportunities({ status: "open", maxItems: 50 });
    return formatInsightTable(
      "Open opportunities without an owner",
      report.rows.map((r) => ({
        Opportunity: r.opportunityName,
        Contact: r.contactName,
        Pipeline: r.pipelineName,
        Stage: r.stageName,
      })),
    );
  }

  if (intent.intent === "insight_stale") {
    const report = await getStaleOpportunities({
      daysSinceUpdate: 14,
      status: "open",
      maxItems: 50,
    });
    return formatInsightTable(
      "Open opportunities with no update in 14+ days (caller threshold, not Acton policy)",
      report.rows.map((r) => ({
        Opportunity: r.opportunityName,
        Contact: r.contactName,
        Stage: r.stageName,
        Owner: r.ownerName,
        "Days stale": r.daysStale,
      })),
    );
  }

  if (intent.intent === "insight_appointments") {
    const report = await getAppointmentsInRange({ daysAhead: 7 });
    return formatInsightTable(
      "Upcoming appointments (next 7 days)",
      report.events.map((e) => ({
        Title: e.title,
        When: new Date(e.startTime).toLocaleString(),
        Status: e.appointmentStatus,
      })),
    );
  }

  if (intent.intent === "insight_unread") {
    const report = await getUnreadConversations(40);
    if (!report.supported) {
      return "GoHighLevel did not expose reliable unread counts for conversations, so I cannot answer unread-message insights from this API response.";
    }
    return formatInsightTable(
      "Conversations with unread messages",
      report.conversations.map((c) => ({
        Contact: c.contactId,
        Unread: c.unreadCount,
        Preview: c.lastMessageBody?.slice(0, 80) ?? null,
      })),
    );
  }

  return "Insight type not supported.";
}

/** Used by tests / diagnostics without hitting write paths. */
export async function peekGhlContact(contactId: string) {
  return getContactById(contactId);
}

export async function peekGhlOpportunity(opportunityId: string) {
  return getOpportunityById(opportunityId);
}
