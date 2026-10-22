import type { AccessLevel, AccessPolicyRow, AgentConfig, AuditRow } from "@/lib/agents/types";
import type { ModelCatalogEntry, ProviderStatus } from "@/lib/agents/models";
import type { AgentCard } from "@/lib/agents/views";

export type StudioVersion = {
  id: string;
  version_number: number;
  status: "draft" | "published" | "superseded";
  change_summary: string | null;
  created_at: string;
  published_at: string | null;
};

export type StudioToolInfo = {
  key: string;
  label: string;
  description: string;
  risk: "read" | "draft" | "write" | "external";
  alwaysRequiresApproval: boolean;
  available: boolean;
  unavailableReason: string | null;
};

export type StudioData = {
  agent: AgentCard;
  access: AccessLevel[];
  isAdmin: boolean;
  config: {
    published: (StudioVersion & { parsed: AgentConfig }) | null;
    draft: (StudioVersion & { parsed: AgentConfig }) | null;
    draftProblems: string[];
    history: StudioVersion[];
  } | null;
  protectedRules: string | null;
  tools: StudioToolInfo[];
  models: ModelCatalogEntry[];
  providers: ProviderStatus[];
  policies: AccessPolicyRow[] | null;
  audit: AuditRow[];
};

export type ConfigEditor = {
  config: AgentConfig;
  update: (fn: (draft: AgentConfig) => void) => void;
  readOnly: boolean;
};
