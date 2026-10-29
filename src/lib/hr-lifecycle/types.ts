/**
 * HR lifecycle types shared by the server and the browser. A lifecycle item is one checkbox from
 * the leadership "Staff Lifecycle Checklist", kept with its exact wording and every attribute
 * needed to trace it back to the document (part, section, position, tags, citations).
 */

import type { AssigneeRole, StepType } from "@/lib/ops/definition";

export const LIFECYCLE_PHASES = ["preboarding", "onboarding", "offboarding"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const PHASE_LABELS: Record<LifecyclePhase, string> = {
  preboarding: "Pre-boarding",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
};

/** Work roles that switch on role-specific items. "general" items apply to everyone. */
export const ROLE_KEYS = ["design", "sales", "marketing", "field"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const ROLE_KEY_LABELS: Record<RoleKey, string> = {
  design: "Design",
  sales: "Sales",
  marketing: "Marketing",
  field: "Field / production",
};

export type LegalTag = "CA" | "Fed";
export type Jurisdiction = "California" | "Federal" | "California + Federal" | "Company practice";

/** Dates a timing rule can be anchored to. */
export type TimingAnchor = "offer_date" | "start_date" | "notice_date" | "last_day";

export type Timing =
  | { kind: "days"; anchor: TimingAnchor; offset: number }
  | { kind: "business_days"; anchor: TimingAnchor; offset: number }
  | { kind: "months"; anchor: TimingAnchor; offset: number }
  /** California final-pay rule (Labor Code 201/202): depends on how the employment ends. */
  | { kind: "final_pay" }
  | { kind: "none" };

/** Facts a condition can test. Unknown facts never silently exclude an item. */
export type Condition =
  | { fact: "role"; anyOf: RoleKey[] }
  | { fact: "exempt"; equals: boolean }
  | { fact: "supervisor"; equals: boolean }
  | { fact: "headcount"; gte?: number; lte?: number }
  | { fact: "on_group_health"; equals: boolean }
  | { fact: "separation"; anyOf: SeparationType[] };

export const SEPARATION_TYPES = [
  "resignation_with_notice",
  "resignation_without_notice",
  "involuntary",
  "layoff",
] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];
export const SEPARATION_LABELS: Record<SeparationType, string> = {
  resignation_with_notice: "Resignation with 72+ hours' notice (planned)",
  resignation_without_notice: "Resignation with less than 72 hours' notice",
  involuntary: "Involuntary termination (immediate)",
  layoff: "Layoff (immediate)",
};

/** Platforms in the access register (from the checklist). Prices are never assumed. */
export const PLATFORM_KEYS = [
  "google_workspace",
  "slack",
  "jobtread",
  "autodesk_revit",
  "bluebeam_revu",
  "gohighlevel",
  "webflow",
  "meta_business_suite",
  "x_twitter",
  "youtube",
  "linkedin_page",
  "google_business_profile",
  "google_ads",
  "google_analytics",
  "baxter",
  "bamboohr",
  "payroll_benefits",
  "shared_credentials",
] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export type Citation = {
  /** e.g. "Labor Code 2810.5" — exactly as the document cites it. */
  reference: string;
  /** Official source family a reviewer must check it against. */
  authority: "DIR" | "EDD" | "CRD" | "Cal/OSHA" | "DHCS" | "Federal" | "Legislature";
};

export type SourceRef = {
  documentKey: string;
  documentVersion: string;
  part: string;
  section: string;
  /** 1-based position among the section's checkboxes. */
  ordinal: number;
};

export type LifecycleSubItem = {
  id: string;
  /** Verbatim bullet text. */
  text: string;
  conditions: Condition[];
  /** Plain-language reason shown when the condition removes it. */
  conditionNote?: string;
};

export type LifecycleItem = {
  /** Stable id; also the workflow step key. */
  id: string;
  phase: LifecyclePhase;
  /** "document" = a checkbox in the leadership checklist; "system" = a safety step Baxter adds. */
  origin: "document" | "system";
  sourceRef: SourceRef;
  /** Verbatim checkbox text (tags included), exactly as written in the document. */
  text: string;
  /** Short title for lists (the full wording is always kept in `text`). */
  title: string;
  subItems: LifecycleSubItem[];
  tags: LegalTag[];
  jurisdiction: Jurisdiction;
  /** "general" = all staff. Otherwise the item applies only to these confirmed roles. */
  roles: "general" | RoleKey[];
  conditions: Condition[];
  trigger: string;
  timing: Timing;
  /** The document's own timing words, when it gives any. */
  timingText: string;
  owner: AssigneeRole | "tech_ops_manager";
  stepType: StepType;
  documents: string[];
  platforms: PlatformKey[];
  approvals: string[];
  citations: Citation[];
  dependsOn: string[];
  /** Grants admin or owner-level rights: needs a named leadership approval, never a job title. */
  privilegedAccess: boolean;
  /** Communication template key (drafts only — nothing is ever sent automatically). */
  communication: string | null;
  /** Caveats, ambiguities, or open questions about this item. */
  flags: string[];
};

export type ComplianceSource = {
  name: string;
  covers: string;
  linkText: string;
  url: string;
  official: boolean;
};

export type RecurringItem = {
  id: string;
  /** Verbatim table cells. */
  item: string;
  when: string;
  requirement: string;
  tags: LegalTag[];
  cadence:
    | { kind: "annual"; month: number; day: number }
    | { kind: "per_employee_years"; years: number }
    | { kind: "twice_yearly" }
    | { kind: "quarterly" };
  citations: Citation[];
  defaultOwner: AssigneeRole | "tech_ops_manager";
  flags: string[];
};

export type ChecklistCatalog = {
  documentKey: string;
  documentVersion: string;
  title: string;
  dateLine: string;
  howToUse: string[];
  sourcesIntro: string;
  sources: ComplianceSource[];
  sourcesNote: string;
  phaseGoals: Record<LifecyclePhase, string>;
  items: LifecycleItem[];
  recurringIntro: string;
  recurring: RecurringItem[];
  flags: string[];
};

/** The employee facts a plan is built from. Null means "not known yet". */
export type LifecycleProfile = {
  roles: RoleKey[];
  /** HR confirmed the roles (a job title alone never switches on role tasks). */
  rolesConfirmed: boolean;
  exempt: boolean | null;
  supervisor: boolean | null;
  headcount: number | null;
  onGroupHealth: boolean | null;
  separation: SeparationType | null;
};

export type LifecycleDates = Partial<Record<TimingAnchor, string>>;

/** Display statuses (spec): computed from the engine's persisted step status + due date. */
export const DISPLAY_STATUSES = [
  "completed",
  "awaiting_action",
  "awaiting_approval",
  "overdue",
  "external_verification",
  "not_applicable",
  "blocked",
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];
export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  completed: "Completed",
  awaiting_action: "Awaiting action",
  awaiting_approval: "Awaiting approval",
  overdue: "Overdue",
  external_verification: "External verification",
  not_applicable: "N/A",
  blocked: "Blocked",
};
