import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  listConversationsForContact,
  getRecentMessages,
  getConversationSummary,
} from "@/lib/connectors/ghl/resources/conversations";
import { getContactById } from "@/lib/connectors/ghl/resources/contacts";
import type { BaxterGhlConversationContext, GhlMessage, GhlEvidenceSource } from "./types";
import { createConversationEvidenceSource, createContactEvidenceSource } from "./evidence";

export async function getBaxterConversationContext(
  contactId: string,
): Promise<BaxterGhlConversationContext | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const [conversations, recentMessages, contact] = await Promise.all([
    listConversationsForContact(contactId),
    getRecentMessages(contactId, { limit: 20 }),
    getContactById(contactId),
  ]);

  const evidenceSources: GhlEvidenceSource[] = [];

  if (contact) {
    evidenceSources.push(
      createContactEvidenceSource(contact.id, contact.name, "Conversation contact"),
    );
  }

  for (const conv of conversations.slice(0, 5)) {
    evidenceSources.push(
      createConversationEvidenceSource(
        conv.id,
        `Type: ${conv.type}, Messages: ${conv.unreadCount ?? 0} unread`,
      ),
    );
  }

  return {
    conversations,
    recentMessages,
    contact,
    evidenceSources,
  };
}

export async function getBaxterRecentMessages(
  contactId: string,
  options: { limit?: number } = {},
): Promise<{ messages: GhlMessage[]; evidenceSources: GhlEvidenceSource[] } | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const messages = await getRecentMessages(contactId, options);
  const evidenceSources: GhlEvidenceSource[] = [];

  const firstMessage = messages[0];
  if (firstMessage) {
    evidenceSources.push(
      createConversationEvidenceSource(
        firstMessage.conversationId,
        `${messages.length} recent messages for contact ${contactId}`,
      ),
    );
  }

  return { messages, evidenceSources };
}

export async function getBaxterConversationSummary(contactId: string): Promise<{
  summary: {
    totalConversations: number;
    totalMessages: number;
    lastMessageAt: string | null;
    conversationTypes: string[];
  };
  evidenceSources: GhlEvidenceSource[];
} | null> {
  if (!isGhlConfigured()) {
    return null;
  }

  const summary = await getConversationSummary(contactId);
  const evidenceSources: GhlEvidenceSource[] = [
    createConversationEvidenceSource(
      `summary-${contactId}`,
      `${summary.totalConversations} conversations, last message: ${summary.lastMessageAt ?? "never"}`,
    ),
  ];

  return { summary, evidenceSources };
}
