import "server-only";

import type {
  GhlContact,
  GhlOpportunity,
  GhlCalendarEvent,
  GhlConversation,
  GhlMessage,
} from "./types";
import { getContactById, hydrateGhlContact } from "./resources/contacts";
import { listOpportunitiesByContact, getOpportunityById } from "./resources/opportunities";
import { listPipelines } from "./resources/pipelines";
import { listUsers } from "./resources/users";
import { listCustomFields } from "./resources/custom-fields";
import { listEventsForContact } from "./resources/calendars";
import { searchConversations, getConversationMessages } from "./resources/conversations";
import { resolveContact } from "@/lib/baxter-data/ghl/resolve";
import {
  rankOpportunitiesForContact,
  opportunitiesNeedClarification,
  DEFAULT_OPPORTUNITY_RANK_POLICY,
  type OpportunityRankPolicy,
} from "./opportunity-ranking";
import type { GhlReferenceData } from "./reference-data";
import { contactAddressFromGhl, detectGhlSnapshotFocus, type GhlSnapshotFocus } from "./address";
import { isPronounOrStopwordName } from "@/lib/baxter-data/ghl/field-aliases";

export type GhlEntityGraph = {
  retrievedAt: string;
  query: string;
  ambiguous: boolean;
  clarificationMessage: string | null;
  /** True when multiple opportunities are close in rank and stage/value questions need disambiguation. */
  opportunityAmbiguous: boolean;
  contact: GhlContact | null;
  opportunities: Array<{
    opportunity: GhlOpportunity;
    pipelineName: string | null;
    stageName: string | null;
    ownerName: string | null;
  }>;
  nextAppointment: GhlCalendarEvent | null;
  recentConversation: GhlConversation | null;
  recentMessages: GhlMessage[];
  customFieldLabels: Record<string, string>;
  /** Resolved contact owner display name (users.readonly), when available. */
  contactOwnerName?: string | null;
};

function looksLikeEmail(q: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim());
}

