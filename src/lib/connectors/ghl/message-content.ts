/**
 * Resolve usable plain-text content for GHL conversation messages.
 * Email list endpoints often omit bodies — hydrate via message/email APIs on demand.
 */
import "server-only";

import type { GhlConversation, GhlMessage, GhlMessageContentSource } from "./types";
import { getConversationMessageById, getEmailMessageById } from "./resources/conversations";
import { stripHtmlToText } from "./present";

function isEmailType(type: string | null | undefined): boolean {
  const t = (type ?? "").toUpperCase();
  return t.includes("EMAIL");
}

export type MessageContentDiagnostics = {
  messageId: string;
  type: string;
  direction: string;
  timestamp: string | null;
  listHadText: boolean;
  listHadHtml: boolean;
  fullMessageLookupAttempted: boolean;
  fullMessageHttpOk: boolean | null;
  fullMessageHadText: boolean;
  fullMessageHadHtml: boolean;
  emailEndpointAttempted: boolean;
  emailEndpointHttpOk: boolean | null;
  emailEndpointHadText: boolean;
  emailEndpointHadHtml: boolean;
  summaryFallbackAvailable: boolean;
  contentSource: GhlMessageContentSource;
  finalContentAvailable: boolean;
  topLevelFieldNames: string[];
};

function usableText(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t.length ? t : null;
}

export function extractPlainTextFromMessageFields(input: {
  body?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  message?: string | null;
}): { text: string | null; source: GhlMessageContentSource } {
  const explicit =
    usableText(input.textBody) || usableText(input.message) || usableText(input.body);
  if (explicit) {
    // Prefer already-plain fields; if body looks like HTML, convert.
    if (/<[a-z][\s\S]*>/i.test(explicit) && !usableText(input.textBody)) {
      const converted = usableText(stripHtmlToText(explicit).replace(/\n{3,}/g, "\n\n"));
      if (converted) return { text: converted, source: "full_message_html" };
    }
    return { text: explicit, source: "full_message_text" };
  }
  const html = usableText(input.htmlBody);
  if (html) {
    const converted = usableText(stripHtmlToText(html).replace(/\n{3,}/g, "\n\n"));
    if (converted) return { text: converted, source: "full_message_html" };
  }
  return { text: null, source: "none" };
}

export function messageHasUsableContent(message: GhlMessage): boolean {
  const html = usableText(message.htmlBody);
  return Boolean(
    usableText(message.textBody) ||
    usableText(message.body) ||
    (html && usableText(stripHtmlToText(html))),
  );
}

export function applyResolvedContent(
  message: GhlMessage,
  text: string | null,
  source: GhlMessageContentSource,
  extras?: Partial<GhlMessage>,
): GhlMessage {
  return {
    ...message,
    ...extras,
    textBody: text ?? message.textBody,
    body: text ?? message.body,
    contentSource: source,
  };
}

/**
 * Demand-driven content resolution for a single message.
 */
