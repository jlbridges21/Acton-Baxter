/**
 * Classify Baxter capability / access questions by scope.
 * Narrow questions must not trigger the full capability overview.
 */

import { looksLikeGoogleUrl, parseGoogleWorkspaceUrl } from "@/lib/connectors/google/google-url";
import { detectSlackSearchIntent } from "@/lib/baxter-data/slack/intent";
import { isProjectStatusQuestion } from "@/lib/baxter-data/slack/project-status";
import { isGhlConversationLookupQuestion } from "@/lib/baxter-data/ghl/conversation-intent";

export type CapabilityQuestionKind =
  | "general_capabilities"
  | "specific_capability"
  | "resource_access_check"
  | "implied_action"
  | "none";

export type CapabilityQuestionClassification = {
  kind: CapabilityQuestionKind;
  /** Named system/topic when specific (slack, ghl, google, pem, buildertrend, …). */
  topic: string | null;
  /** Extracted Google Workspace URL when present. */
  googleUrl: string | null;
  /** Extracted Slack channel mention (#name or ID) when present. */
  slackChannel: string | null;
  reason: string;
};

const GENERAL_CAPABILITIES =
  /\b(what can you (do|help with|help)|what (all )?can (baxter|you) help( me)? with|what are your (capabilities|limits|limitations)|tell me (everything|all) .{0,30}(can|capabilities|do)|what (are |are all )?(the )?(systems|tools|sources|integrations) (you have|do you|can you)|what (all )?(systems|tools|sources|integrations) (do you|can you|you have)|give me (a )?(full )?(list|overview) of (your |baxter'?s )?(capabilities|systems|tools)|how do you (work|help)|what (all )?do you (have access to|know)|capabilities overview)\b/i;

const ACCESS_SHAPE =
  /\b(do you (have )?access|can you (access|read|open|view|see|reach)|have access to|able to (access|read|open))\b/i;

const CAN_YOU_SHAPE = /\b(can you|are you able to|do you (support|have)|will you)\b/i;

const IMPLIED_ACTION_VERB =
  /\bcan you (find|look\s*up|look|search for|get|check|see what|show me|pull|retrieve|fetch|summarize|tell me what|tell me if)\b/i;

const SYSTEM_TOPIC =
  /\b(slack|gohighlevel|ghl|crm|google(\s+(drive|docs|sheets|workspace))?|buildertrend|pem(\s+neat)?|neat|property research|knowledge( center)?|rulebook|domo|drive|docs?|spreadsheet|sheet|new project|project setup|customer center|customer dossier|\/new-project)\b/i;

/** “How do we use Baxter to …” / “tell the team how they can use you …” */
const BAXTER_META_HOWTO =
  /\b((tell|show|explain|teach|remind)\s+(the\s+team|us|employees?|me)\s+(about\s+)?how|how\s+(do|can|should)\s+(i|we|they|the\s+team|employees?)|walk\s+(me|us|the\s+team)\s+through|how\s+to\s+use\s+(you|baxter)|(?:can|could)\s+(the\s+team|we|they)\s+use\s+(you|baxter))\b/i;

const USE_BAXTER_TO =
  /\b(use\s+(you|baxter)\s+(to|for)|how\s+they\s+can\s+use\s+you|instead of relying)\b/i;

function extractGoogleUrl(question: string): string | null {
  const withProtocol = question.match(
    /https?:\/\/(?:docs|drive|sheets)\.google\.com\/[^\s)\]>"']+/i,
  );
  if (withProtocol?.[0]) return withProtocol[0].replace(/[.,;:!?]+$/, "");
  const bare = question.match(
    /(?:docs|drive|sheets)\.google\.com\/(?:document|spreadsheets|presentation|file|drive)\/[^\s)\]>"']+/i,
  );
  if (bare?.[0]) return `https://${bare[0].replace(/[.,;:!?]+$/, "")}`;
  return null;
}

