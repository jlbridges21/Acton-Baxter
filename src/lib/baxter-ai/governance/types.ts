export type CanonicalSourceRole =
  "runtime" | "governance" | "culture" | "brand" | "value_proposition";

export type CanonicalSource = {
  id: CanonicalSourceRole;
  title: string;
  path: string;
  version: string;
  purpose: string;
  /** Compact rules load into every reasoning request. */
  runtimeRole: "always" | "conditional" | "admin_only" | "never";
  /** Full doc may be indexed for employee retrieval. */
  indexable: boolean;
  citable: boolean;
  /** May contain PLACEHOLDER / RED FLAG planning notes. */
  mayContainUnresolved: boolean;
};

export type BaxterRuntimeAssembly = {
  runtimeVersion: string;
  governanceVersion: string;
  systemPrompt: string;
  loadedStandards: string[];
  capabilitiesSummary: string[];
};
