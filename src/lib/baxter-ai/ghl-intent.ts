import "server-only";

/**
 * GHL Intent Detection for Baxter AI.
 * Detects when a user question requires CRM data from GoHighLevel.
 */

import {
  detectRequestedGhlFields,
  primaryRequestedField,
} from "@/lib/baxter-data/ghl/field-aliases";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import { isPlausibleCrmEntityCandidate } from "@/lib/baxter-ai/evidence-registry/entity-plausibility";

export type GhlIntentType =
  | "contact_lookup" // "Who is John Smith?" / "Find contact for jane@example.com"
  | "contact_list" // "Show me all contacts tagged as 'hot lead'"
  | "opportunity_lookup" // "What's the status of the ADU project for the Smiths?"
  | "opportunity_list" // "What opportunities are in the proposal stage?"
  | "pipeline_info" // "What are the stages in our sales pipeline?"
  | "calendar_query" // "What meetings do I have today?"
  | "conversation_lookup" // "What's the last message from John?"
  | "user_lookup" // "Who is assigned to this contact?"
  | "write_contact" // "Update John's phone number to..."
  | "write_opportunity" // "Mark the Smith opportunity as won"
  | "write_tag" // "Add the 'VIP' tag to John Smith"
  | "insight_unowned" // open opportunities without owner
  | "insight_stale" // stale opportunities
  | "insight_appointments" // appointments this week/today
  | "insight_unread" // unread conversations if supported
  | "general_crm" // Generic CRM question
  | "none"; // Not CRM related

export type GhlIntentDetection = {
  intent: GhlIntentType;
  confidence: number; // 0-1
  entities: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    opportunityName?: string;
    pipelineName?: string;
    stageName?: string;
    tagName?: string;
    userId?: string;
    dateRange?: { start?: string; end?: string };
    requestedField?:
      "address" | "phone" | "email" | "city" | "owner" | "tags" | "source" | "stage" | "other";
  };
  isWriteIntent: boolean;
  requiresConfirmation: boolean;
  /** True when the user explicitly named GHL / CRM / GoHighLevel. */
  explicitGhl?: boolean;
};

const CRM_KEYWORDS = [
  "contact",
  "lead",
  "prospect",
  "customer",
  "client",
  "opportunity",
  "deal",
  "pipeline",
  "stage",
  "calendar",
  "appointment",
  "meeting",
  "conversation",
  "message",
  "crm",
  "gohighlevel",
  "ghl",
  "assigned",
  "owner",
  "tag",
  "tagged",
];

const WRITE_KEYWORDS = [
  "update",
  "change",
  "modify",
  "set",
  "mark",
  "move",
  "add tag",
  "remove tag",
  "assign",
  "reassign",
];

