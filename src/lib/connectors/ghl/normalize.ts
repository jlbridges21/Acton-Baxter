import "server-only";

import type {
  GhlContact,
  GhlOpportunity,
  GhlPipeline,
  GhlPipelineStage,
  GhlConversation,
  GhlMessage,
  GhlUser,
  GhlCalendar,
  GhlCalendarEvent,
  GhlCustomFieldDef,
  GhlTag,
  GhlPhoneNumber,
} from "./types";
import { getCachedReference } from "./cache";

type RawContact = Record<string, unknown>;
type RawOpportunity = Record<string, unknown>;
type RawPipeline = Record<string, unknown>;
type RawConversation = Record<string, unknown>;
type RawMessage = Record<string, unknown>;
type RawUser = Record<string, unknown>;
type RawCalendar = Record<string, unknown>;
type RawCalendarEvent = Record<string, unknown>;
type RawCustomFieldDef = Record<string, unknown>;
type RawTag = Record<string, unknown>;
type RawPhoneNumber = Record<string, unknown>;

function asString(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value === null || value === undefined) return null;
  return String(value) || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return defaultValue;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string" && v.length > 0);
  }
  return [];
}

function normalizeCustomFields(raw: unknown): Record<string, unknown> {
  if (!raw) return {};

  if (Array.isArray(raw)) {
    const result: Record<string, unknown> = {};
    for (const field of raw) {
      if (field && typeof field === "object") {
        const f = field as { id?: string; key?: string; field_value?: unknown; value?: unknown };
        const key = f.key || f.id;
        const value = f.field_value ?? f.value;
        if (key) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>;
  }

  return {};
}

export function normalizeContact(raw: RawContact, locationId?: string): GhlContact {
  const customFields = normalizeCustomFields(raw.customFields ?? raw.customField);
  const computedName =
    asString(raw.name) ??
    ([asString(raw.firstName), asString(raw.lastName)].filter(Boolean).join(" ") || null);

  return {
    id: asString(raw.id) ?? "",
    locationId: asString(raw.locationId) ?? locationId ?? "",
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    name: computedName,
    email: asString(raw.email),
    phone: asString(raw.phone),
    companyName: asString(raw.companyName),
    // GHL commonly uses address1; some payloads use address / addressLine1.
    address1:
      asString(raw.address1) ??
      asString(raw.address) ??
      asString(raw.addressLine1) ??
      asString(raw.address_line_1),
    city: asString(raw.city),
    state: asString(raw.state),
    postalCode: asString(raw.postalCode) ?? asString(raw.zip) ?? asString(raw.zipCode),
    country: asString(raw.country),
    source: asString(raw.source),
    tags: asStringArray(raw.tags),
    customFields,
    dateAdded: asString(raw.dateAdded),
    dateUpdated: asString(raw.dateUpdated),
    dnd: asBoolean(raw.dnd),
    assignedTo: asString(raw.assignedTo),
  };
}

export function normalizeOpportunity(raw: RawOpportunity): GhlOpportunity {
  const contact = raw.contact as { id?: string } | undefined;
  const customFields = normalizeCustomFields(raw.customFields);

  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    pipelineId: asString(raw.pipelineId) ?? "",
    pipelineStageId: asString(raw.pipelineStageId) ?? "",
    status: asString(raw.status) ?? "open",
    monetaryValue: asNumber(raw.monetaryValue),
    contactId: asString(raw.contactId) ?? asString(contact?.id) ?? "",
    assignedTo: asString(raw.assignedTo),
    source: asString(raw.source),
    dateAdded: asString(raw.dateAdded),
    dateUpdated: asString(raw.dateUpdated),
    customFields,
  };
}

export function normalizePipelineStage(raw: RawPipeline): GhlPipelineStage {
  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    position: asNumber(raw.position) ?? 0,
  };
}

export function normalizePipeline(raw: RawPipeline, locationId?: string): GhlPipeline {
  const rawStages = raw.stages as RawPipeline[] | undefined;

  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    locationId: asString(raw.locationId) ?? locationId ?? "",
    stages: Array.isArray(rawStages) ? rawStages.map(normalizePipelineStage) : [],
  };
}

export function normalizeConversation(raw: RawConversation): GhlConversation {
  const directionRaw = (asString(raw.lastMessageDirection) ?? "").toLowerCase();
  return {
    id: asString(raw.id) ?? "",
    locationId: asString(raw.locationId) ?? "",
    contactId: asString(raw.contactId) ?? "",
    type: asString(raw.type) ?? "unknown",
    unreadCount: asNumber(raw.unreadCount) ?? 0,
    lastMessageAt: asString(raw.lastMessageDate) ?? asString(raw.lastMessageAt),
    lastMessageBody: asString(raw.lastMessageBody),
    lastMessageType: asString(raw.lastMessageType),
    lastMessageDirection:
      directionRaw === "inbound" ? "inbound" : directionRaw === "outbound" ? "outbound" : "unknown",
    dateAdded: asString(raw.dateAdded),
    dateUpdated: asString(raw.dateUpdated),
  };
}

