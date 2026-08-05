/**
 * Clarifying source menu for open-ended entity asks.
 * Existence probes only — never fetches full PEM/GHL/Slack content.
 */

import "server-only";

import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import { searchContacts } from "@/lib/connectors/ghl/resources/contacts";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  buildPemProspectIndex,
  matchProspectInIndex,
} from "@/lib/baxter-data/pem-neats/prospect-index";
import {
  resolveProjectSlackChannelForContact,
  type ResolveProjectSlackChannelDeps,
} from "@/lib/dossier/project-slack-channel-resolve";
import type { GhlContact } from "@/lib/connectors/ghl/types";

export type EntitySourceAvailability = {
  displayName: string;
  ghl: { available: boolean; contactId: string | null; email: string | null };
  pem: { available: boolean; pemId: string | null; prospectName: string | null };
  slack: {
    available: boolean;
    channelName: string | null;
    channelId: string | null;
  };
};

export type ProbeEntitySourcesDeps = ResolveProjectSlackChannelDeps & {
  ghlConfigured?: () => boolean;
  searchGhlContacts?: (query: string) => Promise<GhlContact[]>;
  listPemIndex?: () => Promise<
    Array<{ pemId: string; prospectName: string; normalizedName: string; baseName: string }>
  >;
};

function possessive(name: string): string {
  const n = name.trim();
  if (!n) return "their";
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

function firstName(displayName: string): string {
  const part = displayName.trim().split(/\s+/)[0];
  return part || displayName.trim();
}

function pickBestGhlContact(contacts: GhlContact[], query: string): GhlContact | null {
  if (contacts.length === 0) return null;
  const q = (normalizeEntitySearchName(query) || query).trim().toLowerCase();
  if (!q) return contacts[0] ?? null;
  const scored = contacts.map((c) => {
    const name = (c.name || `${c.firstName ?? ""} ${c.lastName ?? ""}`).trim().toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.includes(q) || q.includes(name)) score = 80;
    else {
      const qt = q.split(/\s+/).filter(Boolean);
      const nt = name.split(/\s+/).filter(Boolean);
      const overlap = qt.filter((t) => nt.includes(t)).length;
      score = overlap * 25;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.score >= 50 ? scored[0]!.c : (contacts[0] ?? null);
}

/**
 * Cheap existence checks for GHL / PEM / linked Project Setup Slack channel.
 */
export async function probeEntitySourceAvailability(
  entityName: string,
  deps: ProbeEntitySourcesDeps = {},
): Promise<EntitySourceAvailability> {
  const displayName = normalizeEntitySearchName(entityName) || entityName.trim();
  const empty: EntitySourceAvailability = {
    displayName,
    ghl: { available: false, contactId: null, email: null },
    pem: { available: false, pemId: null, prospectName: null },
    slack: { available: false, channelName: null, channelId: null },
  };
  if (!displayName) return empty;

  const ghlConfigured = deps.ghlConfigured ?? isGhlConfigured;
  const searchGhl =
    deps.searchGhlContacts ??
    (async (query: string) => {
      const result = await searchContacts({ query, limit: 8 });
      return result.contacts;
    });

  let ghlContact: GhlContact | null = null;
  if (ghlConfigured()) {
    try {
      const contacts = await searchGhl(displayName);
      ghlContact = pickBestGhlContact(contacts, displayName);
    } catch {
      ghlContact = null;
    }
  }

  if (ghlContact) {
    empty.ghl = {
      available: true,
      contactId: ghlContact.id,
      email: ghlContact.email ?? null,
    };
    const resolvedName =
      ghlContact.name?.trim() ||
      [ghlContact.firstName, ghlContact.lastName].filter(Boolean).join(" ").trim();
    if (resolvedName) empty.displayName = resolvedName;
  }

  try {
    const fullIndex =
      deps.listPemIndex != null
        ? (await deps.listPemIndex()).map((e) => ({
            pemId: e.pemId,
            prospectName: e.prospectName,
            normalizedName: e.normalizedName,
            baseName: e.baseName,
            normalizedBase: e.baseName.toLowerCase(),
            salesperson: "",
            meetingDate: null,
            status: "completed",
          }))
        : await buildPemProspectIndex({ includeNeedsRegeneration: true });
    const matches = matchProspectInIndex(displayName, fullIndex);
    if (matches[0]) {
      empty.pem = {
        available: true,
        pemId: matches[0].entry.pemId,
        prospectName: matches[0].entry.prospectName,
      };
    }
  } catch {
    // PEM probe failure → treat as unavailable
  }

  const contactId = empty.ghl.contactId;
  if (contactId) {
    try {
      const channel = await resolveProjectSlackChannelForContact({
        ghlContactId: contactId,
        contactDisplayName: empty.displayName,
        deps,
      });
      if (channel) {
        const channelName = channel.channelName?.replace(/^#/, "").trim() || null;
        empty.slack = {
          available: Boolean(channelName || channel.channelId),
          channelName,
          channelId: channel.channelId,
        };
      }
    } catch {
      // Slack probe failure → unavailable
    }
  }

  return empty;
}

export type ClarifyingMenuDecision =
  | { kind: "menu"; answer: string; availability: EntitySourceAvailability }
  | { kind: "skip_single_source"; availability: EntitySourceAvailability }
  | { kind: "skip_none"; availability: EntitySourceAvailability };

/**
 * Format a clarifying menu when 2+ sources exist.
 * Single-source → skip menu (answer directly — a one-item menu is noise).
 * Zero sources → skip (normal miss path).
 */
export function decideEntitySourceClarifyingMenu(
  availability: EntitySourceAvailability,
): ClarifyingMenuDecision {
  const name = availability.displayName;
  const poss = possessive(firstName(name));
  const options: string[] = [];

  if (availability.pem.available) {
    options.push(`${poss} reason for building an ADU and sales notes (from ${poss} PEM NEAT)`);
  }
  if (availability.ghl.available) {
    options.push(`${poss} contact info from GoHighLevel`);
  }
  if (availability.slack.available) {
    const channel = availability.slack.channelName
      ? `#${availability.slack.channelName.replace(/^#/, "")}`
      : "the linked project Slack channel";
    options.push(`the latest updates from ${channel}`);
  }

  if (options.length === 0) {
    return { kind: "skip_none", availability };
  }
  if (options.length === 1) {
    // One category only — answering directly is clearer than a one-item menu.
    return { kind: "skip_single_source", availability };
  }

  const list =
    options.length === 2
      ? `${options[0]}, or ${options[1]}`
      : `${options.slice(0, -1).join(", ")}, or ${options[options.length - 1]}`;

  return {
    kind: "menu",
    answer: `I can tell you about ${list}. What would you like to know?`,
    availability,
  };
}