export async function resolveConversationMessageContent(input: {
  message: GhlMessage;
  conversation?: GhlConversation | null;
  hydrate?: boolean;
  /** Include schema key names (dev/diagnostics only; never values). */
  includeFieldNames?: boolean;
}): Promise<{ message: GhlMessage; diagnostics: MessageContentDiagnostics }> {
  const message = input.message;
  const hydrate = input.hydrate !== false;
  const listExtract = extractPlainTextFromMessageFields({
    body: message.body,
    textBody: message.textBody,
    htmlBody: message.htmlBody,
  });

  const diagnostics: MessageContentDiagnostics = {
    messageId: message.id,
    type: message.type,
    direction: message.direction,
    timestamp: message.dateAdded,
    listHadText: Boolean(usableText(message.body) || usableText(message.textBody)),
    listHadHtml: Boolean(usableText(message.htmlBody)),
    fullMessageLookupAttempted: false,
    fullMessageHttpOk: null,
    fullMessageHadText: false,
    fullMessageHadHtml: false,
    emailEndpointAttempted: false,
    emailEndpointHttpOk: null,
    emailEndpointHadText: false,
    emailEndpointHadHtml: false,
    summaryFallbackAvailable: Boolean(usableText(input.conversation?.lastMessageBody)),
    contentSource: listExtract.source === "none" ? "none" : "list_body",
    finalContentAvailable: Boolean(listExtract.text),
    topLevelFieldNames: [],
  };

  let resolved = message;
  if (listExtract.text) {
    resolved = applyResolvedContent(message, listExtract.text, "list_body");
    diagnostics.contentSource = "list_body";
    diagnostics.finalContentAvailable = true;
    return { message: resolved, diagnostics };
  }

  if (hydrate && message.id && !message.id.startsWith("summary:")) {
    diagnostics.fullMessageLookupAttempted = true;
    const full = await getConversationMessageById(message.id);
    diagnostics.fullMessageHttpOk = full.ok;
    if (full.message) {
      if (input.includeFieldNames) {
        diagnostics.topLevelFieldNames = full.fieldNames;
      }
      diagnostics.fullMessageHadText = Boolean(
        usableText(full.message.body) || usableText(full.message.textBody),
      );
      diagnostics.fullMessageHadHtml = Boolean(usableText(full.message.htmlBody));
      const fullExtract = extractPlainTextFromMessageFields({
        body: full.message.body,
        textBody: full.message.textBody,
        htmlBody: full.message.htmlBody,
      });
      resolved = {
        ...message,
        ...full.message,
        id: message.id || full.message.id,
        conversationId: message.conversationId || full.message.conversationId,
        contactId: message.contactId || full.message.contactId,
      };
      if (fullExtract.text) {
        const source: GhlMessageContentSource =
          fullExtract.source === "full_message_html" ? "full_message_html" : "full_message_text";
        resolved = applyResolvedContent(resolved, fullExtract.text, source);
        diagnostics.contentSource = source;
        diagnostics.finalContentAvailable = true;
        return { message: resolved, diagnostics };
      }

      // Email thread shells expose meta.email.messageIds — hydrate those.
      const emailIds = [
        ...new Set(
          [...(resolved.emailMessageIds ?? []), ...(full.message.emailMessageIds ?? [])].filter(
            Boolean,
          ),
        ),
      ].slice(0, 3);

      for (const emailId of emailIds) {
        diagnostics.emailEndpointAttempted = true;
        const email = await getEmailMessageById(emailId);
        diagnostics.emailEndpointHttpOk = email.ok;
        if (!email.message) continue;
        diagnostics.emailEndpointHadText = Boolean(
          usableText(email.message.body) || usableText(email.message.textBody),
        );
        diagnostics.emailEndpointHadHtml = Boolean(usableText(email.message.htmlBody));
        const emailExtract = extractPlainTextFromMessageFields({
          body: email.message.body,
          textBody: email.message.textBody,
          htmlBody: email.message.htmlBody,
        });
        if (emailExtract.text) {
          resolved = applyResolvedContent(
            {
              ...resolved,
              subject: email.message.subject ?? resolved.subject,
              fromAddress: email.message.fromAddress ?? resolved.fromAddress,
              toAddresses: email.message.toAddresses?.length
                ? email.message.toAddresses
                : resolved.toAddresses,
              htmlBody: email.message.htmlBody ?? resolved.htmlBody,
              threadId: email.message.threadId ?? resolved.threadId,
              emailMessageIds: emailIds,
            },
            emailExtract.text,
            "email_endpoint",
            { direction: email.message.direction || resolved.direction },
          );
          diagnostics.contentSource = "email_endpoint";
          diagnostics.finalContentAvailable = true;
          return { message: resolved, diagnostics };
        }
      }

      // Some tenants use the conversation message id as the email id.
      if (isEmailType(resolved.type) && !emailIds.length) {
        diagnostics.emailEndpointAttempted = true;
        const email = await getEmailMessageById(message.id);
        diagnostics.emailEndpointHttpOk = email.ok;
        if (email.message) {
          diagnostics.emailEndpointHadText = Boolean(
            usableText(email.message.body) || usableText(email.message.textBody),
          );
          diagnostics.emailEndpointHadHtml = Boolean(usableText(email.message.htmlBody));
          const emailExtract = extractPlainTextFromMessageFields({
            body: email.message.body,
            textBody: email.message.textBody,
            htmlBody: email.message.htmlBody,
          });
          if (emailExtract.text) {
            resolved = applyResolvedContent(
              {
                ...resolved,
                subject: email.message.subject ?? resolved.subject,
                fromAddress: email.message.fromAddress ?? resolved.fromAddress,
                toAddresses: email.message.toAddresses?.length
                  ? email.message.toAddresses
                  : resolved.toAddresses,
                htmlBody: email.message.htmlBody ?? resolved.htmlBody,
                threadId: email.message.threadId ?? resolved.threadId,
              },
              emailExtract.text,
              "email_endpoint",
              { direction: email.message.direction || resolved.direction },
            );
            diagnostics.contentSource = "email_endpoint";
            diagnostics.finalContentAvailable = true;
            return { message: resolved, diagnostics };
          }
        }
      }
    }
  }

  // Conversation search preview fallback when identity aligns.
  const summaryBody = usableText(input.conversation?.lastMessageBody);
  if (summaryBody) {
    const summaryType = input.conversation?.lastMessageType;
    const typeOk =
      !summaryType ||
      !message.type ||
      summaryType.toUpperCase() === message.type.toUpperCase() ||
      (isEmailType(summaryType) && isEmailType(message.type));
    const timeOk =
      !input.conversation?.lastMessageAt ||
      !message.dateAdded ||
      Math.abs(
        (Date.parse(input.conversation.lastMessageAt) || 0) - (Date.parse(message.dateAdded) || 0),
      ) < 120_000;
    if (typeOk && timeOk) {
      resolved = applyResolvedContent(resolved, summaryBody, "conversation_summary");
      diagnostics.contentSource = "conversation_summary";
      diagnostics.finalContentAvailable = true;
      return { message: resolved, diagnostics };
    }
  }

  diagnostics.contentSource = "none";
  diagnostics.finalContentAvailable = false;
  return { message: resolved, diagnostics };
}