export function normalizeMessage(raw: RawMessage): GhlMessage {
  const attachmentsRaw = raw.attachments;
  const attachments: GhlMessage["attachments"] = [];
  if (Array.isArray(attachmentsRaw)) {
    for (const item of attachmentsRaw) {
      if (typeof item === "string" && item.trim()) {
        attachments.push({ url: item });
      } else if (item && typeof item === "object") {
        const obj = item as { url?: unknown; contentType?: unknown };
        const url = typeof obj.url === "string" ? obj.url : null;
        if (url) {
          attachments.push({
            url,
            contentType: typeof obj.contentType === "string" ? obj.contentType : undefined,
          });
        }
      }
    }
  }

  // GHL returns numeric `type` plus string `messageType` (e.g. TYPE_EMAIL). Prefer messageType.
  const messageType =
    asString(raw.messageType) ??
    (typeof raw.type === "string" && /[A-Za-z]/.test(raw.type) ? raw.type : null) ??
    "unknown";

  const directionRaw = (asString(raw.direction) ?? "").toLowerCase();
  const direction: GhlMessage["direction"] =
    directionRaw === "inbound" ? "inbound" : directionRaw === "outbound" ? "outbound" : "unknown";

  const meta =
    raw.meta && typeof raw.meta === "object" ? (raw.meta as Record<string, unknown>) : null;
  const metaEmail =
    meta?.email && typeof meta.email === "object" ? (meta.email as Record<string, unknown>) : null;
  const nestedEmail =
    metaEmail?.email && typeof metaEmail.email === "object"
      ? (metaEmail.email as Record<string, unknown>)
      : metaEmail;
  const emailMessageIdsRaw = nestedEmail?.messageIds;
  const emailMessageIds = Array.isArray(emailMessageIdsRaw)
    ? emailMessageIdsRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  const toRaw = raw.to ?? raw.emailTo;
  const toAddresses = Array.isArray(toRaw)
    ? toRaw.filter((v): v is string => typeof v === "string")
    : typeof toRaw === "string" && toRaw.trim()
      ? [toRaw]
      : [];

  const body =
    asString(raw.body) ?? asString(raw.message) ?? asString(raw.text) ?? asString(raw.textBody);
  const htmlBody = asString(raw.html) ?? asString(raw.htmlBody);
  const subject = asString(raw.subject);
  const fromAddress = asString(raw.from) ?? asString(raw.emailFrom) ?? asString(raw.fromEmail);

  return {
    id: asString(raw.id) ?? "",
    conversationId: asString(raw.conversationId) ?? "",
    contactId: asString(raw.contactId) ?? "",
    locationId: asString(raw.locationId) ?? "",
    type: messageType,
    direction,
    body,
    textBody:
      asString(raw.textBody) ??
      asString(raw.message) ??
      (body && !/<[a-z]/i.test(body) ? body : null),
    htmlBody,
    subject,
    fromAddress,
    toAddresses,
    emailMessageIds,
    threadId: asString(raw.threadId),
    status: asString(raw.status),
    dateAdded: asString(raw.dateAdded),
    attachments,
  };
}

export function normalizeUser(raw: RawUser): GhlUser {
  const permissions = raw.permissions as Record<string, unknown> | undefined;

  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    email: asString(raw.email) ?? "",
    phone: asString(raw.phone),
    role: asString(raw.role),
    permissions: permissions ?? {},
  };
}

export function normalizeCalendar(raw: RawCalendar): GhlCalendar {
  return {
    id: asString(raw.id) ?? "",
    locationId: asString(raw.locationId) ?? "",
    name: asString(raw.name) ?? "",
    description: asString(raw.description),
    isActive: asBoolean(raw.isActive, true),
    groupId: asString(raw.groupId),
  };
}

export function normalizeCalendarEvent(raw: RawCalendarEvent): GhlCalendarEvent {
  return {
    id: asString(raw.id) ?? "",
    calendarId: asString(raw.calendarId) ?? "",
    locationId: asString(raw.locationId) ?? "",
    contactId: asString(raw.contactId),
    title: asString(raw.title) ?? "",
    appointmentStatus: asString(raw.appointmentStatus),
    startTime: asString(raw.startTime) ?? "",
    endTime: asString(raw.endTime) ?? "",
    assignedUserId: asString(raw.assignedUserId),
    notes: asString(raw.notes),
    dateAdded: asString(raw.dateAdded),
  };
}

