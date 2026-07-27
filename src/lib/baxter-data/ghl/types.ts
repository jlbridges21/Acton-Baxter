import type {
  GhlContact,
  GhlOpportunity,
  GhlPipeline,
  GhlCalendarEvent,
  GhlConversation,
  GhlMessage,
  GhlUser,
  GhlEvidenceSource,
} from "@/lib/connectors/ghl/types";

export type {
  GhlContact,
  GhlOpportunity,
  GhlPipeline,
  GhlCalendarEvent,
  GhlConversation,
  GhlMessage,
  GhlUser,
  GhlEvidenceSource,
};

export type BaxterGhlContactContext = {
  contact: GhlContact;
  opportunities: GhlOpportunity[];
  recentMessages: GhlMessage[];
  upcomingEvents: GhlCalendarEvent[];
  assignedUser: GhlUser | null;
  evidenceSources: GhlEvidenceSource[];
};

export type BaxterGhlOpportunityContext = {
  opportunity: GhlOpportunity;
  contact: GhlContact | null;
  pipeline: GhlPipeline | null;
  stageName: string | null;
  assignedUser: GhlUser | null;
  evidenceSources: GhlEvidenceSource[];
};

export type BaxterGhlPipelineContext = {
  pipeline: GhlPipeline;
  opportunityCounts: Record<string, number>;
  totalValue: number;
  evidenceSources: GhlEvidenceSource[];
};

export type BaxterGhlCalendarContext = {
  upcomingEvents: GhlCalendarEvent[];
  todayEvents: GhlCalendarEvent[];
  evidenceSources: GhlEvidenceSource[];
};

export type BaxterGhlConversationContext = {
  conversations: GhlConversation[];
  recentMessages: GhlMessage[];
  contact: GhlContact | null;
  evidenceSources: GhlEvidenceSource[];
};

export type BaxterGhlUserContext = {
  users: GhlUser[];
  evidenceSources: GhlEvidenceSource[];
};
