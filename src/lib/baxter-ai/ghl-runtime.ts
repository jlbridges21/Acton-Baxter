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
export async function retrieveGhlLiveEvidence(
  question: string,
  options: {
    activeGhl?: import("@/lib/baxter-data/ghl/conversation-state").GhlConversationContext | null;
  } = {},
): Promise<{
  items: BaxterContextItem[];
  contextText: string;
  ambiguityWarning?: string;
  intent: GhlIntentDetection;
  handledInsight?: boolean;
  deterministicAnswer?: string | null;
  nextConversationState?:
    import("@/lib/baxter-data/ghl/conversation-state").GhlConversationContext | null;
  diagnostics?: {
    query: string;
    intent: string;
    entityType: "contact" | "none";
    resolvedContactName: string | null;
    requestedField: string | null;
    requestedFields: string[];
    ghlContactSearchAttempted: boolean;
    matchesFound: number;
    selectedContactId: string | null;
    resolutionMethod: string | null;
    activeEntityInherited: boolean;
    fullContactHydrated: boolean | null;
    addressPresent: boolean | null;
    explicitGhl: boolean;
    opportunitiesFound: number;
    selectedOpportunityId: string | null;
    pipelineResolved: string | null;
    stageResolved: string | null;
    completeness: { requested: number; found: number } | null;
  };
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

  const { buildGhlQueryPlan } = await import("@/lib/baxter-data/ghl/query-plan");
  const { buildGhlConversationContext } = await import("@/lib/baxter-data/ghl/conversation-state");
  const { detectRequestedGhlFields, isContactField, isOpportunityField } =
    await import("@/lib/baxter-data/ghl/field-aliases");

  const plan = buildGhlQueryPlan({
    question,
    activeGhl: options.activeGhl ?? null,
  });
  const intent = detectGhlIntent(question);
  const effectiveIntent: GhlIntentDetection = {
    ...intent,
    intent:
      plan.intent === "conversation_lookup"
        ? "conversation_lookup"
        : plan.intent === "opportunity_lookup"
          ? "opportunity_lookup"
          : plan.intent === "contact_lookup"
            ? "contact_lookup"
            : intent.intent,
    entities: {
      ...intent.entities,
      contactName: plan.entityName || intent.entities.contactName,
      contactEmail: plan.entityEmail || intent.entities.contactEmail,
      contactPhone: plan.entityPhone || intent.entities.contactPhone,
      requestedField:
        plan.primaryField === "pipeline" || plan.primaryField === "value"
          ? "stage"
          : plan.primaryField === "email" ||
              plan.primaryField === "phone" ||
              plan.primaryField === "address" ||
              plan.primaryField === "city" ||
              plan.primaryField === "owner" ||
              plan.primaryField === "tags" ||
              plan.primaryField === "source" ||
              plan.primaryField === "stage"
            ? plan.primaryField
            : intent.entities.requestedField,
    },
  };
  const requestedFields = plan.requestedFields.length
    ? plan.requestedFields
    : detectRequestedGhlFields(question);
  const requestedField = effectiveIntent.entities.requestedField ?? null;

  if (plan.needsEntityClarification) {
    const clarify =
      plan.primaryField === "email"
        ? "Whose email address do you mean?"
        : plan.primaryField === "phone"
          ? "Whose phone number do you mean?"
          : plan.primaryField === "address"
            ? "Whose address do you mean?"
            : plan.intent === "opportunity_lookup"
              ? "Whose opportunity stage do you mean?"
              : "Which contact should I look up in GoHighLevel?";
    return {
      items: [],
      contextText: "",
      intent: effectiveIntent,
      deterministicAnswer: clarify,
      diagnostics: {
        query: question.slice(0, 80),
        intent: String(plan.intent),
        entityType: "none",
        resolvedContactName: null,
        requestedField,
        requestedFields,
        ghlContactSearchAttempted: false,
        matchesFound: 0,
        selectedContactId: null,
        resolutionMethod: plan.diagnostics.resolutionMethod,
        activeEntityInherited: false,
        fullContactHydrated: null,
        addressPresent: null,
        explicitGhl: Boolean(intent.explicitGhl),
        opportunitiesFound: 0,
        selectedOpportunityId: null,
        pipelineResolved: null,
        stageResolved: null,
        completeness: null,
      },
    };
  }

  if (plan.intent === "conversation_lookup" || effectiveIntent.intent === "conversation_lookup") {
    const {
      lookupGhlConversationMessages,
      inferConversationLookupFilters,
      formatGhlMessageEvidence,
      buildDeterministicConversationAnswer,
      extractConversationContactQuery,
    } = await import("@/lib/baxter-data/ghl/conversation-lookup");
    const filters = inferConversationLookupFilters(question);
    const contactQuery =
      plan.entityEmail ||
      plan.entityPhone ||
      plan.entityName ||
      effectiveIntent.entities.contactEmail ||
      effectiveIntent.entities.contactPhone ||
      effectiveIntent.entities.contactName ||
      extractConversationContactQuery(question) ||
      "";

    if (!contactQuery.trim()) {
      return {
        items: [],
        contextText: "",
        intent: effectiveIntent,
        deterministicAnswer:
          "Which contact should I look up in GoHighLevel? Share a name, email, or phone.",
        diagnostics: {
          query: question.slice(0, 80),
          intent: "conversation_lookup",
          entityType: "none",
          resolvedContactName: null,
          requestedField: "conversation",
          requestedFields,
          ghlContactSearchAttempted: false,
          matchesFound: 0,
          selectedContactId: null,
          resolutionMethod: plan.diagnostics.resolutionMethod,
          activeEntityInherited: plan.followupEntityInherited,
          fullContactHydrated: null,
          addressPresent: null,
          explicitGhl: Boolean(intent.explicitGhl),
          opportunitiesFound: 0,
          selectedOpportunityId: null,
          pipelineResolved: null,
          stageResolved: null,
          completeness: null,
        },
      };
    }

    const lookup = await lookupGhlConversationMessages({
      contactQuery: contactQuery.trim(),
      channel: filters.channel,
      direction: filters.direction,
      limit: /\brecent\b/i.test(question) ? 5 : 1,
      maxConversations: 8,
      messagesPerConversation: 40,
    });

    console.info("[GHL conversation lookup]", JSON.stringify({ ...lookup.diagnostics }));

    if (lookup.ambiguityMessage) {
      return {
        items: [],
        contextText: "",
        ambiguityWarning: lookup.ambiguityMessage,
        intent: effectiveIntent,
        diagnostics: {
          query: contactQuery,
          intent: "conversation_lookup",
          entityType: "contact",
          resolvedContactName: null,
          requestedField: "conversation",
          requestedFields,
          ghlContactSearchAttempted: true,
          matchesFound: 2,
          selectedContactId: null,
          resolutionMethod: plan.diagnostics.resolutionMethod,
          activeEntityInherited: plan.followupEntityInherited,
          fullContactHydrated: null,
          addressPresent: null,
          explicitGhl: Boolean(intent.explicitGhl),
          opportunitiesFound: 0,
          selectedOpportunityId: null,
          pipelineResolved: null,
          stageResolved: null,
          completeness: null,
        },
      };
    }

    if (!lookup.ok || !lookup.selected || !lookup.contact) {
      const failure =
        lookup.failureMessage ||
        `I couldn’t retrieve a matching conversation message for “${contactQuery}” in GoHighLevel.`;
      return {
        items: [],
        contextText: failure,
        intent: effectiveIntent,
        deterministicAnswer: failure,
        diagnostics: {
          query: contactQuery,
          intent: "conversation_lookup",
          entityType: lookup.contact ? "contact" : "none",
          resolvedContactName:
            lookup.contact?.name ||
            [lookup.contact?.firstName, lookup.contact?.lastName].filter(Boolean).join(" ") ||
            null,
          requestedField: "conversation",
          requestedFields,
          ghlContactSearchAttempted: true,
          matchesFound: lookup.contact ? 1 : 0,
          selectedContactId: lookup.contact?.id ?? null,
          resolutionMethod: plan.diagnostics.resolutionMethod,
          activeEntityInherited: plan.followupEntityInherited,
          fullContactHydrated: lookup.contact ? true : null,
          addressPresent: null,
          explicitGhl: Boolean(intent.explicitGhl),
          opportunitiesFound: 0,
          selectedOpportunityId: null,
          pipelineResolved: null,
          stageResolved: null,
          completeness: null,
        },
      };
    }

    const contactName =
      lookup.contact.name ||
      [lookup.contact.firstName, lookup.contact.lastName].filter(Boolean).join(" ") ||
      contactQuery;
    const evidenceText = formatGhlMessageEvidence(lookup.selected, contactName);
    const answer = buildDeterministicConversationAnswer({
      question,
      contactName,
      contactEmail: lookup.contact.email,
      message: lookup.selected,
    });
    const channelLabel =
      filters.channel === "email"
        ? "Email"
        : filters.channel === "sms"
          ? "SMS"
          : filters.channel === "call"
            ? "Call"
            : lookup.selected.fromConversationSummary
              ? "Conversation"
              : "Message";

    const nextConversationState = buildGhlConversationContext({
      contact: {
        id: lookup.contact.id,
        displayName: contactName,
        email: lookup.contact.email,
        setAt: new Date().toISOString(),
      },
      opportunity: options.activeGhl?.opportunity ?? null,
      lastRequestedFields: requestedFields,
    });

    return {
      items: [
        {
          number: 1,
          id: lookup.selected.id,
          title: `GoHighLevel — ${contactName} — ${channelLabel}`,
          summary: null,
          contentExcerpt: evidenceText.slice(0, 1600),
          category: "GoHighLevel",
          tags: ["gohighlevel", "conversation", filters.channel],
          sourceName: "GoHighLevel",
          sourceUrl: null,
          sourceType: "GoHighLevel",
          mimeType: null,
          updatedAt: lookup.selected.dateAdded || new Date().toISOString(),
          citationLabel: `GoHighLevel — ${contactName} — ${channelLabel}`,
          relevanceScore: 0.99,
        },
      ],
      contextText: evidenceText,
      intent: effectiveIntent,
      deterministicAnswer: answer,
      nextConversationState,
      diagnostics: {
        query: contactQuery,
        intent: "conversation_lookup",
        entityType: "contact",
        resolvedContactName: contactName,
        requestedField: "conversation",
        requestedFields,
        ghlContactSearchAttempted: true,
        matchesFound: 1,
        selectedContactId: lookup.contact.id,
        resolutionMethod: plan.diagnostics.resolutionMethod,
        activeEntityInherited: plan.followupEntityInherited,
        fullContactHydrated: true,
        addressPresent: null,
        explicitGhl: Boolean(intent.explicitGhl),
        opportunitiesFound: 0,
        selectedOpportunityId: null,
        pipelineResolved: null,
        stageResolved: null,
        completeness: null,
      },
    };
  }

  if (String(effectiveIntent.intent).startsWith("insight_")) {
    const insightText = await runInsightReport(effectiveIntent).catch(
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
      intent: effectiveIntent,
      handledInsight: true,
    };
  }

  const name =
    plan.entityName ||
    plan.entityEmail ||
    plan.entityPhone ||
    effectiveIntent.entities.contactName ||
    effectiveIntent.entities.opportunityName ||
    effectiveIntent.entities.contactEmail ||
    effectiveIntent.entities.contactPhone;

  const forceEntityGraph =
    Boolean(name || plan.entityContactId) &&
    (intent.explicitGhl ||
      plan.intent === "contact_lookup" ||
      plan.intent === "opportunity_lookup" ||
      effectiveIntent.intent === "contact_lookup" ||
      effectiveIntent.intent === "opportunity_lookup" ||
      effectiveIntent.intent === "general_crm" ||
      effectiveIntent.intent === "calendar_query" ||
      requestedFields.some((f) => isContactField(f) || isOpportunityField(f)));

  if ((name || plan.entityContactId) && forceEntityGraph) {
    const { resolveGhlEntityGraph, formatCustomerSnapshot } =
      await import("@/lib/connectors/ghl/entity-graph");
    const {
      buildDeterministicGhlContactFieldAnswer,
      buildDeterministicGhlOpportunityAnswer,
      contactAddressFromGhl,
      isContactLevelGhlQuestion,
    } = await import("@/lib/connectors/ghl/address");
    const { STAGE_QUESTION_RANK_POLICY } = await import("@/lib/connectors/ghl/opportunity-ranking");

    const wantsOpp =
      requestedFields.some(isOpportunityField) || plan.intent === "opportunity_lookup";
    const graph = await resolveGhlEntityGraph(name || plan.entityContactId || "", {
      includeAppointments: false,
      includeConversations: false,
      contactId: plan.entityContactId || undefined,
      opportunityRankPolicy: wantsOpp ? STAGE_QUESTION_RANK_POLICY : undefined,
    }).catch(() => null);

    if (graph?.contact && plan.entityContactId && graph.contact.id !== plan.entityContactId) {
      return {
        items: [],
        contextText: "",
        intent: effectiveIntent,
        deterministicAnswer: `I couldn’t find a GHL contact matching ${plan.entityName || "that person"}.`,
        diagnostics: {
          query: name || "",
          intent: String(plan.intent),
          entityType: "none",
          resolvedContactName: null,
          requestedField,
          requestedFields,
          ghlContactSearchAttempted: true,
          matchesFound: 0,
          selectedContactId: null,
          resolutionMethod: "entity_id_mismatch",
          activeEntityInherited: plan.followupEntityInherited,
          fullContactHydrated: null,
          addressPresent: null,
          explicitGhl: Boolean(intent.explicitGhl),
          opportunitiesFound: 0,
          selectedOpportunityId: null,
          pipelineResolved: null,
          stageResolved: null,
          completeness: null,
        },
      };
    }

    const address = graph?.contact ? contactAddressFromGhl(graph.contact) : null;
    const selectedOpp = graph?.opportunities[0] ?? null;
    const contactName =
      graph?.contact?.name ||
      [graph?.contact?.firstName, graph?.contact?.lastName].filter(Boolean).join(" ") ||
      plan.entityName ||
      name ||
      null;

    const contactFields = requestedFields.filter(
      (f) => f === "email" || f === "phone" || f === "address",
    );
    let foundCount = 0;
    if (graph?.contact) {
      if (contactFields.includes("email") && graph.contact.email?.trim()) foundCount += 1;
      if (contactFields.includes("phone") && graph.contact.phone?.trim()) foundCount += 1;
      if (contactFields.includes("address") && address?.hasStreet) foundCount += 1;
    }

    const diagnostics = {
      query: name || plan.entityContactId || "",
      intent: String(plan.intent),
      entityType: (graph?.contact ? "contact" : "none") as "contact" | "none",
      resolvedContactName: contactName,
      requestedField,
      requestedFields,
      ghlContactSearchAttempted: true,
      matchesFound: graph?.ambiguous ? 2 : graph?.contact ? 1 : 0,
      selectedContactId: graph?.contact?.id ?? null,
      resolutionMethod: plan.entityContactId ? "contact_id" : plan.diagnostics.resolutionMethod,
      activeEntityInherited: plan.followupEntityInherited,
      fullContactHydrated: graph?.contact ? true : null,
      addressPresent: address ? address.present : null,
      explicitGhl: Boolean(intent.explicitGhl),
      opportunitiesFound: graph?.opportunities.length ?? 0,
      selectedOpportunityId: selectedOpp?.opportunity.id ?? null,
      pipelineResolved: selectedOpp?.pipelineName ?? null,
      stageResolved: selectedOpp?.stageName ?? null,
      completeness: contactFields.length
        ? { requested: contactFields.length, found: foundCount }
        : wantsOpp
          ? {
              requested: 1,
              found: selectedOpp?.stageName || selectedOpp?.pipelineName ? 1 : 0,
            }
          : null,
    };

    console.info("[GHL entity resolution]", JSON.stringify({ ...diagnostics }));

    if (graph?.ambiguous) {
      return {
        items: [],
        contextText: "",
        ambiguityWarning: graph.clarificationMessage ?? undefined,
        intent: effectiveIntent,
        diagnostics,
      };
    }

    if (!graph?.contact) {
      return {
        items: [],
        contextText: "",
        intent: effectiveIntent,
        deterministicAnswer: `I couldn’t find a GHL contact matching ${plan.entityName || name || "that person"}.`,
        diagnostics,
      };
    }

    const snapshot = formatCustomerSnapshot(graph, { question });
    const ambiguityWarning =
      graph.opportunityAmbiguous &&
      graph.clarificationMessage &&
      !isContactLevelGhlQuestion(question) &&
      wantsOpp
        ? graph.clarificationMessage
        : undefined;

    let deterministicAnswer: string | null = null;
    if (!ambiguityWarning) {
      if (wantsOpp) {
        if (!selectedOpp) {
          deterministicAnswer = `I found ${contactName} in GHL, but I didn’t find an opportunity tied to that contact.`;
        } else {
          deterministicAnswer = buildDeterministicGhlOpportunityAnswer({
            contactName: contactName || "This contact",
            pipelineName: selectedOpp.pipelineName,
            stageName: selectedOpp.stageName,
            requestedFields,
          });
        }
      } else {
        deterministicAnswer = buildDeterministicGhlContactFieldAnswer(
          question,
          graph.contact,
          requestedFields,
        );
      }
    }

    const citationPipeline =
      wantsOpp && selectedOpp?.pipelineName ? ` — ${selectedOpp.pipelineName}` : "";
    const nextConversationState = buildGhlConversationContext({
      contact: {
        id: graph.contact.id,
        displayName: contactName || graph.contact.id,
        email: graph.contact.email,
        setAt: new Date().toISOString(),
      },
      opportunity: selectedOpp
        ? {
            id: selectedOpp.opportunity.id,
            pipelineId: selectedOpp.opportunity.pipelineId,
            pipelineName: selectedOpp.pipelineName,
            stageId: selectedOpp.opportunity.pipelineStageId,
            stageName: selectedOpp.stageName,
            setAt: new Date().toISOString(),
          }
        : (options.activeGhl?.opportunity ?? null),
      lastRequestedFields: requestedFields,
    });

    return {
      items: [
        {
          number: 1,
          id: graph.contact.id,
          title: `GoHighLevel — ${contactName || name}`,
          summary: null,
          contentExcerpt: snapshot.slice(0, 1600),
          category: "GoHighLevel",
          tags: ["gohighlevel", "contact"],
          sourceName: "GoHighLevel",
          sourceUrl: null,
          sourceType: "GoHighLevel",
          mimeType: null,
          updatedAt: graph.retrievedAt,
          citationLabel: `GoHighLevel — ${contactName || name}${citationPipeline}`,
          relevanceScore: 0.95,
        },
      ],
      contextText: snapshot,
      ambiguityWarning,
      intent: effectiveIntent,
      deterministicAnswer,
      nextConversationState,
      diagnostics,
    };
  }

  const result = await buildGhlContext(question).catch(() => null);
  if (!result || !result.hasData) {
    return {
      items: [],
      contextText: "",
      intent: result?.intent ?? effectiveIntent,
      ambiguityWarning: result?.ambiguityWarning,
      diagnostics: {
        query: name || question.slice(0, 80),
        intent: String(plan.intent),
        entityType: "none",
        resolvedContactName: null,
        requestedField,
        requestedFields,
        ghlContactSearchAttempted: Boolean(name),
        matchesFound: 0,
        selectedContactId: null,
        resolutionMethod: plan.diagnostics.resolutionMethod,
        activeEntityInherited: plan.followupEntityInherited,
        fullContactHydrated: null,
        addressPresent: null,
        explicitGhl: Boolean(intent.explicitGhl),
        opportunitiesFound: 0,
        selectedOpportunityId: null,
        pipelineResolved: null,
        stageResolved: null,
        completeness: null,
      },
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
