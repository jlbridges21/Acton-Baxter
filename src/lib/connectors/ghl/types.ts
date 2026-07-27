import { z } from "zod";

export type GhlAuthMode = "private_integration" | "oauth";

export type GhlConnectionStatus =
  | "disconnected"
  | "pending"
  | "connected"
  | "reauthorization_required"
  | "misconfigured"
  | "warning"
  | "offline"
  | "error";

export type GhlConnectorIdentity = {
  mode: GhlAuthMode;
  locationId: string;
  locationName: string | null;
  companyId: string | null;
  timezone: string | null;
};

export type GhlCredentialHealth = {
  ok: boolean;
  mode: GhlAuthMode;
  code: string | null;
  message: string;
  locationId: string | null;
};

export interface GhlCredentialProvider {
  mode: GhlAuthMode;
  getAccessToken(): Promise<string>;
  getIdentity(): Promise<GhlConnectorIdentity>;
  health(): Promise<GhlCredentialHealth>;
}

export type GhlContact = {
  id: string;
  locationId: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  source: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  dateAdded: string | null;
  dateUpdated: string | null;
  dnd: boolean;
  assignedTo: string | null;
};

export type GhlOpportunity = {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue: number | null;
  contactId: string;
  assignedTo: string | null;
  source: string | null;
  dateAdded: string | null;
  dateUpdated: string | null;
  customFields: Record<string, unknown>;
};

export type GhlPipelineStage = {
  id: string;
  name: string;
  position: number;
};

export type GhlPipeline = {
  id: string;
  name: string;
  locationId: string;
  stages: GhlPipelineStage[];
};

export type GhlConversation = {
  id: string;
  locationId: string;
  contactId: string;
  type: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessageType: string | null;
  dateAdded: string | null;
  dateUpdated: string | null;
};

export type GhlMessage = {
  id: string;
  conversationId: string;
  contactId: string;
  locationId: string;
  type: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: string | null;
  dateAdded: string | null;
  attachments: Array<{ url: string; contentType?: string }>;
};

export type GhlUser = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  role: string | null;
  permissions: Record<string, unknown>;
};

export type GhlCalendar = {
  id: string;
  locationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  groupId: string | null;
};

export type GhlCalendarEvent = {
  id: string;
  calendarId: string;
  locationId: string;
  contactId: string | null;
  title: string;
  appointmentStatus: string | null;
  startTime: string;
  endTime: string;
  assignedUserId: string | null;
  notes: string | null;
  dateAdded: string | null;
};

export type GhlCustomFieldDef = {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  position: number;
  placeholder: string | null;
  options: string[];
  model: string;
};

export type GhlTag = {
  id: string;
  name: string;
  locationId: string;
};

export type GhlPhoneNumber = {
  id: string;
  locationId: string;
  phoneNumber: string;
  name: string | null;
  type: string | null;
  capabilities: string[];
  isActive: boolean;
};

