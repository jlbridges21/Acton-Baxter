/**
 * Hand the customer's configuration to GoHighLevel after they submit one of the existing
 * embedded GHL forms. The forms themselves (IDs, consent, workflows) are untouched — GHL
 * receives submissions directly from its iframe.
 *
 * The legacy site wrote these `cfg_*` custom fields on a contact it created for every
 * visitor. Here we only write to the contact that just submitted a form, and only the
 * configurator's own fields. Off unless CONFIGURATOR_GHL_SYNC=true (and Baxter's GHL
 * connector is enabled), so nothing reaches the CRM until it has been verified with a test
 * contact.
 */

import "server-only";

import { ghlPut } from "@/lib/connectors/ghl/client";
import { isGhlConfigured, isGhlEnabled } from "@/lib/connectors/ghl/config";
import {
  findContactByEmail,
  findContactByPhone,
  getContactById,
} from "@/lib/connectors/ghl/resources/contacts";
import { listCustomFields } from "@/lib/connectors/ghl/resources/custom-fields";

/** Field keys the legacy configurator used (contact custom fields). */
export const CONFIGURATOR_GHL_FIELDS = [
  "cfg_series",
  "cfg_model",
  "cfg_cb_design",
  "cfg_model_option",
  "cfg_exterior",
  "cfg_interior",
  "cfg_appliances",
  "cfg_upgrades",
  "cfg_bathrooms",
  "cfg_view_mode",
  "cfg_is_mirrored",
  "cfg_last_section",
  "property_address",
  "property_city",
  "property_zip",
] as const;

export type ConfiguratorGhlField = (typeof CONFIGURATOR_GHL_FIELDS)[number];

/** A contact must have been created or updated this recently to accept configurator fields. */
const RECENT_CONTACT_MS = 30 * 60 * 1000;

export function isConfiguratorGhlSyncEnabled(): boolean {
  return process.env.CONFIGURATOR_GHL_SYNC === "true" && isGhlEnabled() && isGhlConfigured();
}

export type GhlSyncInput = {
  contactId?: string;
  email?: string;
  phone?: string;
  fields: Partial<Record<ConfiguratorGhlField, string>>;
};

export type GhlSyncResult =
  | { status: "synced"; contactId: string; fields: string[] }
  | { status: "disabled" | "not_found" | "not_recent" | "no_fields" };

export async function syncConfigurationToGhl(
  input: GhlSyncInput,
  now = Date.now(),
): Promise<GhlSyncResult> {
  if (!isConfiguratorGhlSyncEnabled()) return { status: "disabled" };

  const contact =
    (input.contactId ? await getContactById(input.contactId) : null) ??
    (input.email ? await findContactByEmail(input.email) : null) ??
    (input.phone ? await findContactByPhone(input.phone) : null);
  if (!contact) return { status: "not_found" };

  const touched = Date.parse(contact.dateUpdated ?? contact.dateAdded ?? "");
  if (!Number.isFinite(touched) || now - touched > RECENT_CONTACT_MS)
    return { status: "not_recent" };

  const defs = await listCustomFields();
  const byKey = new Map(defs.map((d) => [d.fieldKey.replace(/^contact\./, ""), d.id]));
  const customFields = Object.entries(input.fields)
    .filter(
      ([key, value]) =>
        (CONFIGURATOR_GHL_FIELDS as readonly string[]).includes(key) && typeof value === "string",
    )
    .flatMap(([key, value]) => {
      const id = byKey.get(key);
      return id ? [{ id, field_value: value!.slice(0, 2000) }] : [];
    });
  if (customFields.length === 0) return { status: "no_fields" };

  await ghlPut(
    `/contacts/${encodeURIComponent(contact.id)}`,
    { customFields },
    { resource: "contacts", injectLocationId: false },
  );
  return { status: "synced", contactId: contact.id, fields: customFields.map((f) => f.id) };
}