export function normalizeCustomFieldDef(raw: RawCustomFieldDef): GhlCustomFieldDef {
  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    fieldKey: asString(raw.fieldKey) ?? "",
    dataType: asString(raw.dataType) ?? "text",
    position: asNumber(raw.position) ?? 0,
    placeholder: asString(raw.placeholder),
    options: asStringArray(raw.options),
    model: asString(raw.model) ?? "contact",
  };
}

export function normalizeTag(raw: RawTag, locationId?: string): GhlTag {
  return {
    id: asString(raw.id) ?? "",
    name: asString(raw.name) ?? "",
    locationId: asString(raw.locationId) ?? locationId ?? "",
  };
}

export function normalizePhoneNumber(raw: RawPhoneNumber): GhlPhoneNumber {
  return {
    id: asString(raw.id) ?? "",
    locationId: asString(raw.locationId) ?? "",
    phoneNumber: asString(raw.phoneNumber) ?? "",
    name: asString(raw.name),
    type: asString(raw.type),
    capabilities: asStringArray(raw.capabilities),
    isActive: asBoolean(raw.isActive, true),
  };
}

export async function resolveCustomFieldName(
  fieldId: string,
  locationId: string,
): Promise<string | null> {
  const cached = await getCachedReference<GhlCustomFieldDef[]>(locationId, "custom_fields");
  if (!cached) return null;

  const field = cached.find((f) => f.id === fieldId || f.fieldKey === fieldId);
  return field?.name ?? null;
}

export async function resolveTagName(tagId: string, locationId: string): Promise<string | null> {
  const cached = await getCachedReference<GhlTag[]>(locationId, "tags");
  if (!cached) return null;

  const tag = cached.find((t) => t.id === tagId);
  return tag?.name ?? null;
}

export async function resolveUserName(userId: string, locationId: string): Promise<string | null> {
  const cached = await getCachedReference<GhlUser[]>(locationId, "users");
  if (!cached) return null;

  const user = cached.find((u) => u.id === userId);
  return user?.name ?? user?.email ?? null;
}

export async function resolvePipelineName(
  pipelineId: string,
  locationId: string,
): Promise<string | null> {
  const cached = await getCachedReference<GhlPipeline[]>(locationId, "pipelines");
  if (!cached) return null;

  const pipeline = cached.find((p) => p.id === pipelineId);
  return pipeline?.name ?? null;
}

export async function resolveStageName(
  pipelineId: string,
  stageId: string,
  locationId: string,
): Promise<string | null> {
  const cached = await getCachedReference<GhlPipeline[]>(locationId, "pipelines");
  if (!cached) return null;

  const pipeline = cached.find((p) => p.id === pipelineId);
  if (!pipeline) return null;

  const stage = pipeline.stages.find((s) => s.id === stageId);
  return stage?.name ?? null;
}

export type AmbiguousContactMatch = {
  contact: GhlContact;
  confidence: "high" | "medium" | "low";
  matchedOn: string[];
};

export function rankContactMatches(
  contacts: GhlContact[],
  searchQuery: string,
): AmbiguousContactMatch[] {
  const query = searchQuery
    .toLowerCase()
    .trim()
    .replace(/['\u2019]s\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const queryParts = query.split(/\s+/).filter(Boolean);

  return contacts
    .map((contact) => {
      const matchedOn: string[] = [];
      let score = 0;

      const email = (contact.email ?? "").toLowerCase();
      const phone = (contact.phone ?? "").replace(/\D/g, "");
      const name = (contact.name ?? "").toLowerCase();
      const firstName = (contact.firstName ?? "").toLowerCase();
      const lastName = (contact.lastName ?? "").toLowerCase();

      if (email && email === query) {
        matchedOn.push("email_exact");
        score += 100;
      } else if (email && email.includes(query)) {
        matchedOn.push("email_partial");
        score += 50;
      }

      const queryDigits = query.replace(/\D/g, "");
      if (phone && queryDigits.length >= 7 && phone.includes(queryDigits)) {
        matchedOn.push("phone");
        score += 80;
      }

      if (name === query) {
        matchedOn.push("name_exact");
        score += 90;
      } else if (name.includes(query)) {
        matchedOn.push("name_partial");
        score += 40;
      }

      for (const part of queryParts) {
        if (firstName === part) {
          matchedOn.push("firstName_exact");
          score += 60;
        } else if (firstName.includes(part)) {
          matchedOn.push("firstName_partial");
          score += 20;
        }
        if (lastName === part) {
          matchedOn.push("lastName_exact");
          score += 60;
        } else if (lastName.includes(part)) {
          matchedOn.push("lastName_partial");
          score += 20;
        }
      }

      let confidence: "high" | "medium" | "low";
      if (score >= 80) {
        confidence = "high";
      } else if (score >= 40) {
        confidence = "medium";
      } else {
        confidence = "low";
      }

      return { contact, confidence, matchedOn, score };
    })
    .filter((m) => m.matchedOn.length > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ contact, confidence, matchedOn }) => ({ contact, confidence, matchedOn }));
}