export type GhlDocument = {
  id: string;
  name: string;
  type: string;
  status: string;
  contactId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GhlVoiceAgent = {
  id: string;
  name: string;
  status: string;
  phoneNumber: string | null;
  createdAt: string | null;
};

export type GhlKnowledgeBaseAsset = {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string | null;
};

export type GhlEvidenceSourceType = "gohighlevel";

export type GhlEvidenceSource = {
  type: GhlEvidenceSourceType;
  resourceType: string;
  resourceId: string;
  resourceName: string | null;
  url: string | null;
  retrievedAt: string;
  summary: string | null;
};

export const ghlLocationResponseSchema = z.object({
  location: z
    .object({
      id: z.string(),
      name: z.string().optional(),
      companyId: z.string().optional(),
      timezone: z.string().optional(),
    })
    .passthrough(),
});

export const ghlContactSchema = z
  .object({
    id: z.string(),
    locationId: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    address1: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    customField: z.record(z.string(), z.unknown()).optional(),
    customFields: z
      .array(
        z.object({
          id: z.string().optional(),
          key: z.string().optional(),
          field_value: z.unknown().optional(),
          value: z.unknown().optional(),
        }),
      )
      .optional(),
    dateAdded: z.string().nullable().optional(),
    dateUpdated: z.string().nullable().optional(),
    dnd: z.boolean().optional(),
    assignedTo: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlContactsSearchResponseSchema = z
  .object({
    contacts: z.array(ghlContactSchema),
    meta: z
      .object({
        total: z.number().optional(),
        currentPage: z.number().optional(),
        nextPage: z.number().nullable().optional(),
        prevPage: z.number().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ghlOpportunitySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    pipelineId: z.string().optional(),
    pipelineStageId: z.string().optional(),
    status: z.string().optional(),
    monetaryValue: z.number().nullable().optional(),
    contact: z.object({ id: z.string() }).optional(),
    contactId: z.string().optional(),
    assignedTo: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    dateAdded: z.string().nullable().optional(),
    dateUpdated: z.string().nullable().optional(),
    customFields: z
      .array(
        z.object({
          id: z.string().optional(),
          key: z.string().optional(),
          field_value: z.unknown().optional(),
          value: z.unknown().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const ghlOpportunitiesSearchResponseSchema = z
  .object({
    opportunities: z.array(ghlOpportunitySchema),
    meta: z
      .object({
        total: z.number().optional(),
        currentPage: z.number().optional(),
        nextPage: z.number().nullable().optional(),
        nextPageUrl: z.string().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ghlPipelineStageSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    position: z.number().optional(),
  })
  .passthrough();

export const ghlPipelineSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    locationId: z.string().optional(),
    stages: z.array(ghlPipelineStageSchema).optional(),
  })
  .passthrough();

export const ghlPipelinesResponseSchema = z
  .object({
    pipelines: z.array(ghlPipelineSchema),
  })
  .passthrough();

export const ghlConversationSchema = z
  .object({
    id: z.string(),
    locationId: z.string().optional(),
    contactId: z.string().optional(),
    type: z.string().optional(),
    unreadCount: z.number().optional(),
    lastMessageDate: z.string().nullable().optional(),
    lastMessageBody: z.string().nullable().optional(),
    lastMessageType: z.string().nullable().optional(),
    dateAdded: z.string().nullable().optional(),
    dateUpdated: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlConversationsSearchResponseSchema = z
  .object({
    conversations: z.array(ghlConversationSchema),
    total: z.number().optional(),
  })
  .passthrough();

export const ghlMessageSchema = z
  .object({
    id: z.string(),
    conversationId: z.string().optional(),
    contactId: z.string().optional(),
    locationId: z.string().optional(),
    type: z.string().optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    body: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    dateAdded: z.string().nullable().optional(),
    attachments: z
      .array(
        z.object({
          url: z.string(),
          contentType: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const ghlMessagesResponseSchema = z
  .object({
    messages: z.array(ghlMessageSchema),
    nextPage: z.boolean().optional(),
    lastMessageId: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlUserSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string(),
    phone: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const ghlUsersResponseSchema = z
  .object({
    users: z.array(ghlUserSchema),
  })
  .passthrough();

export const ghlCalendarSchema = z
  .object({
    id: z.string(),
    locationId: z.string().optional(),
    name: z.string(),
    description: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    groupId: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlCalendarsResponseSchema = z
  .object({
    calendars: z.array(ghlCalendarSchema),
  })
  .passthrough();

export const ghlCalendarEventSchema = z
  .object({
    id: z.string(),
    calendarId: z.string().optional(),
    locationId: z.string().optional(),
    contactId: z.string().nullable().optional(),
    title: z.string().optional(),
    appointmentStatus: z.string().nullable().optional(),
    startTime: z.string(),
    endTime: z.string(),
    assignedUserId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    dateAdded: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlCalendarEventsResponseSchema = z
  .object({
    events: z.array(ghlCalendarEventSchema),
  })
  .passthrough();

export const ghlCustomFieldDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    fieldKey: z.string().optional(),
    dataType: z.string().optional(),
    position: z.number().optional(),
    placeholder: z.string().nullable().optional(),
    options: z.array(z.string()).optional(),
    model: z.string().optional(),
  })
  .passthrough();

export const ghlCustomFieldsResponseSchema = z
  .object({
    customFields: z.array(ghlCustomFieldDefSchema),
  })
  .passthrough();

export const ghlTagSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    locationId: z.string().optional(),
  })
  .passthrough();

export const ghlTagsResponseSchema = z
  .object({
    tags: z.array(ghlTagSchema),
  })
  .passthrough();

export const ghlPhoneNumberSchema = z
  .object({
    id: z.string(),
    locationId: z.string().optional(),
    phoneNumber: z.string(),
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    capabilities: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

export const ghlPhoneNumbersResponseSchema = z
  .object({
    numbers: z.array(ghlPhoneNumberSchema).optional(),
    phoneNumbers: z.array(ghlPhoneNumberSchema).optional(),
  })
  .passthrough();

export const ghlBusinessSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    locationId: z.string().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  })
  .passthrough();

export const ghlBusinessesResponseSchema = z
  .object({
    businesses: z.array(ghlBusinessSchema),
  })
  .passthrough();

export const GHL_API_VERSION = "2021-07-28";
export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
export const GHL_OAUTH_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
export const GHL_OAUTH_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
