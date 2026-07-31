import "server-only";

import {
  searchContacts,
  getContactById,
  hydrateGhlContact,
} from "@/lib/connectors/ghl/resources/contacts";
import { getGhlReferenceData, resolveUserDisplayName } from "@/lib/connectors/ghl/reference-data";
import { contactAddressFromGhl } from "@/lib/connectors/ghl/address";
import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import type { ProjectSetupContactSnapshot } from "./types";
import { buildDerivedProjectNames, resolveInviteMemberEmails } from "./names";
import { getProjectSetupSettings } from "./store";
import { computeNextProjectNumberFromColumnA, parseProjectNumber } from "./project-number";
import { readSheetColumnA } from "./sheets";

export type ProjectSetupSearchHit = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
};

export async function searchProjectSetupContacts(query: string): Promise<ProjectSetupSearchHit[]> {
  if (!isGhlConfigured()) {
    throw new Error("GoHighLevel is not connected. Connect GHL before searching customers.");
  }
  const trimmed = query.trim();
  if (!trimmed) return [];

  const result = await searchContacts({ query: trimmed, limit: 15 });
  return result.contacts.map((c) => {
    const address = contactAddressFromGhl(c);
    const name =
      c.name?.trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      c.id;
    return {
      id: c.id,
      name,
      email: c.email,
      phone: c.phone,
      address: address.formatted,
      city: c.city,
      postalCode: c.postalCode,
    };
  });
}

export async function loadProjectSetupContactSnapshot(
  contactId: string,
): Promise<ProjectSetupContactSnapshot> {
  if (!isGhlConfigured()) {
    throw new Error("GoHighLevel is not connected.");
  }
  const raw = await getContactById(contactId);
  if (!raw) throw new Error("Contact not found in GoHighLevel.");
  const contact = await hydrateGhlContact(raw);
  const refs = await getGhlReferenceData().catch(() => null);
  const assignedUserName = contact.assignedTo
    ? resolveUserDisplayName(refs, contact.assignedTo)
    : null;
  const address = contactAddressFromGhl(contact);
  return {
    id: contact.id,
    name:
      contact.name?.trim() ||
      [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
      null,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    address: address.formatted,
    city: contact.city,
    state: contact.state,
    postalCode: contact.postalCode,
    assignedUserId: contact.assignedTo,
    assignedUserName,
  };
}

export async function computeLiveNextProjectNumber(): Promise<{
  nextNumber: string;
  sourceValue: string;
  sourceRowIndex: number;
  tabName: string;
}> {
  const settings = await getProjectSetupSettings();
  const values = await readSheetColumnA({
    spreadsheetId: settings.masterCharterSpreadsheetId,
    tabName: settings.masterLogTabName,
  });
  const computed = computeNextProjectNumberFromColumnA(values);
  return {
    ...computed,
    tabName: settings.masterLogTabName,
  };
}

export async function buildProjectSetupPreview(input: {
  contact: ProjectSetupContactSnapshot;
  salesRep?: string | null;
  projectNumber?: string | null;
  fpPaidDate?: string | null;
  lastNameOverride?: string | null;
}) {
  const settings = await getProjectSetupSettings();
  let projectNumber = input.projectNumber?.trim().toUpperCase() || null;
  let numberSource: "override" | "live" = "override";
  let numberEvidence: Record<string, unknown> | null = null;

  if (projectNumber) {
    if (!parseProjectNumber(projectNumber)) {
      throw new Error(`Invalid project number "${projectNumber}". Expected format like L01-26017.`);
    }
  } else {
    const live = await computeLiveNextProjectNumber();
    projectNumber = live.nextNumber;
    numberSource = "live";
    numberEvidence = live;
  }

  const lastName =
    input.lastNameOverride?.trim() ||
    input.contact.lastName?.trim() ||
    input.contact.name?.trim()?.split(/\s+/).pop() ||
    "Customer";

  const derived = buildDerivedProjectNames({
    projectNumber,
    lastName,
  });
  const members = resolveInviteMemberEmails(settings);

  return {
    contact: input.contact,
    salesRep: input.salesRep?.trim() || input.contact.assignedUserName || "",
    fpPaidDate: input.fpPaidDate || new Date().toISOString().slice(0, 10),
    jurisdiction: input.contact.city,
    projectNumber,
    numberSource,
    numberEvidence,
    ...derived,
    inviteEmails: members.emails,
    inviteLabel: members.label,
    testMode: members.testMode,
    dryRun: true,
    settings: {
      testMode: settings.testMode,
      masterLogTabName: settings.masterLogTabName,
    },
  };
}
