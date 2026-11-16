/**
 * PEM NEAT → GoHighLevel handoff payload.
 *
 * The BuilderTrend custom fields used to be copied by hand into BuilderTrend. They now go
 * to GoHighLevel contact custom fields named "JT - <BuilderTrend label>". Baxter posts them
 * to a GHL inbound-webhook workflow, which finds the contact and writes each field.
 *
 * Pure module (no server-only imports) so the mapping is unit-testable and can be shown
 * in the UI.
 */

import {
  BUILDERTREND_FIELD_DEFS,
  getCopyableValue,
  type BuildertrendFieldDef,
  type BuildertrendFieldKey,
} from "./buildertrend-display";
import type { BuildertrendFields } from "./schemas";

export type PemNeatGhlFieldMapping = {
  key: BuildertrendFieldKey;
  /** Field name shown in the PEM NEAT BuilderTrend panel. */
  builderTrendLabel: string;
  /** Contact custom field name in GoHighLevel. */
  ghlFieldName: string;
  /** Key in the webhook JSON body; map this in the GHL workflow. */
  payloadKey: string;
};

export function toPayloadKey(ghlFieldName: string): string {
  return ghlFieldName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const PEM_NEAT_GHL_FIELD_MAP: PemNeatGhlFieldMapping[] = BUILDERTREND_FIELD_DEFS.map(
  (def) => {
    const ghlFieldName = `JT - ${def.label}`;
    return {
      key: def.key,
      builderTrendLabel: def.label,
      ghlFieldName,
      payloadKey: toPayloadKey(ghlFieldName),
    };
  },
);

export type PemNeatGhlContact = {
  contactId: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
};

export type PemNeatGhlPayload = {
  source: "baxter_pem_neat";
  pem_neat_id: string;
  pem_neat_url: string | null;
  prospect_name: string;
  salesperson: string;
  meeting_date: string | null;
  synced_at: string;
  synced_by: string | null;
  contact_id: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  /** Same values keyed by the exact GHL custom field name, for reference/debugging. */
  fields_by_ghl_name: Record<string, string>;
} & Record<string, unknown>;

/** GHL-friendly value: copy-paste text, except multi-select priorities are comma-joined. */
export function ghlFieldValue(fields: BuildertrendFields, def: BuildertrendFieldDef): string {
  const copyable = getCopyableValue(fields, def);
  if (def.key === "customerPriorities" && copyable) {
    return copyable
      .split("\n")
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return copyable;
}

export function buildPemNeatGhlPayload(input: {
  pemNeatId: string;
  pemNeatUrl?: string | null;
  prospectName: string;
  salesperson: string;
  meetingDate: string | null;
  fields: BuildertrendFields;
  contact: PemNeatGhlContact;
  syncedBy?: string | null;
  now?: Date;
}): PemNeatGhlPayload {
  const flat: Record<string, string> = {};
  const byName: Record<string, string> = {};
  for (const mapping of PEM_NEAT_GHL_FIELD_MAP) {
    const def = BUILDERTREND_FIELD_DEFS.find((d) => d.key === mapping.key)!;
    const value = ghlFieldValue(input.fields, def);
    flat[mapping.payloadKey] = value;
    byName[mapping.ghlFieldName] = value;
  }

  return {
    source: "baxter_pem_neat",
    pem_neat_id: input.pemNeatId,
    pem_neat_url: input.pemNeatUrl ?? null,
    prospect_name: input.prospectName,
    salesperson: input.salesperson,
    meeting_date: input.meetingDate,
    synced_at: (input.now ?? new Date()).toISOString(),
    synced_by: input.syncedBy ?? null,
    contact_id: input.contact.contactId,
    email: input.contact.email,
    phone: input.contact.phone,
    contact_name: input.contact.name,
    ...flat,
    fields_by_ghl_name: byName,
  };
}

/** Number of mapped fields that carry a value (for the UI summary). */
export function countFilledGhlFields(fields: BuildertrendFields): number {
  return BUILDERTREND_FIELD_DEFS.filter((def) => ghlFieldValue(fields, def) !== "").length;
}