function extractSlackChannel(question: string): string | null {
  const hash = question.match(/#([\w-]+)/);
  if (hash?.[1]) return hash[1];
  const named = question.match(/\b(?:channel\s+|#)?(?:the\s+)?([\w-]+)\s+channel\b/i);
  if (named?.[1] && !/^(this|that|a|an|the|slack)$/i.test(named[1])) {
    return named[1].toLowerCase();
  }
  return null;
}

function detectTopic(question: string): string | null {
  const q = question.toLowerCase();
  if (/\bbuildertrend\b/.test(q)) return "buildertrend";
  if (/\b(gohighlevel|ghl|crm)\b/.test(q)) return "ghl";
  if (/\bslack\b/.test(q) || /#[\w-]+/.test(q)) return "slack";
  if (/\b(pem|neat)\b/.test(q)) return "pem_neat";
  if (/\bproperty research\b/.test(q) || /\bresearch (a |this )?propert/.test(q)) {
    return "property_research";
  }
  if (
    /\b(\/new-project|new project setup|project setup|feasibility package)\b/.test(q) ||
    /\b(create|start|run|set\s*up)\s+(a\s+)?new\s+project\b/.test(q)
  ) {
    return "project_setup";
  }
  if (/\b(customer center|customer dossier)\b/.test(q)) return "customer_center";
  if (/\b(knowledge|rulebook)\b/.test(q)) return "knowledge";
  if (/\b(google|drive|docs?|spreadsheet|sheet)\b/.test(q) || looksLikeGoogleUrl(q)) {
    return "google";
  }
  if (/\bdomo\b/.test(q)) return "domo";
  return null;
}

/**
 * True when "can you…" is a polite request to perform work, not a capability FAQ.
 */
export function isImpliedCapabilityAction(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (GENERAL_CAPABILITIES.test(q)) return false;

  // GHL conversation / email recall is an action, not a capability FAQ
  if (isGhlConversationLookupQuestion(q)) return true;

  // Strong Slack / project retrieval already owned by those pipelines
  const slackIntent = detectSlackSearchIntent(q);
  if (
    slackIntent === "person_statement" ||
    slackIntent === "latest_message" ||
    slackIntent === "channel_search" ||
    slackIntent === "project_status" ||
    isProjectStatusQuestion(q)
  ) {
    if (CAN_YOU_SHAPE.test(q) || IMPLIED_ACTION_VERB.test(q)) return true;
  }

  if (!IMPLIED_ACTION_VERB.test(q) && !/\bcan you (find|look|search|get|check|see)\b/i.test(q)) {
    return false;
  }

  // Named person + CRM/system → do the lookup
  if (
    /\b(ghl|gohighlevel|crm|contact|opportunity)\b/i.test(q) &&
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(q)
  ) {
    return true;
  }
  if (
    /\b(find|look\s*up|search for)\b.+\b(in|on|from)\b.+\b(ghl|gohighlevel|crm|slack)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(see what|what did|said last|last in)\b/i.test(q)) return true;

  return false;
}

const IDENTITY_INTRO = /\b(who (are|is) (you|baxter)|what (are|is) (you|baxter))\b/i;

/**
 * Classify capability / access questions.
 */
export function classifyCapabilityQuestion(question: string): CapabilityQuestionClassification {
  const q = question.trim();
  if (!q) {
    return { kind: "none", topic: null, googleUrl: null, slackChannel: null, reason: "empty" };
  }

  const googleUrl = extractGoogleUrl(q);
  const slackChannel = extractSlackChannel(q);
  const topic = detectTopic(q);

  // Conversation / CRM message recall must never become a capability FAQ.
  if (isGhlConversationLookupQuestion(q)) {
    return {
      kind: "implied_action",
      topic: "ghl",
      googleUrl,
      slackChannel,
      reason: "ghl_conversation_lookup",
    };
  }

  if (GENERAL_CAPABILITIES.test(q)) {
    return {
      kind: "general_capabilities",
      topic: null,
      googleUrl,
      slackChannel,
      reason: "broad_capability_overview",
    };
  }

  // Meta how-to about using Baxter itself ("tell the team how they can use you to…")
  // — never a CRM entity lookup.
  if (BAXTER_META_HOWTO.test(q) || USE_BAXTER_TO.test(q)) {
    return {
      kind: "specific_capability",
      topic,
      googleUrl,
      slackChannel,
      reason: "baxter_meta_howto",
    };
  }

  // Identity intro is a short Baxter answer — not the full capability dump.
  if (IDENTITY_INTRO.test(q) && !SYSTEM_TOPIC.test(q) && !googleUrl) {
    return {
      kind: "specific_capability",
      topic: "identity",
      googleUrl,
      slackChannel,
      reason: "identity_intro",
    };
  }

  // Specific resource URL + access language → verify that resource
  if (googleUrl) {
    const parsed = parseGoogleWorkspaceUrl(googleUrl);
    if (
      parsed.fileId &&
      (ACCESS_SHAPE.test(q) ||
        /\b(this|that)\s+(document|doc|file|sheet|spreadsheet|drive)\b/i.test(q) ||
        /\b(can you|do you).{0,40}\b(read|access|open|view)\b/i.test(q) ||
        /^(https?:\/\/|docs\.google)/i.test(q.trim()))
    ) {
      return {
        kind: "resource_access_check",
        topic: "google",
        googleUrl,
        slackChannel,
        reason: "google_url_access_check",
      };
    }
  }

  if (isImpliedCapabilityAction(q)) {
    return {
      kind: "implied_action",
      topic,
      googleUrl,
      slackChannel,
      reason: "polite_action_request",
    };
  }

  // Channel access without a message-retrieval ask
  if (
    slackChannel &&
    ACCESS_SHAPE.test(q) &&
    !/\b(said|say|message|update|what did|jess|kevin)\b/i.test(q)
  ) {
    return {
      kind: "resource_access_check",
      topic: "slack",
      googleUrl,
      slackChannel,
      reason: "slack_channel_access_check",
    };
  }

  // Specific system capability FAQ
  if (
    (CAN_YOU_SHAPE.test(q) || ACCESS_SHAPE.test(q) || /\bdo you (support|have)\b/i.test(q)) &&
    (SYSTEM_TOPIC.test(q) || topic)
  ) {
    return {
      kind: "specific_capability",
      topic,
      googleUrl,
      slackChannel,
      reason: "named_system_capability",
    };
  }

  if (/\b(where (do i|can i)|how (do i|to))\b/i.test(q) && SYSTEM_TOPIC.test(q)) {
    return {
      kind: "specific_capability",
      topic,
      googleUrl,
      slackChannel,
      reason: "how_to_named_system",
    };
  }

  if (/\b(clear (this )?chat|new chat)\b/i.test(q)) {
    return {
      kind: "specific_capability",
      topic: "chat",
      googleUrl: null,
      slackChannel: null,
      reason: "clear_chat_help",
    };
  }

  return {
    kind: "none",
    topic: null,
    googleUrl,
    slackChannel,
    reason: "not_capability_question",
  };
}

export function isGeneralCapabilitiesQuestion(question: string): boolean {
  return classifyCapabilityQuestion(question).kind === "general_capabilities";
}
