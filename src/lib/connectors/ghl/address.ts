import {
  detectRequestedGhlFields,
  type GhlRequestedField,
} from "@/lib/baxter-data/ghl/field-aliases";

import type { GhlContact } from "./types";

export type GhlContactAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /** Inline formatted address, or null when no address components exist. */
  formatted: string | null;
  /** True when any address component is present (including city-only). */
  present: boolean;
  /** True when a street line exists. */
  hasStreet: boolean;
};

/**
 * Structured address from a normalized GHL contact.
 * Does not invent missing components.
 */
export function contactAddressFromGhl(
  contact: Pick<GhlContact, "address1" | "city" | "state" | "postalCode" | "country">,
): GhlContactAddress {
  const line1 = contact.address1?.trim() || null;
  const city = contact.city?.trim() || null;
  const state = contact.state?.trim() || null;
  const postalCode = contact.postalCode?.trim() || null;
  const country = contact.country?.trim() || null;
  const hasStreet = Boolean(line1);
  const present = Boolean(line1 || city || state || postalCode || country);

  let formatted: string | null = null;
  if (present) {
    const cityStateZip = [city, [state, postalCode].filter(Boolean).join(" ").trim() || null]
      .filter(Boolean)
      .join(", ");
    formatted = [
      line1,
      cityStateZip || null,
      country && country !== "US" && country !== "USA" ? country : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  return {
    line1,
    line2: null,
    city,
    state,
    postalCode,
    country,
    formatted: formatted || null,
    present,
    hasStreet,
  };
}

/** Multiline display for admin UI. */
export function formatGhlAddressMultiline(address: GhlContactAddress): string | null {
  if (!address.present) return null;
  const lines: string[] = [];
  if (address.line1) lines.push(address.line1);
  if (address.line2) lines.push(address.line2);
  const cityStateZip = [
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" ").trim() || null,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) lines.push(cityStateZip);
  if (address.country && address.country !== "US" && address.country !== "USA") {
    lines.push(address.country);
  }
  return lines.join("\n") || null;
}

export type GhlSnapshotFocus =
  | "address"
  | "phone"
  | "email"
  | "owner"
  | "tags"
  | "source"
  | "custom_fields"
  | "opportunity"
  | "conversation"
  | "general";

/** Contact-level facets that must not be blocked by opportunity ambiguity. */
const HARD_CONTACT_FOCUSES: ReadonlySet<GhlSnapshotFocus> = new Set([
  "address",
  "phone",
  "email",
  "tags",
  "source",
  "custom_fields",
]);

const CONTACT_LEVEL_FOCUSES: ReadonlySet<GhlSnapshotFocus> = new Set([
  ...HARD_CONTACT_FOCUSES,
  "owner",
  "conversation",
]);

/**
 * True when the question targets contact (or conversation) data, not opportunity stage/value.
 * When both contact and opportunity terms appear (e.g. "Feasibility Pipeline, but what's their address?"),
 * hard contact fields win so opportunity clarification does not block the answer.
 */
export function isContactLevelGhlQuestion(question: string): boolean {
  const focuses = detectGhlSnapshotFocus(question);
  if (focuses.some((f) => HARD_CONTACT_FOCUSES.has(f))) return true;
  const hasContact = focuses.some((f) => CONTACT_LEVEL_FOCUSES.has(f));
  const hasOpportunity = focuses.includes("opportunity");
  return hasContact && !hasOpportunity;
}

/** Detect whether a free-text query is likely targeting address fields. */
export function isLikelyAddressSearchQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return false;
  // ZIP / ZIP+4
  if (/^\d{3,10}(-\d{4})?$/.test(q)) return true;
  // Street-like: leading house number
  if (/^\d+\s+\S+/.test(q)) return true;
  // Partial street / city / state tokens (admin list search)
  if (
    /\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|hwy|highway)\b/i.test(q)
  ) {
    return true;
  }
  // City / state / partial formatted address (letters with optional spaces/commas)
  if (/^[a-zA-Z][a-zA-Z\s.',-]{1,80}$/.test(q)) return true;
  return false;
}

/**
 * GHL POST /contacts/search filter group for address fields.
 * Field names match HighLevel contact schema: address1, city, state, postalCode, country.
 */
export function buildGhlAddressSearchFilters(query: string): Array<Record<string, unknown>> {
  const value = query.trim();
  if (!value) return [];
  return [
    {
      group: "OR",
      filters: [
        { field: "address1", operator: "contains", value },
        { field: "city", operator: "contains", value },
        { field: "state", operator: "contains", value },
        { field: "postalCode", operator: "contains", value },
        { field: "country", operator: "contains", value },
      ],
    },
  ];
}

/** Local match helper after hydration (partial formatted address, street, city, state, ZIP). */
export function contactMatchesAddressQuery(
  contact: Pick<GhlContact, "address1" | "city" | "state" | "postalCode" | "country">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const address = contactAddressFromGhl(contact);
  const haystacks = [
    address.line1,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.formatted,
    formatGhlAddressMultiline(address)?.replace(/\n/g, ", ") ?? null,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return haystacks.some((h) => h.includes(q));
}

/** Detect which CRM facets the employee question emphasizes. */
export function detectGhlSnapshotFocus(question: string): GhlSnapshotFocus[] {
  const fields = detectRequestedGhlFields(question);
  const focuses: GhlSnapshotFocus[] = [];
  if (fields.includes("address")) focuses.push("address");
  if (fields.includes("phone")) focuses.push("phone");
  if (fields.includes("email")) focuses.push("email");
  if (fields.includes("owner")) focuses.push("owner");
  if (fields.includes("tags")) focuses.push("tags");
  if (fields.includes("source")) focuses.push("source");
  if (fields.includes("stage") || fields.includes("pipeline") || fields.includes("value")) {
    focuses.push("opportunity");
  }

  const q = question.toLowerCase();
  if (/\b(custom field|lead city|utm|source field)\b/.test(q)) {
    focuses.push("custom_fields");
  }
  if (
    /\b(last (talk|contact|message|email|call|communicat)|when did we|replied|conversation)\b/.test(
      q,
    )
  ) {
    focuses.push("conversation");
  }
  if (!focuses.length) focuses.push("general");
  return focuses;
}

function formatContactFieldLine(
  field: GhlRequestedField,
  contact: Pick<
    GhlContact,
    "email" | "phone" | "address1" | "city" | "state" | "postalCode" | "country"
  >,
): { label: string; value: string | null; missing: string } {
  const address = contactAddressFromGhl(contact);
  switch (field) {
    case "email":
      return {
        label: "Email",
        value: contact.email?.trim() || null,
        missing: "an email address",
      };
    case "phone":
      return {
        label: "Phone",
        value: contact.phone?.trim() || null,
        missing: "a phone number",
      };
    case "address":
      return {
        label: "Address",
        value: address.hasStreet && address.formatted ? address.formatted : null,
        missing:
          address.present && !address.hasStreet
            ? "a street address (only city/region is saved)"
            : "an address",
      };
    default:
      return { label: field, value: null, missing: `a ${field}` };
  }
}

/**
 * Deterministic CRM contact-field answers from a hydrated GHL contact.
 * Returns ALL requested contact fields with explicit missing notes — never silently omits one.
 */
export function buildDeterministicGhlContactFieldAnswer(
  question: string,
  contact: Pick<
    GhlContact,
    | "firstName"
    | "lastName"
    | "name"
    | "email"
    | "phone"
    | "address1"
    | "city"
    | "state"
    | "postalCode"
    | "country"
  >,
  requestedFields?: GhlRequestedField[],
): string | null {
  const name =
    contact.name?.trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    "This contact";
  const address = contactAddressFromGhl(contact);
  const q = question.toLowerCase();
  const wantsCityOnly = /\bcity\b/.test(q) && !/\b(address|street|zip|postal)\b/.test(q);

  if (wantsCityOnly) {
    if (contact.city?.trim()) {
      return `${name} is in ${contact.city.trim()} in GoHighLevel.`;
    }
    if (address.present) {
      return `I checked the full GoHighLevel contact record for ${name}. It has address details, but no city is saved.`;
    }
    return `I checked the full GoHighLevel contact record for ${name}. No city is saved.`;
  }

  const fields =
    requestedFields?.filter((f) => f === "email" || f === "phone" || f === "address") ??
    detectRequestedGhlFields(question).filter(
      (f) => f === "email" || f === "phone" || f === "address",
    );

  if (!fields.length) return null;

  const lines: string[] = [];
  const missing: string[] = [];
  for (const field of fields) {
    const line = formatContactFieldLine(field, contact);
    if (line.value) lines.push(`• ${line.label}: ${line.value}`);
    else missing.push(line.missing);
  }

  if (fields.length === 1) {
    const field = fields[0]!;
    const line = formatContactFieldLine(field, contact);
    if (line.value) {
      if (field === "email") return `${name}'s email in GoHighLevel is ${line.value}.`;
      if (field === "phone") return `${name}'s phone number in GoHighLevel is ${line.value}.`;
      if (field === "address") return `${name}'s address in GoHighLevel is ${line.value}.`;
    }
    if (field === "address" && address.present && !address.hasStreet) {
      const place = contact.city?.trim() || address.formatted;
      return `I checked the full GoHighLevel contact record. It lists ${place}, but no street address is saved.`;
    }
    return `I found ${name} in GoHighLevel, but the contact record does not include ${line.missing}.`;
  }

  if (!lines.length) {
    return `I found ${name} in GoHighLevel, but the contact record does not include ${missing.join(" or ")}.`;
  }

  const header = `${name}'s GHL contact information:`;
  if (!missing.length) return `${header}\n${lines.join("\n")}`;
  const missingNote =
    missing.length === 1
      ? `I don't have ${missing[0]} in the GHL contact record.`
      : `I don't have ${missing.join(" or ")} in the GHL contact record.`;
  return `${header}\n${lines.join("\n")}\n${missingNote}`;
}

/** Deterministic opportunity stage/pipeline answer from a hydrated entity graph row. */
export function buildDeterministicGhlOpportunityAnswer(input: {
  contactName: string;
  pipelineName: string | null;
  stageName: string | null;
  requestedFields: GhlRequestedField[];
}): string | null {
  const name = input.contactName.trim() || "This contact";
  const wantsStage =
    input.requestedFields.includes("stage") || input.requestedFields.includes("other");
  const wantsPipeline = input.requestedFields.includes("pipeline");
  const stage = input.stageName?.trim() || null;
  const pipeline = input.pipelineName?.trim() || null;

  if (!stage && !pipeline) return null;

  if (wantsPipeline && !wantsStage) {
    if (pipeline) return `${name} is in the ${pipeline} in GoHighLevel.`;
    return `I found ${name} in GoHighLevel, but I couldn't resolve the pipeline name.`;
  }

  if (stage && pipeline) {
    return `${name} is currently in ${stage} in the ${pipeline}.`;
  }
  if (stage) return `${name} is currently in ${stage}.`;
  if (pipeline) return `${name} is in the ${pipeline}.`;
  return null;
}

/** Broad "information about X" chat/Slack summary — contact + opportunity + Customer Center link. */
export function buildGhlContactInformationAnswer(input: {
  contact: Pick<
    GhlContact,
    | "id"
    | "firstName"
    | "lastName"
    | "name"
    | "email"
    | "phone"
    | "address1"
    | "city"
    | "state"
    | "postalCode"
    | "country"
  >;
  pipelineName?: string | null;
  stageName?: string | null;
  opportunityName?: string | null;
  opportunityCount?: number;
}): string {
  const name =
    input.contact.name?.trim() ||
    [input.contact.firstName, input.contact.lastName].filter(Boolean).join(" ").trim() ||
    "This contact";
  const address = contactAddressFromGhl(input.contact);
  const lines: string[] = [`Here's what I found in GoHighLevel for ${name}:`];

  if (input.contact.email?.trim()) lines.push(`• Email: ${input.contact.email.trim()}`);
  if (input.contact.phone?.trim()) lines.push(`• Phone: ${input.contact.phone.trim()}`);
  if (address.formatted) lines.push(`• Address: ${address.formatted}`);

  const stage = input.stageName?.trim() || null;
  const pipeline = input.pipelineName?.trim() || null;
  const oppName = input.opportunityName?.trim() || null;
  if (stage || pipeline || oppName) {
    const bits = [oppName, pipeline && stage ? `${pipeline} — ${stage}` : stage || pipeline]
      .filter(Boolean)
      .join(" · ");
    lines.push(`• Opportunity: ${bits}`);
    if ((input.opportunityCount ?? 0) > 1) {
      lines.push(`• Also ${input.opportunityCount! - 1} more opportunity(ies) on this contact.`);
    }
  } else {
    lines.push("• Opportunities: none on file");
  }

  lines.push(
    `• Customer Center: https://acton-baxter.vercel.app/customers/lookup?contactId=${encodeURIComponent(input.contact.id)}`,
  );
  return lines.join("\n");
}

/** True for open-ended “info about …” asks (not a single field like email/phone/stage). */
export function isBroadGhlEntityInfoQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (
    /\b(e-?mail|phone|address|city|zip|postal|stage|pipeline|tag|owner|source)\b/i.test(q) &&
    !/\b(information|info|details)\b/i.test(q)
  ) {
    return false;
  }
  return (
    /\b(give|get|show|tell)\s+(me\s+)?(more\s+)?(information|info|details)\b/i.test(q) ||
    /\b(information|info|details)\s+(about|on|for)\b/i.test(q) ||
    /\b(tell me about|who is|what do (?:we|you) know about)\b/i.test(q) ||
    /\b(full picture|everything (?:about|on)|look(?:\s*up)?)\b/i.test(q)
  );
}
