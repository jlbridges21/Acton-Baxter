import "server-only";

/**
 * GHL Intent Detection for Baxter AI.
 * Detects when a user question requires CRM data from GoHighLevel.
 */

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
  };
  isWriteIntent: boolean;
  requiresConfirmation: boolean;
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

const LOOKUP_PATTERNS = [
  /who\s+is\s+(\w+(?:\s+\w+)?)/i,
  /find\s+(?:contact|lead|customer)\s+(?:for\s+)?(.+)/i,
  /look\s*up\s+(.+)/i,
  /show\s+me\s+(.+?)(?:'s|s')?\s+(?:info|details|contact)/i,
  /what(?:'s|\s+is)\s+(.+?)(?:'s|\s+)?\s*(?:email|phone|address|status)/i,
  /contact\s+info(?:rmation)?\s+for\s+(.+)/i,
  /(\S+@\S+\.\S+)/i, // Email pattern
  /(\+?\d{1}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i, // Phone pattern
];

const OPPORTUNITY_PATTERNS = [
  /(?:opportunity|deal|project)\s+(?:for|with)\s+(.+)/i,
  /(?:status|stage)\s+of\s+(?:the\s+)?(.+?)\s+(?:opportunity|deal|project)/i,
  /(.+?)(?:'s|\s+)?(?:opportunity|deal|project)/i,
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
  /what\s+stage\s+is\s+(.+?)(?:\s+in)?\??$/i,
  /(?:which|what)\s+(?:pipeline\s+)?stage\s+(?:is|for)\s+(.+)/i,
  /where\s+is\s+(.+?)\s+in\s+(?:the\s+)?(?:pipeline|process)/i,
  /what\s+happens\s+next\s+(?:for|with)\s+(.+)/i,
  /what(?:'s|\s+is)\s+going\s+on\s+with\s+(.+)/i,
];

/**
 * Detect if a question requires GHL CRM data.
 */
export function detectGhlIntent(question: string): GhlIntentDetection {
  const lower = question.toLowerCase();
  const entities: GhlIntentDetection["entities"] = {};

  // Check for write intent first
  const hasWriteKeyword = WRITE_KEYWORDS.some((kw) => lower.includes(kw));

  for (const pattern of WRITE_PATTERNS) {
    const match = question.match(pattern);
    if (match) {
      // Determine write type
      if (lower.includes("tag")) {
        return {
          intent: "write_tag",
          confidence: 0.9,
          entities: { tagName: match[1], contactName: match[2] },
          isWriteIntent: true,
          requiresConfirmation: true,
        };
      }
      if (lower.includes("mark") || lower.includes("move") || lower.includes("stage")) {
        return {
          intent: "write_opportunity",
          confidence: 0.9,
          entities: {
            contactName: match[1]?.trim(),
            opportunityName: match[1]?.trim(),
            stageName: match[2]?.trim(),
          },
          isWriteIntent: true,
          requiresConfirmation: true,
        };
      }
      if (lower.includes("update") || lower.includes("change") || lower.includes("set")) {
        return {
          intent: "write_contact",
          confidence: 0.85,
          entities: { contactName: match[1]?.trim() },
          isWriteIntent: true,
          requiresConfirmation: true,
        };
      }
    }
  }

  // Stage / "what happens next" lookups
  for (const pattern of STAGE_LOOKUP_PATTERNS) {
    const match = question.match(pattern);
    if (match?.[1]) {
      return {
        intent: "opportunity_lookup",
        confidence: 0.9,
        entities: { contactName: match[1].trim() },
        isWriteIntent: false,
        requiresConfirmation: false,
      };
    }
  }

  // Check for calendar queries
  for (const pattern of CALENDAR_PATTERNS) {
    const match = question.match(pattern);
    if (match) {
      return {
        intent: "calendar_query",
        confidence: 0.85,
        entities: {},
        isWriteIntent: false,
        requiresConfirmation: false,
      };
    }
  }

  // Check for pipeline queries
  for (const pattern of PIPELINE_PATTERNS) {
    if (pattern.test(question)) {
      return {
        intent: "pipeline_info",
        confidence: 0.9,
        entities: {},
        isWriteIntent: false,
        requiresConfirmation: false,
      };
    }
  }

  // Check for opportunity queries
  for (const pattern of OPPORTUNITY_PATTERNS) {
    const match = question.match(pattern);
    if (match) {
      // Check if asking for list or specific lookup
      if (lower.includes("all ") || lower.includes("list ") || lower.includes("show me ")) {
        return {
          intent: "opportunity_list",
          confidence: 0.8,
          entities: { stageName: match[1] },
          isWriteIntent: false,
          requiresConfirmation: false,
        };
      }
      return {
        intent: "opportunity_lookup",
        confidence: 0.85,
        entities: { opportunityName: match[1] || undefined, contactName: match[1] || undefined },
        isWriteIntent: false,
        requiresConfirmation: false,
      };
    }
  }

  // Check for contact lookup patterns
  for (const pattern of LOOKUP_PATTERNS) {
    const match = question.match(pattern);
    if (match) {
      const value = match[1]?.trim();
      if (value) {
        // Determine if it's email or phone
        if (value.includes("@")) {
          entities.contactEmail = value;
        } else if (/\d{3}/.test(value)) {
          entities.contactPhone = value;
        } else {
          entities.contactName = value;
        }

        return {
          intent: "contact_lookup",
          confidence: 0.85,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
        };
      }
    }
  }

  // Check for general CRM keywords
  const hasCrmKeyword = CRM_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasCrmKeyword) {
    // Determine more specific intent based on context
    if (lower.includes("list") || lower.includes("all ") || lower.includes("show me ")) {
      if (lower.includes("contact") || lower.includes("lead") || lower.includes("customer")) {
        return {
          intent: "contact_list",
          confidence: 0.7,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
        };
      }
      if (lower.includes("opportunit") || lower.includes("deal")) {
        return {
          intent: "opportunity_list",
          confidence: 0.7,
          entities,
          isWriteIntent: false,
          requiresConfirmation: false,
        };
      }
    }

    return {
      intent: "general_crm",
      confidence: 0.5,
      entities,
      isWriteIntent: hasWriteKeyword,
      requiresConfirmation: hasWriteKeyword,
    };
  }

  return {
    intent: "none",
    confidence: 0,
    entities: {},
    isWriteIntent: false,
    requiresConfirmation: false,
  };
}

/**
 * Check if a question requires GHL data.
 */
export function requiresGhlData(question: string): boolean {
  const detection = detectGhlIntent(question);
  return detection.intent !== "none" && detection.confidence >= 0.5;
}

/**
 * Check if a question is a write intent.
 */
export function isWriteIntent(question: string): boolean {
  const detection = detectGhlIntent(question);
  return detection.isWriteIntent;
}

/**
 * Get a user-friendly description of the detected intent.
 */
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