function looksLikePhone(q: string): boolean {
  const digits = q.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Resolve a CRM query into a linked contact → opportunities → appointments → conversations graph.
 */
export async function resolveGhlEntityGraph(
  query: string,
  options: {
    includeAppointments?: boolean;
    includeConversations?: boolean;
    messageLimit?: number;
    opportunityId?: string;
    /** Authoritative contact id (active entity / prior turn). */
    contactId?: string;
    /** Ranking policy for opportunity selection. */
    opportunityRankPolicy?: OpportunityRankPolicy;
  } = {},
): Promise<GhlEntityGraph> {
  const retrievedAt = new Date().toISOString();
  const empty: GhlEntityGraph = {
    retrievedAt,
    query,
    ambiguous: false,
    clarificationMessage: null,
    opportunityAmbiguous: false,
    contact: null,
    opportunities: [],
    nextAppointment: null,
    recentConversation: null,
    recentMessages: [],
    customFieldLabels: {},
  };

  if (options.opportunityId) {
    const opp = await getOpportunityById(options.opportunityId);
    if (!opp) return empty;
    const contact = opp.contactId ? await getContactById(opp.contactId) : null;
    return enrichGraph(query, retrievedAt, contact, [opp], options);
  }

  if (options.contactId?.trim()) {
    const contact = await getContactById(options.contactId.trim()).catch(() => null);
    if (contact) {
      return enrichGraph(query, retrievedAt, contact, undefined, options);
    }
  }

  const trimmed = query.trim();
  if (!trimmed || isPronounOrStopwordName(trimmed)) {
    return empty;
  }

  const resolution = await resolveContact({
    email: looksLikeEmail(trimmed) ? trimmed : undefined,
    phone: looksLikePhone(trimmed) ? trimmed : undefined,
    name: !looksLikeEmail(trimmed) && !looksLikePhone(trimmed) ? trimmed : undefined,
  });

  if (resolution.ambiguous) {
    return {
      ...empty,
      ambiguous: true,
      clarificationMessage:
        resolution.ambiguityMessage || "I found multiple matching contacts. Which one do you mean?",
    };
  }

  if (resolution.resolved && resolution.entity) {
    return enrichGraph(query, retrievedAt, resolution.entity, undefined, options);
  }

  // Do NOT fall back to searchContacts[0] — that lets unrelated contacts leak in.
  return empty;
}

async function enrichGraph(
  query: string,
  retrievedAt: string,
  contact: GhlContact | null,
  seedOpps: GhlOpportunity[] | undefined,
  options: {
    includeAppointments?: boolean;
    includeConversations?: boolean;
    messageLimit?: number;
    opportunityRankPolicy?: OpportunityRankPolicy;
  },
): Promise<GhlEntityGraph> {
  if (!contact) {
    return {
      retrievedAt,
      query,
      ambiguous: false,
      clarificationMessage: null,
      opportunityAmbiguous: false,
      contact: null,
      opportunities: [],
      nextAppointment: null,
      recentConversation: null,
      recentMessages: [],
      customFieldLabels: {},
      contactOwnerName: null,
    };
  }

  const hydratedContact = await hydrateGhlContact(contact);

  const [opps, pipelines, users, fields] = await Promise.all([
    seedOpps
      ? Promise.resolve(seedOpps)
      : listOpportunitiesByContact(hydratedContact.id, { limit: 20 }),
    listPipelines({ useCache: true }).catch(() => []),
    listUsers({ useCache: true }).catch(() => []),
    listCustomFields({ useCache: true }).catch(() => []),
  ]);

  const pipelineById = new Map(pipelines.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const customFieldLabels: Record<string, string> = {};
  for (const f of fields) {
    customFieldLabels[f.id] = f.name;
  }

  const refsForRank: Pick<GhlReferenceData, "pipelineNameById"> = {
    pipelineNameById: new Map(pipelines.map((p) => [p.id, p.name])),
  };
  const rankPolicy = options.opportunityRankPolicy ?? DEFAULT_OPPORTUNITY_RANK_POLICY;
  const rankedOpps = rankOpportunitiesForContact(opps, refsForRank as GhlReferenceData, rankPolicy);
  const opportunityAmbiguous = opportunitiesNeedClarification(
    rankedOpps,
    refsForRank as GhlReferenceData,
    rankPolicy,
  );

  const opportunities = rankedOpps.map((opportunity) => {
    const pipeline = pipelineById.get(opportunity.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opportunity.pipelineStageId);
    const owner = opportunity.assignedTo ? userById.get(opportunity.assignedTo) : null;
    return {
      opportunity,
      pipelineName: pipeline?.name ?? null,
      stageName: stage?.name ?? null,
      ownerName: owner?.name ?? owner?.email ?? null,
    };
  });

  let nextAppointment: GhlCalendarEvent | null = null;
  if (options.includeAppointments !== false) {
    const events = await listEventsForContact(hydratedContact.id).catch(() => []);
    const now = Date.now();
    const upcoming = events
      .filter((e) => new Date(e.startTime).getTime() >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    nextAppointment = upcoming[0] ?? null;
  }

  let recentConversation: GhlConversation | null = null;
  let recentMessages: GhlMessage[] = [];
  if (options.includeConversations !== false) {
    const convResult = await searchConversations({
      contactId: hydratedContact.id,
      limit: 5,
    }).catch(() => ({
      conversations: [] as GhlConversation[],
      total: null as number | null,
    }));
    recentConversation = convResult.conversations[0] ?? null;
    if (recentConversation) {
      const msgs = await getConversationMessages(recentConversation.id, {
        limit: options.messageLimit ?? 8,
      }).catch(() => ({ messages: [] as GhlMessage[], hasMore: false }));
      recentMessages = msgs.messages;
    }
  }

  let clarificationMessage: string | null = null;
  if (opportunityAmbiguous && opportunities.length > 1) {
    const labels = opportunities
      .slice(0, 4)
      .map((item) => {
        const stage = item.stageName || "Unknown stage";
        const pipe = item.pipelineName || "Unknown pipeline";
        return `• ${pipe} — ${stage}`;
      })
      .join("\n");
    clarificationMessage = `This contact has multiple relevant opportunities:\n${labels}\nWhich pipeline/stage should I use?`;
  }

  const ownerUser = hydratedContact.assignedTo ? userById.get(hydratedContact.assignedTo) : null;

  return {
    retrievedAt,
    query,
    ambiguous: false,
    clarificationMessage,
    opportunityAmbiguous,
    contact: hydratedContact,
    opportunities,
    nextAppointment,
    recentConversation,
    recentMessages,
    customFieldLabels,
    contactOwnerName: ownerUser?.name ?? ownerUser?.email ?? null,
  };
}

function wantsFocus(focuses: GhlSnapshotFocus[], focus: GhlSnapshotFocus): boolean {
  return focuses.includes("general") || focuses.includes(focus);
}

/** Concise live customer snapshot for Baxter answers (omit empty fields). */
export function formatCustomerSnapshot(
  graph: GhlEntityGraph,
  options?: { question?: string | null },
): string {
  if (graph.ambiguous && graph.clarificationMessage) {
    return graph.clarificationMessage;
  }
  if (!graph.contact) {
    return "I couldn't find a matching GoHighLevel contact.";
  }

  const focuses = detectGhlSnapshotFocus(options?.question || graph.query || "");
  const c = graph.contact;
  const address = contactAddressFromGhl(c);
  const lines: string[] = [];
  const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Contact";
  lines.push(`CONTACT`);
  lines.push(`Name: ${name}`);
  lines.push(`Contact ID: ${c.id}`);

  const hardContactOnly =
    focuses.some((f) => f === "email" || f === "phone" || f === "address") &&
    !focuses.includes("opportunity") &&
    !focuses.includes("general") &&
    !focuses.includes("conversation");

  if (hardContactOnly) {
    if (focuses.includes("email")) {
      lines.push(`Email: ${c.email?.trim() || "(not saved)"}`);
      lines.push("Requested field: email");
    }
    if (focuses.includes("phone")) {
      lines.push(`Phone: ${c.phone?.trim() || "(not saved)"}`);
      lines.push("Requested field: phone");
    }
    if (focuses.includes("address")) {
      if (address.hasStreet && address.formatted) {
        lines.push(`Address: ${address.formatted}`);
        lines.push("Address status: loaded_present (street address saved in GHL)");
      } else if (address.present) {
        lines.push(`Address: ${address.formatted}`);
        lines.push(
          "Address status: loaded_missing_street (full contact loaded; city/region present but no street address saved in GHL)",
        );
      } else {
        lines.push("Address: (none saved in GoHighLevel)");
        lines.push(
          "Address status: loaded_missing (full contact loaded; no address fields saved in GHL)",
        );
      }
      lines.push("Requested field: address");
    }
    lines.push(`Retrieved: ${graph.retrievedAt}`);
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Contact");
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.companyName) lines.push(`Company: ${c.companyName}`);

  if (wantsFocus(focuses, "address") || wantsFocus(focuses, "general")) {
    if (address.hasStreet && address.formatted) {
      lines.push(`Address: ${address.formatted}`);
      lines.push("Address status: loaded_present (street address saved in GHL)");
    } else if (address.present) {
      lines.push(`Address: ${address.formatted}`);
      lines.push(
        "Address status: loaded_missing_street (full contact loaded; city/region present but no street address saved in GHL)",
      );
    } else {
      lines.push("Address: (none saved in GoHighLevel)");
      lines.push(
        "Address status: loaded_missing (full contact loaded; no address fields saved in GHL)",
      );
    }
  }

  // Phone/email always included above when present; reinforce for field-specific asks.
  if (wantsFocus(focuses, "phone") && c.phone) {
    lines.push(`Phone (requested): ${c.phone}`);
  }
  if (wantsFocus(focuses, "email") && c.email) {
    lines.push(`Email (requested): ${c.email}`);
  }

  if (graph.contactOwnerName || c.assignedTo) {
    if (wantsFocus(focuses, "owner") || wantsFocus(focuses, "general")) {
      lines.push(`Owner: ${graph.contactOwnerName || c.assignedTo}`);
    }
  }
  if (
    c.source &&
    (wantsFocus(focuses, "source") ||
      wantsFocus(focuses, "general") ||
      /\bsource\b/i.test(options?.question || ""))
  ) {
    lines.push(`Lead source: ${c.source}`);
  }
  if (c.tags?.length && (wantsFocus(focuses, "tags") || wantsFocus(focuses, "general"))) {
    lines.push(`Tags: ${c.tags.join(", ")}`);
  }
  if (c.dateAdded) lines.push(`Created: ${c.dateAdded}`);
  if (c.dateUpdated) lines.push(`Updated: ${c.dateUpdated}`);

  const customEntries = Object.entries(c.customFields || {}).slice(0, 12);
  if (
    customEntries.length &&
    (wantsFocus(focuses, "custom_fields") || wantsFocus(focuses, "general"))
  ) {
    lines.push("");
    lines.push("Custom fields");
    for (const [id, value] of customEntries) {
      if (value == null || value === "") continue;
      const label = graph.customFieldLabels[id] || id;
      lines.push(`${label}: ${String(value)}`);
    }
  }

  if (
    graph.opportunities.length &&
    (wantsFocus(focuses, "opportunity") || wantsFocus(focuses, "general"))
  ) {
    lines.push("");
    if (graph.opportunityAmbiguous && graph.clarificationMessage) {
      lines.push(graph.clarificationMessage);
      lines.push("");
    }
    for (const item of graph.opportunities.slice(0, 5)) {
      const o = item.opportunity;
      lines.push("Opportunity");
      lines.push(o.name || "Untitled opportunity");
      if (item.pipelineName) lines.push(item.pipelineName);
      if (item.stageName) lines.push(item.stageName);
      if (o.monetaryValue != null) {
        lines.push(`$${o.monetaryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      }
      if (item.ownerName) lines.push(`Owner: ${item.ownerName}`);
      if (o.status) lines.push(`Status: ${o.status}`);
      lines.push("");
    }
  }

  if (graph.nextAppointment && wantsFocus(focuses, "general")) {
    const ev = graph.nextAppointment;
    lines.push("Next Appointment");
    lines.push(
      new Date(ev.startTime).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
    if (ev.title) lines.push(ev.title);
    lines.push("");
  }

  if (
    graph.recentMessages.length &&
    (wantsFocus(focuses, "conversation") || wantsFocus(focuses, "general"))
  ) {
    const last = [...graph.recentMessages].sort((a, b) => {
      const ta = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
      const tb = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
      return tb - ta;
    })[0];
    if (last) {
      lines.push("Recent communication");
      if (last.dateAdded) {
        lines.push(
          `Last activity: ${new Date(last.dateAdded).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`,
        );
      }
      if (last.type) lines.push(`Channel/type: ${last.type}`);
      const who =
        last.direction === "inbound"
          ? "Last inbound"
          : last.direction === "outbound"
            ? "Last outbound"
            : "Latest message";
      if (last.body) lines.push(`${who}: ${last.body.slice(0, 200)}`);
      if (last.status) lines.push(`Status: ${last.status}`);
    }
  }

  lines.push("");
  lines.push(`Retrieved: ${graph.retrievedAt}`);
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}
