import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import { listRecentContacts } from "@/lib/connectors/ghl/resources/contacts";
import {
  listOpportunitiesByContact,
  listOpenOpportunities,
} from "@/lib/connectors/ghl/resources/opportunities";
import { listPipelines, getPipelineById } from "@/lib/connectors/ghl/resources/pipelines";
import { listUpcomingEvents } from "@/lib/connectors/ghl/resources/calendars";
import { listConversationsForContact } from "@/lib/connectors/ghl/resources/conversations";
import type {
  GhlEvidenceSource,
  GhlContact,
  GhlOpportunity,
  GhlPipeline,
  GhlCalendarEvent,
  GhlConversation,
} from "@/lib/connectors/ghl/types";
import {
  createContactEvidenceSource,
  createOpportunityEvidenceSource,
  createPipelineEvidenceSource,
  createCalendarEventEvidenceSource,
  createConversationEvidenceSource,
} from "./evidence";
import { detectGhlIntent, type GhlIntentDetection } from "@/lib/baxter-ai/ghl-intent";
import { resolveContact, resolveOpportunity } from "./resolve";

export type GhlContextResult = {
  hasData: boolean;
  contextText: string;
  evidenceSources: GhlEvidenceSource[];
  citations: string[];
  ambiguityWarning?: string;
  intent: GhlIntentDetection;
};

/**
 * Build GHL context for a Baxter question.
 * Returns formatted context text and evidence sources for citations.
 */