/**
 * Hydrate a bounded set of messages (concurrency capped).
 */
export async function hydrateMessagesContent(
  messages: GhlMessage[],
  options: {
    conversation?: GhlConversation | null;
    concurrency?: number;
    onlyMissing?: boolean;
  } = {},
): Promise<GhlMessage[]> {
  const concurrency = Math.min(Math.max(options.concurrency ?? 3, 1), 5);
  const onlyMissing = options.onlyMissing !== false;
  const out = [...messages];
  const indexes = out
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !onlyMissing || !messageHasUsableContent(m))
    .map(({ i }) => i);

  let cursor = 0;
  async function worker() {
    while (cursor < indexes.length) {
      const i = indexes[cursor++]!;
      const result = await resolveConversationMessageContent({
        message: out[i]!,
        conversation: options.conversation,
        hydrate: true,
      });
      out[i] = result.message;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, indexes.length) }, () => worker()));
  return out;
}

/**
 * Collapse duplicate thread/email rows that represent the same underlying email.
 */
export function dedupeConversationMessages(messages: GhlMessage[]): GhlMessage[] {
  const byKey = new Map<string, GhlMessage>();
  const order: string[] = [];

  for (const message of messages) {
    const emailId = message.emailMessageIds?.[0];
    const key =
      emailId ||
      message.threadId ||
      `${message.direction}|${(message.type || "").toUpperCase()}|${message.dateAdded || ""}|${(
        message.subject || ""
      )
        .toLowerCase()
        .slice(0, 80)}|${(message.body || message.textBody || "").slice(0, 40)}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, message);
      order.push(key);
      continue;
    }
    // Prefer the copy with content / richer metadata.
    const preferNew =
      (messageHasUsableContent(message) && !messageHasUsableContent(existing)) ||
      ((message.subject?.length ?? 0) > (existing.subject?.length ?? 0) &&
        messageHasUsableContent(message) === messageHasUsableContent(existing));
    if (preferNew) byKey.set(key, message);
  }

  return order.map((k) => byKey.get(k)!).filter(Boolean);
}