/** Normalize curly quotes/apostrophes so possessive patterns match Slack/iOS text. */
export function normalizeGhlQuestionText(question: string): string {
  return question
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip trailing possessive ('s) so "Stanley Quan's" → "Stanley Quan". */
export function stripContactNamePossessive(name: string): string {
  return name
    .replace(/['\u2019]s\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// email address before bare address so "email address" never captures as street address
const CONTACT_FIELD =
  "e-?mail\\s+address|phone(?:\\s+number)?|e-?mail|mobile|cell|(?:full\\s+)?(?:street\\s+|home\\s+|mailing\\s+)?address|city|zip(?:\\s*code)?|postal(?:\\s*code)?|tags?|owner";

const LOOKUP_PATTERNS = [
  /who\s+is\s+(\w+(?:\s+\w+)?)/i,
  /find\s+(?:contact|lead|customer)\s+(?:for\s+)?(.+)/i,
  /look\s*up\s+(.+)/i,
  /show\s+me\s+(.+?)(?:'s|s')?\s+(?:info|details|contact)/i,
  // ASCII + already-normalized curly apostrophes
  new RegExp(String.raw`what(?:'s|\s+is)\s+(.+?)(?:'s|\s+)?\s*(?:${CONTACT_FIELD}|status)`, "i"),
  /what\s+city\s+is\s+(.+?)\s+in\b/i,
  /what\s+(?:email|phone(?:\s+number)?|address)\s+(?:do\s+we\s+have\s+)?(?:for|of)\s+(.+)/i,
  /contact\s+info(?:rmation)?\s+for\s+(.+)/i,
  /\b(?:give|get|show|tell)\s+(?:me\s+)?(?:more\s+)?(?:information|info|details)\s+(?:about|on|for)\s+(?:the\s+)?(.+)/i,
  /\b(?:information|info|details)\s+(?:about|on|for)\s+(?:the\s+)?(.+)/i,
  // Leading CRM descriptors: require ≥2 name tokens (avoid "customer story" / "customer center")
  /\b(?:the\s+)?(?:customer|contact|client|lead)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){1,3})\b/i,
  /\b(?:the\s+)?([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){1,3})\s+(?:account|record|file)\b/i,
  // Explicit GHL / CRM search phrasing
  new RegExp(
    String.raw`(?:search|look\s*up|find|get|check)\s+(?:in\s+)?(?:ghl|gohighlevel|crm|go\s*high\s*level)\s+(?:for\s+)?(.+?)(?:'s)?\s+(?:${CONTACT_FIELD})`,
    "i",
  ),
  new RegExp(
    String.raw`(?:search|look\s*up|find|get|check)\s+(?:ghl|gohighlevel|crm)\s+for\s+(.+?)(?:'s)?(?:\s+(?:${CONTACT_FIELD}))?$`,
    "i",
  ),
  new RegExp(
    String.raw`(.+?)(?:'s)?\s+(?:${CONTACT_FIELD})\s+in\s+(?:ghl|gohighlevel|crm|go\s*high\s*level)`,
    "i",
  ),
  new RegExp(
    String.raw`(?:${CONTACT_FIELD})\s+(?:in\s+)?(?:ghl|gohighlevel|crm)\s+(?:for|of)\s+(.+)`,
    "i",
  ),
  /(\S+@\S+\.\S+)/i,
  /(\+?\d{1}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
];

const OPPORTUNITY_PATTERNS = [
  /(?:opportunity|deal|project)\s+(?:for|with)\s+(.+)/i,
  /(?:status|stage)\s+of\s+(?:the\s+)?(.+?)\s+(?:opportunity|deal|project)/i,
  // Prefer a short proper-name capture immediately before opportunity|deal|project
  // (avoids swallowing "give me information about the …").
  /\b(?:the\s+)?([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})\s+(?:opportunity|deal|project)\b/i,
  /opportunities?\s+(?:in|at)\s+(.+?)\s+stage/i,
];

const PIPELINE_PATTERNS = [
  /pipeline\s+stages?/i,
  /what\s+(?:are\s+)?(?:the\s+)?stages/i,
  /sales\s+process/i,
  /deal\s+stages/i,
];

const CALENDAR_PATTERNS = [
  /(?:meetings?|appointments?|events?)\s+(?:today|tomorrow|this\s+week)/i,
  /(?:what|when)\s+(?:is|are)\s+(?:my|the)\s+(?:next\s+)?(?:meeting|appointment)/i,
  /calendar\s+for\s+(.+)/i,
  /schedule\s+(?:for|with)\s+(.+)/i,
];

const WRITE_PATTERNS = [
  /update\s+(.+?)(?:'s|\s+)?\s*(?:phone|email|address)/i,
  /change\s+(.+?)(?:'s|\s+)?\s*(?:phone|email|address)\s+to/i,
  /mark\s+(?:the\s+)?(.+?)\s+(?:opportunity|deal)\s+as\s+(won|lost|open)/i,
  /move\s+(.+?)\s+to\s+(.+?)(?:\s+stage)?\.?$/i,
  /add\s+(?:the\s+)?['"]?(.+?)['"]?\s+tag\s+to\s+(.+)/i,
  /remove\s+(?:the\s+)?['"]?(.+?)['"]?\s+tag\s+from\s+(.+)/i,
  /assign\s+(.+?)\s+to\s+(.+)/i,
  /set\s+(.+?)(?:'s)?\s+(.+?)\s+to\s+(.+)/i,
];

const STAGE_LOOKUP_PATTERNS = [
  /what\s+stage\s+is\s+(?:the\s+)?(.+?)(?:\s+opportunity|\s+deal)?(?:\s+in)?\??$/i,
  /(?:which|what)\s+(?:pipeline\s+)?stage\s+(?:is|for)\s+(?:the\s+)?(.+?)(?:\s+opportunity|\s+deal)?/i,
  /what\s+pipeline\s+is\s+(?:the\s+)?(.+?)(?:\s+in|\s+opportunity|\s+deal)?\??$/i,
  /where\s+is\s+(.+?)\s+in\s+(?:the\s+)?(?:pipeline|process)/i,
  /what\s+happens\s+next\s+(?:for|with)\s+(.+)/i,
  /what(?:'s|\s+is)\s+going\s+on\s+with\s+(.+)/i,
];

const CONVERSATION_LOOKUP_PATTERNS = [
  /\blast\s+(?:e-?mail|message|sms|text).{0,40}\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
  /\b(?:e-?mail|message|sms|text).{0,40}\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
  /\bwhat did\s+([A-Za-z][A-Za-z .'-]{1,60})\s+(?:last\s+)?(?:e-?mail|say|send|text)/i,
  /\b(?:latest|recent|last)\s+(?:e-?mails?|messages?|conversation).{0,40}\b(?:with|for|from)\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
  /\b(?:show|get|find|pull)\s+(?:me\s+)?([A-Za-z][A-Za-z .'-]{1,60})(?:'s)?\s+(?:(?:recent|latest|last)\s+)?(?:e-?mails?|messages?)/i,
  /\b([A-Za-z][A-Za-z .'-]{1,60})(?:'s)\s+(?:(?:recent|latest|last)\s+)?(?:e-?mail|message|sms|conversation)\b/i,
  /\bconversation(?:s)?\s+(?:with|for)\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
  /\blast\s+e-?mail\s+we\s+sent\s+([A-Za-z][A-Za-z .'-]{1,60})/i,
];

function detectConversationLookup(normalized: string): {
  contactName?: string;
  contactEmail?: string;
} | null {
  const email = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const isConvShape =
    /\b(last|latest|recent)\s+(e-?mail|message|sms|text|conversation)\b/i.test(normalized) ||
    /\bwhat did\s+.+\s+(e-?mail|say|send|text)\b/i.test(normalized) ||
    /\b(show|get|find|pull).{0,40}\b(e-?mails?|messages?|conversation)\b/i.test(normalized) ||
    /\bconversation(?:s)?\s+(?:with|for|from)\b/i.test(normalized);
  if (!isConvShape && !email) return null;

  if (email?.[0] && isConvShape) {
    return { contactEmail: email[0] };
  }

  for (const pattern of CONVERSATION_LOOKUP_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const name = cleanExtractedName(match[1]);
      if (name) return { contactName: name };
    }
  }

  if (email?.[0] && /\b(e-?mail|message|conversation)\b/i.test(normalized)) {
    return { contactEmail: email[0] };
  }
  return null;
}

function detectRequestedField(question: string): GhlIntentDetection["entities"]["requestedField"] {
  // Longest-phrase registry: "email address" → email, never street address.
  const primary = primaryRequestedField(detectRequestedGhlFields(question));
  if (
    primary === "email" ||
    primary === "phone" ||
    primary === "address" ||
    primary === "city" ||
    primary === "owner" ||
    primary === "tags" ||
    primary === "source" ||
    primary === "stage"
  ) {
    return primary;
  }
  if (primary === "pipeline" || primary === "value") return "stage";
  return "other";
}

function isExplicitGhlMention(question: string): boolean {
  return /\b(ghl|gohighlevel|go\s*high\s*level|crm)\b/i.test(question);
}

function cleanExtractedName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let name = stripContactNamePossessive(raw);
  // Drop CRM / system tokens from capture groups before shared noise normalization
  name = name
    .replace(/\b(in\s+)?(ghl|gohighlevel|crm|go\s*high\s*level)\b/gi, "")
    .replace(
      /\b(full\s+)?(street\s+|home\s+|mailing\s+)?address|phone(\s+number)?|e-?mail(\s+address)?|city|zip|postal|tags?|owner\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  name = normalizeEntitySearchName(name) ?? "";
  if (!name || name.length < 2) return undefined;
  // Reject pronouns / stopwords — follow-ups inherit active entity in the query plan
  if (/^(his|her|their|him|them|he|she|they|it|this|that)\b/i.test(name)) {
    return undefined;
  }
  // Reject if it looks like a sentence fragment without a person name
  if (/^(the|a|an|our|my|this|that)\b/i.test(name) && name.split(/\s+/).length < 2) {
    return undefined;
  }
  // Also reject when cleanExtractedName left a question fragment
  if (/^(what|who|where|when|why|how)\b/i.test(name)) {
    return undefined;
  }
  return name;
}

/**
 * Detect if a question requires GHL CRM data.
 */
export function detectGhlIntent(question: string): GhlIntentDetection {
  const normalized = normalizeGhlQuestionText(question);
  const lower = normalized.toLowerCase();
  const entities: GhlIntentDetection["entities"] = {};
  const explicitGhl = isExplicitGhlMention(normalized);
  const requestedField = detectRequestedField(normalized);
  if (requestedField !== "other") entities.requestedField = requestedField;

  const hasWriteKeyword = WRITE_KEYWORDS.some((kw) => lower.includes(kw));

  for (const pattern of WRITE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      if (lower.includes("tag")) {
        return {
          intent: "write_tag",
          confidence: 0.9,
          entities: { tagName: match[1], contactName: cleanExtractedName(match[2]) },
          isWriteIntent: true,
          requiresConfirmation: true,
          explicitGhl,
        };
      }
      if (lower.includes("mark") || lower.includes("move") || lower.includes("stage")) {
        return {
          intent: "write_opportunity",
          confidence: 0.9,
          entities: {
            contactName: cleanExtractedName(match[1]),
            opportunityName: cleanExtractedName(match[1]),
            stageName: match[2]?.trim(),
            requestedField: "stage",
          },
          isWriteIntent: true,
          requiresConfirmation: true,
          explicitGhl,
        };
      }
      if (lower.includes("update") || lower.includes("change") || lower.includes("set")) {
        return {
          intent: "write_contact",
          confidence: 0.85,
          entities: { contactName: cleanExtractedName(match[1]), requestedField },
          isWriteIntent: true,
          requiresConfirmation: true,
          explicitGhl,
        };
      }
    }
  }

  if (
    /without\s+an?\s+owner|no\s+owner|unowned|missing\s+an?\s+owner/i.test(normalized) &&
    /opportunit|deal|open/i.test(normalized)
  ) {
    return {
      intent: "insight_unowned",
      confidence: 0.92,
      entities,
      isWriteIntent: false,
      requiresConfirmation: false,
      explicitGhl,
    };
  }
  if (
    /stale|no\s+recent\s+activity|stuck\s+in/i.test(normalized) &&
    /opportunit|deal|stage/i.test(normalized)
  ) {
    return {
      intent: "insight_stale",
      confidence: 0.85,
      entities,
      isWriteIntent: false,
      requiresConfirmation: false,
      explicitGhl,
    };
  }
  if (
    /appointments?\s+(today|this\s+week)|who\s+has\s+appointments|meetings?\s+(today|this\s+week)/i.test(
      normalized,
    )
  ) {
    return {
      intent: "insight_appointments",
      confidence: 0.88,
      entities,
      isWriteIntent: false,
      requiresConfirmation: false,
      explicitGhl,
    };
  }
  if (/unread\s+messages?|who\s+responded\s+recently/i.test(normalized)) {
    return {
      intent: "insight_unread",
      confidence: 0.8,
      entities,
      isWriteIntent: false,
      requiresConfirmation: false,
      explicitGhl,
    };
  }

  // Conversation / email recall before contact-field and opportunity patterns
  const conversationHit = detectConversationLookup(normalized);
  if (conversationHit) {
    return {
      intent: "conversation_lookup",
      confidence: 0.95,
      entities: {
        ...entities,
        contactName: conversationHit.contactName,
        contactEmail: conversationHit.contactEmail,
        requestedField: "other",
      },
      isWriteIntent: false,
      requiresConfirmation: false,
      explicitGhl,
    };
  }

  // Stage lookups before contact field lookups (avoid "stage" matching address patterns)
  for (const pattern of STAGE_LOOKUP_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return {
        intent: "opportunity_lookup",
        confidence: 0.9,
        entities: {
          contactName: cleanExtractedName(match[1]),
          requestedField: "stage",
        },
        isWriteIntent: false,
        requiresConfirmation: false,
        explicitGhl,
      };
    }
  }

  for (const pattern of CALENDAR_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        intent: "calendar_query",
        confidence: 0.85,
        entities: {},
        isWriteIntent: false,
        requiresConfirmation: false,
        explicitGhl,
      };
    }
  }

  for (const pattern of PIPELINE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        intent: "pipeline_info",
        confidence: 0.9,
        entities: {},
        isWriteIntent: false,
        requiresConfirmation: false,
        explicitGhl,
      };
    }
  }

  // Opportunity patterns — skip when this is clearly a contact-field ask (address/phone/email)
  const isContactFieldAsk =
    requestedField === "address" ||
    requestedField === "phone" ||
    requestedField === "email" ||
    requestedField === "city" ||
    requestedField === "tags";

  if (!isContactFieldAsk) {
    for (const pattern of OPPORTUNITY_PATTERNS) {
      const match = normalized.match(pattern);
      if (match) {
        if (lower.includes("all ") || lower.includes("list ") || lower.includes("show me ")) {
          return {
            intent: "opportunity_list",
            confidence: 0.8,
            entities: { stageName: match[1], requestedField: "stage" },
            isWriteIntent: false,
            requiresConfirmation: false,
            explicitGhl,
          };
        }
        const cleaned = cleanExtractedName(match[1]);
        // Skip how-to fragments glued onto "… project" ("to create a new project").
        if (!cleaned || !isPlausibleCrmEntityCandidate(cleaned)) {
          continue;
        }
        return {
          intent: "opportunity_lookup",
          confidence: 0.85,
          entities: {
            opportunityName: cleaned,
            contactName: cleaned,
            requestedField: "stage",
          },
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl,
        };
      }
    }
  }

  for (const pattern of LOOKUP_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const value = cleanExtractedName(match[1]);
      if (value) {
        if (value.includes("@")) {
          entities.contactEmail = value;
        } else if (/\d{3}/.test(value) && value.replace(/\D/g, "").length >= 7) {
          entities.contactPhone = value;
        } else {
          entities.contactName = value;
        }

        return {
          intent: "contact_lookup",
          confidence: explicitGhl || isContactFieldAsk ? 0.95 : 0.85,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl,
        };
      }
    }
  }

  const hasCrmKeyword = CRM_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasCrmKeyword || explicitGhl || isContactFieldAsk) {
    if (lower.includes("list") || lower.includes("all ") || lower.includes("show me ")) {
      if (lower.includes("contact") || lower.includes("lead") || lower.includes("customer")) {
        return {
          intent: "contact_list",
          confidence: 0.7,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl,
        };
      }
      if (lower.includes("opportunit") || lower.includes("deal")) {
        return {
          intent: "opportunity_list",
          confidence: 0.7,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl,
        };
      }
    }

    // Address/phone without extracted name still marks contact_lookup when we can salvage a name
    if (isContactFieldAsk) {
      const salvage =
        cleanExtractedName(
          normalized.match(
            /(?:for|of)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?:\s+(?:in\s+)?(?:ghl|gohighlevel|crm))?[.?!]?$/i,
          )?.[1],
        ) ||
        (requestedField === "address"
          ? cleanExtractedName(
              normalized.match(
                /^([A-Za-z][A-Za-z .'-]{1,60}?)(?:'s)?\s+(?:full\s+)?(?:street\s+|home\s+|mailing\s+)?address\b/i,
              )?.[1],
            )
          : undefined) ||
        (requestedField === "email" || requestedField === "phone"
          ? cleanExtractedName(
              normalized.match(
                /^([A-Za-z][A-Za-z .'-]{1,60}?)(?:'s)?\s+(?:e-?mail(?:\s+address)?|phone(?:\s+number)?)\b/i,
              )?.[1],
            )
          : undefined);
      // Reject sentence fragments / pronouns from salvage
      if (salvage && !/^(what|who|where|when|why|how)\b/i.test(salvage)) {
        return {
          intent: "contact_lookup",
          confidence: 0.9,
          entities: { ...entities, contactName: salvage, requestedField },
          isWriteIntent: false,
          requiresConfirmation: false,
          explicitGhl,
        };
      }
    }

    return {
      intent: explicitGhl || isContactFieldAsk ? "contact_lookup" : "general_crm",
      confidence: explicitGhl ? 0.85 : 0.5,
      entities,
      isWriteIntent: hasWriteKeyword,
      requiresConfirmation: hasWriteKeyword,
      explicitGhl,
    };
  }

  return {
    intent: "none",
    confidence: 0,
    entities: {},
    isWriteIntent: false,
    requiresConfirmation: false,
    explicitGhl: false,
  };
}

export function requiresGhlData(question: string): boolean {
  const detection = detectGhlIntent(question);
  return detection.intent !== "none" && detection.confidence >= 0.5;
}

export function isWriteIntent(question: string): boolean {
  const detection = detectGhlIntent(question);
  return detection.isWriteIntent;
}

/**
 * CRM contact-field questions should not invoke Slack retrieval.
 */
export function shouldSkipSlackForGhlContactField(question: string): boolean {
  if (/\b(slack|#\w+|what did .+ say|who (said|mentioned)|in #)\b/i.test(question)) {
    return false;
  }
  // Project UPDATE questions may still use Slack
  if (/\b(latest update|project update|what(?:'s| is) (?:the )?latest on)\b/i.test(question)) {
    return false;
  }
  const intent = detectGhlIntent(question);
  if (intent.intent === "opportunity_lookup" || intent.intent === "conversation_lookup") {
    return true;
  }
  if (intent.explicitGhl) {
    const field = intent.entities.requestedField;
    if (
      field === "address" ||
      field === "phone" ||
      field === "email" ||
      field === "city" ||
      field === "tags" ||
      field === "owner" ||
      field === "stage"
    ) {
      return true;
    }
  }
  const field = intent.entities.requestedField;
  return (
    intent.intent === "contact_lookup" &&
    (field === "address" ||
      field === "phone" ||
      field === "email" ||
      field === "city" ||
      field === "tags" ||
      field === "owner")
  );
}

export function describeGhlIntent(detection: GhlIntentDetection): string {
  switch (detection.intent) {
    case "contact_lookup":
      return "Looking up contact information";
    case "contact_list":
      return "Listing contacts";
    case "opportunity_lookup":
      return "Looking up opportunity details";
    case "opportunity_list":
      return "Listing opportunities";
    case "pipeline_info":
      return "Getting pipeline information";
    case "calendar_query":
      return "Checking calendar/appointments";
    case "conversation_lookup":
      return "Looking up conversation history";
    case "user_lookup":
      return "Looking up user information";
    case "write_contact":
      return "Updating contact information";
    case "write_opportunity":
      return "Updating opportunity";
    case "write_tag":
      return "Managing contact tags";
    case "general_crm":
      return "General CRM query";
    case "none":
    default:
      return "Not a CRM query";
  }
}