export async function buildGhlContext(question: string): Promise<GhlContextResult> {
  if (!isGhlConfigured()) {
    return {
      hasData: false,
      contextText: "",
      evidenceSources: [],
      citations: [],
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

  if (intent.intent === "none" || intent.confidence < 0.5) {
    return {
      hasData: false,
      contextText: "",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  try {
    switch (intent.intent) {
      case "contact_lookup":
        return buildContactContext(intent);
      case "contact_list":
        return buildContactListContext(intent);
      case "opportunity_lookup":
        return buildOpportunityContext(intent);
      case "opportunity_list":
        return buildOpportunityListContext(intent);
      case "pipeline_info":
        return buildPipelineContext(intent);
      case "calendar_query":
        return buildCalendarContext(intent);
      case "conversation_lookup":
        return buildConversationContext(intent);
      case "write_contact":
      case "write_opportunity":
      case "write_tag":
        // For write intents, still gather read context for confirmation
        return buildWriteContext(intent);
      case "general_crm":
      default:
        return buildGeneralCrmContext(intent);
    }
  } catch (error) {
    console.error("Error building GHL context:", error);
    return {
      hasData: false,
      contextText: "",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }
}

async function buildContactContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const { contactName, contactEmail, contactPhone } = intent.entities;

  const result = await resolveContact({
    name: contactName,
    email: contactEmail,
    phone: contactPhone,
  });

  if (result.ambiguous && result.candidates) {
    return {
      hasData: true,
      contextText: formatContactListContext(result.candidates),
      evidenceSources: result.candidates.map((c) =>
        createContactEvidenceSource(
          c.id,
          c.name,
          `Contact match for "${contactName || contactEmail || contactPhone}"`,
        ),
      ),
      citations: result.candidates.map((c) => `GoHighLevel — ${c.name || c.email} contact`),
      ambiguityWarning: result.ambiguityMessage,
      intent,
    };
  }

  if (!result.resolved || !result.entity) {
    return {
      hasData: false,
      contextText: `No contact found matching "${contactName || contactEmail || contactPhone}".`,
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const contact = result.entity;
  const contextText = formatContactContext(contact);
  const evidenceSource = createContactEvidenceSource(
    contact.id,
    contact.name,
    `Full contact details for ${contact.name || contact.email}`,
  );

  // Also fetch related opportunities
  let opportunitiesContext = "";
  const opportunities = await listOpportunitiesByContact(contact.id).catch(
    () => [] as GhlOpportunity[],
  );
  if (opportunities.length > 0) {
    opportunitiesContext =
      `\n\nRelated Opportunities (${opportunities.length}):\n` +
      opportunities
        .map(
          (o: GhlOpportunity) =>
            `- ${o.name || "Unnamed"}: ${o.status} ($${(o.monetaryValue || 0).toLocaleString()})`,
        )
        .join("\n");
  }

  return {
    hasData: true,
    contextText: contextText + opportunitiesContext,
    evidenceSources: [
      evidenceSource,
      ...opportunities.map((o: GhlOpportunity) => createOpportunityEvidenceSource(o.id, o.name)),
    ],
    citations: [
      `GoHighLevel — ${contact.name || contact.email} contact`,
      ...opportunities.map((o: GhlOpportunity) => `GoHighLevel — ${o.name || "opportunity"}`),
    ],
    intent,
  };
}

async function buildContactListContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const contacts = await listRecentContacts(10);

  if (contacts.length === 0) {
    return {
      hasData: false,
      contextText: "No contacts found.",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  return {
    hasData: true,
    contextText: formatContactListContext(contacts),
    evidenceSources: contacts.map((c: GhlContact) => createContactEvidenceSource(c.id, c.name)),
    citations: contacts.map((c: GhlContact) => `GoHighLevel — ${c.name || c.email} contact`),
    intent,
  };
}

async function buildOpportunityContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const { opportunityName, contactName } = intent.entities;

  const result = await resolveOpportunity({
    opportunityName,
    contactName,
  });

  if (result.ambiguous && result.candidates) {
    return {
      hasData: true,
      contextText: formatOpportunityListContext(result.candidates),
      evidenceSources: result.candidates.map((o) => createOpportunityEvidenceSource(o.id, o.name)),
      citations: result.candidates.map((o) => `GoHighLevel — ${o.name || "opportunity"}`),
      ambiguityWarning: result.ambiguityMessage,
      intent,
    };
  }

  if (!result.resolved || !result.entity) {
    return {
      hasData: false,
      contextText: `No opportunity found matching "${opportunityName || contactName}".`,
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const opportunity = result.entity;
  const contextText = await formatOpportunityContext(opportunity);

  return {
    hasData: true,
    contextText,
    evidenceSources: [createOpportunityEvidenceSource(opportunity.id, opportunity.name)],
    citations: [`GoHighLevel — ${opportunity.name || "opportunity"}`],
    intent,
  };
}

async function buildOpportunityListContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const { stageName } = intent.entities;

  let opportunities: GhlOpportunity[];
  if (stageName) {
    // Filter by stage would require pipeline lookup
    opportunities = await listOpenOpportunities(20);
    // TODO: Filter by stage name
  } else {
    opportunities = await listOpenOpportunities(10);
  }

  if (opportunities.length === 0) {
    return {
      hasData: false,
      contextText: "No open opportunities found.",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  return {
    hasData: true,
    contextText: formatOpportunityListContext(opportunities),
    evidenceSources: opportunities.map((o) => createOpportunityEvidenceSource(o.id, o.name)),
    citations: opportunities.map((o) => `GoHighLevel — ${o.name || "opportunity"}`),
    intent,
  };
}

async function buildPipelineContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const pipelines = await listPipelines();

  if (pipelines.length === 0) {
    return {
      hasData: false,
      contextText: "No pipelines configured.",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  type PipelineStage = { id: string; name?: string };
  const contextParts: string[] = [];
  const evidenceSources: GhlEvidenceSource[] = [];
  const citations: string[] = [];

  for (const pipeline of pipelines) {
    const stages = (pipeline.stages || []) as PipelineStage[];
    contextParts.push(
      `Pipeline: ${pipeline.name}\nStages: ${stages.map((s: PipelineStage) => s.name).join(" → ")}`,
    );
    evidenceSources.push(createPipelineEvidenceSource(pipeline.id, pipeline.name));
    citations.push(`GoHighLevel — ${pipeline.name} pipeline`);
  }

  return {
    hasData: true,
    contextText: contextParts.join("\n\n"),
    evidenceSources,
    citations,
    intent,
  };
}

async function buildCalendarContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const events = await listUpcomingEvents(10).catch(() => [] as GhlCalendarEvent[]);

  if (events.length === 0) {
    return {
      hasData: false,
      contextText: "No upcoming calendar events found.",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const contextParts = events.map((e: GhlCalendarEvent) => {
    const start = e.startTime ? new Date(e.startTime).toLocaleString() : "Unknown time";
    return `- ${e.title || "Untitled event"}: ${start}`;
  });

  return {
    hasData: true,
    contextText: `Upcoming Events:\n${contextParts.join("\n")}`,
    evidenceSources: events.map((e: GhlCalendarEvent) =>
      createCalendarEventEvidenceSource(e.id, e.title),
    ),
    citations: events.map((e: GhlCalendarEvent) => `GoHighLevel — ${e.title || "calendar event"}`),
    intent,
  };
}

async function buildConversationContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  const { contactName } = intent.entities;

  if (!contactName) {
    return {
      hasData: false,
      contextText: "Please specify a contact name to look up conversations.",
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const contactResult = await resolveContact({ name: contactName });
  if (!contactResult.resolved || !contactResult.entity) {
    return {
      hasData: false,
      contextText: `No contact found matching "${contactName}".`,
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const conversations = await listConversationsForContact(contactResult.entity.id, {
    limit: 5,
  }).catch(() => [] as GhlConversation[]);

  if (conversations.length === 0) {
    return {
      hasData: false,
      contextText: `No conversations found for ${contactResult.entity.name}.`,
      evidenceSources: [],
      citations: [],
      intent,
    };
  }

  const contextParts = conversations.map((c: GhlConversation) => {
    const lastMessage = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : "Unknown";
    return `- ${c.type || "Unknown type"}: Last message ${lastMessage}`;
  });

  return {
    hasData: true,
    contextText: `Conversations with ${contactResult.entity.name}:\n${contextParts.join("\n")}`,
    evidenceSources: conversations.map((c: GhlConversation) =>
      createConversationEvidenceSource(c.id, `Conversation with ${contactResult.entity!.name}`),
    ),
    citations: conversations.map(
      () => `GoHighLevel — conversation with ${contactResult.entity!.name}`,
    ),
    intent,
  };
}

async function buildWriteContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  // For write intents, we gather read context to show what will be modified
  const { contactName, opportunityName } = intent.entities;

  if (intent.intent === "write_contact" || intent.intent === "write_tag") {
    if (contactName) {
      const result = await buildContactContext({
        ...intent,
        intent: "contact_lookup",
      });
      result.intent = intent;
      return result;
    }
  }

  if (intent.intent === "write_opportunity") {
    if (opportunityName || contactName) {
      const result = await buildOpportunityContext({
        ...intent,
        intent: "opportunity_lookup",
      });
      result.intent = intent;
      return result;
    }
  }

  return {
    hasData: false,
    contextText: "Please specify the contact or opportunity to modify.",
    evidenceSources: [],
    citations: [],
    intent,
  };
}

async function buildGeneralCrmContext(intent: GhlIntentDetection): Promise<GhlContextResult> {
  // For general CRM queries, provide summary stats
  const [pipelines, recentContacts, openOpportunities] = await Promise.all([
    listPipelines().catch(() => [] as GhlPipeline[]),
    listRecentContacts(5).catch(() => [] as GhlContact[]),
    listOpenOpportunities(5).catch(() => [] as GhlOpportunity[]),
  ]);

  const contextParts: string[] = [];
  const evidenceSources: GhlEvidenceSource[] = [];
  const citations: string[] = [];

  if (pipelines.length > 0) {
    contextParts.push(`Pipelines: ${pipelines.map((p: GhlPipeline) => p.name).join(", ")}`);
    evidenceSources.push(
      ...pipelines.map((p: GhlPipeline) => createPipelineEvidenceSource(p.id, p.name)),
    );
    citations.push(...pipelines.map((p: GhlPipeline) => `GoHighLevel — ${p.name} pipeline`));
  }

  if (openOpportunities.length > 0) {
    contextParts.push(`Open Opportunities: ${openOpportunities.length}`);
    const totalValue = openOpportunities.reduce(
      (sum: number, o: GhlOpportunity) => sum + (o.monetaryValue || 0),
      0,
    );
    contextParts.push(`Total Pipeline Value: $${totalValue.toLocaleString()}`);
  }

  if (recentContacts.length > 0) {
    contextParts.push(
      `Recent Contacts: ${recentContacts.map((c: GhlContact) => c.name || c.email).join(", ")}`,
    );
  }

  return {
    hasData: contextParts.length > 0,
    contextText: contextParts.join("\n"),
    evidenceSources,
    citations,
    intent,
  };
}

function formatContactContext(contact: GhlContact): string {
  const parts: string[] = [
    `Contact: ${contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim()}`,
  ];

  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  if (contact.address1 || contact.city || contact.state) {
    const address = [contact.address1, contact.city, contact.state, contact.postalCode]
      .filter(Boolean)
      .join(", ");
    if (address) parts.push(`Address: ${address}`);
  }
  if (contact.source) parts.push(`Source: ${contact.source}`);
  if (contact.tags && contact.tags.length > 0) {
    parts.push(`Tags: ${contact.tags.join(", ")}`);
  }
  if (contact.dateAdded) {
    parts.push(`Added: ${new Date(contact.dateAdded).toLocaleDateString()}`);
  }

  return parts.join("\n");
}

function formatContactListContext(contacts: GhlContact[]): string {
  return contacts
    .map((c) => {
      const parts = [c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim()];
      if (c.email) parts.push(`<${c.email}>`);
      if (c.companyName) parts.push(`(${c.companyName})`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

async function formatOpportunityContext(opportunity: GhlOpportunity): Promise<string> {
  const parts: string[] = [
    `Opportunity: ${opportunity.name || "Unnamed"}`,
    `Status: ${opportunity.status || "Unknown"}`,
    `Value: $${(opportunity.monetaryValue || 0).toLocaleString()}`,
  ];

  // Get pipeline and stage names
  if (opportunity.pipelineId) {
    try {
      const pipeline = await getPipelineById(opportunity.pipelineId);
      if (pipeline) {
        parts.push(`Pipeline: ${pipeline.name}`);
        type PipelineStage = { id: string; name?: string };
        const stages = (pipeline.stages || []) as PipelineStage[];
        const stage = stages.find((s: PipelineStage) => s.id === opportunity.pipelineStageId);
        if (stage) {
          parts.push(`Stage: ${stage.name}`);
        }
      }
    } catch {
      // Ignore pipeline lookup errors
    }
  }

  if (opportunity.source) parts.push(`Source: ${opportunity.source}`);
  if (opportunity.dateAdded) {
    parts.push(`Created: ${new Date(opportunity.dateAdded).toLocaleDateString()}`);
  }

  return parts.join("\n");
}

function formatOpportunityListContext(opportunities: GhlOpportunity[]): string {
  return opportunities
    .map((o) => {
      const value = o.monetaryValue ? `$${o.monetaryValue.toLocaleString()}` : "No value";
      return `- ${o.name || "Unnamed"}: ${o.status || "Unknown"} (${value})`;
    })
    .join("\n");
}
