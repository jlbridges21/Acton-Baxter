/**
 * The leadership "Acton ADU Staff Lifecycle Checklist" (Oct 28, 2026) as structured data.
 *
 * Every checkbox in the document is one item, with its exact wording in `text`. Everything else
 * (owner, timing, conditions, citations, step type) is the mapping chosen to run it as a
 * workflow; docs/hr-lifecycle/mapping.md lists the mapping and the reasoning per item.
 *
 * Timing offsets for untagged items are editable company defaults. Every legal deadline stays
 * "unverified" in the verification register until a named reviewer checks it against official
 * sources. Nothing here is legal advice.
 */

import type {
  ChecklistCatalog,
  Citation,
  Condition,
  Jurisdiction,
  LegalTag,
  LifecycleItem,
  LifecyclePhase,
  LifecycleSubItem,
  RecurringItem,
} from "./types";

export const CHECKLIST_KEY = "acton-staff-lifecycle";
export const CHECKLIST_VERSION = "2026-10-28";
export const CHECKLIST_TITLE = "Acton ADU Staff Lifecycle Checklist";

export const PART_1 = "Part 1: Pre-boarding (offer accepted to Day 1)";
export const PART_2 = "Part 2: Onboarding (Day 1 to 90)";
export const PART_3 = "Part 3: Offboarding (notice to close)";

const PHASE_PART: Record<LifecyclePhase, string> = {
  preboarding: PART_1,
  onboarding: PART_2,
  offboarding: PART_3,
};

/** [CA] / [Fed] markers anywhere in the wording. */
export function tagsIn(text: string): LegalTag[] {
  const tags = new Set<LegalTag>();
  for (const m of text.matchAll(/\[(CA|Fed)\]/g)) tags.add(m[1] as LegalTag);
  return (["CA", "Fed"] as const).filter((t) => tags.has(t));
}

export function jurisdictionOf(tags: LegalTag[]): Jurisdiction {
  if (tags.includes("CA") && tags.includes("Fed")) return "California + Federal";
  if (tags.includes("CA")) return "California";
  if (tags.includes("Fed")) return "Federal";
  return "Company practice";
}

type Opts = Partial<
  Omit<LifecycleItem, "id" | "phase" | "sourceRef" | "text" | "tags" | "jurisdiction">
> & { title: string };

const counters = new Map<string, number>();
function item(phase: LifecyclePhase, section: string, id: string, text: string, o: Opts) {
  const k = `${phase}|${section}`;
  const ordinal = (counters.get(k) ?? 0) + 1;
  counters.set(k, ordinal);
  const tags = tagsIn(text);
  const access = o.stepType === "access_request";
  const finance = o.stepType === "finance_handoff";
  const out: LifecycleItem = {
    id,
    phase,
    origin: "document",
    sourceRef: {
      documentKey: CHECKLIST_KEY,
      documentVersion: CHECKLIST_VERSION,
      part: PHASE_PART[phase],
      section,
      ordinal,
    },
    text,
    title: o.title,
    subItems: o.subItems ?? [],
    tags,
    jurisdiction: jurisdictionOf(tags),
    roles: o.roles ?? "general",
    conditions: o.conditions ?? [],
    trigger: o.trigger ?? "",
    timing: o.timing ?? { kind: "none" },
    timingText: o.timingText ?? "",
    owner: o.owner ?? (access ? "coo" : finance ? "finance_owner" : "hr_admin"),
    stepType: o.stepType ?? "manual_task",
    documents: o.documents ?? [],
    platforms: o.platforms ?? [],
    approvals: o.approvals ?? [],
    citations: o.citations ?? [],
    dependsOn: o.dependsOn ?? [],
    privilegedAccess: o.privilegedAccess ?? false,
    communication: o.communication ?? null,
    flags: o.flags ?? [],
  };
  return out;
}

const sub = (
  id: string,
  text: string,
  conditions: Condition[] = [],
  conditionNote?: string,
): LifecycleSubItem => ({ id, text, conditions, ...(conditionNote ? { conditionNote } : {}) });

const c = (reference: string, authority: Citation["authority"]): Citation => ({
  reference,
  authority,
});

const START = (offset: number) => ({
  kind: "days" as const,
  anchor: "start_date" as const,
  offset,
});
const OFFER = (offset: number) => ({
  kind: "days" as const,
  anchor: "offer_date" as const,
  offset,
});
const NOTICE = (offset: number) => ({
  kind: "days" as const,
  anchor: "notice_date" as const,
  offset,
});
const LAST = (offset: number) => ({ kind: "days" as const, anchor: "last_day" as const, offset });

const T_PRE = "Offer accepted";
const T_ON = "Employee's first day";
const T_OFF = "Notice received";

const ACCESS_APPROVAL = "COO provisions or removes access and records it (Sam never grants access)";
const LOG_GRANT = "Log the grant in the access register (platform, role, date, approver)";
const PRIVILEGED =
  "Admin or owner-level rights need a named CEO/COO approval in the access register — never inferred from a job title";

// ---------------------------------------------------------------------------
// Part 1: Pre-boarding
// ---------------------------------------------------------------------------
const PRE_LEGAL = "Legal and HR";
const PRE_ALL = "Accounts, all staff";
const PRE_DES = "Accounts, designers";
const PRE_SALES = "Accounts, sales";
const PRE_MKT = "Accounts, marketing";
const PRE_GATE = "Licensed software gate (all roles)";
const PRE_OPS = "Operational";

const preboarding: LifecycleItem[] = [
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-offer-letter",
    "☐ Offer letter: at-will status, pay rate, exempt or non-exempt, start date. E-sign in BambooHR.",
    {
      title: "Offer letter e-signed in BambooHR",
      trigger: "Hiring approved",
      timing: OFFER(0),
      timingText: "Before the offer goes out (pre-boarding starts at offer acceptance)",
      documents: ["Offer letter (at-will, pay rate, exempt status, start date)"],
      platforms: ["bamboohr"],
      approvals: ["Offer terms approved by leadership before sending"],
      dependsOn: ["pre-licensed-gate"],
      flags: ["Sam never sets pay or exempt status; HR records what leadership approved."],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-background-check",
    "☐ [CA] Background check only after a conditional offer. Fair Chance Act individualized assessment if a conviction surfaces (Gov Code 12952).",
    {
      title: "Background check after conditional offer (Fair Chance Act)",
      trigger: "Conditional offer made",
      timing: START(-3),
      timingText: "Only after a conditional offer",
      citations: [c("Gov Code 12952", "CRD")],
      dependsOn: ["pre-offer-letter"],
      flags: [
        "If a conviction surfaces, the individualized assessment is a human legal decision — Sam only tracks that it happened.",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-wtpa-notice",
    "☐ [CA] Prepare the Wage Theft Prevention Act notice for non-exempt hires (Labor Code 2810.5). Employer completes it and gives it at hire.",
    {
      title: "Prepare Wage Theft Prevention Act notice (non-exempt)",
      trigger: T_PRE,
      conditions: [{ fact: "exempt", equals: false }],
      timing: START(0),
      timingText: "Given at hire",
      documents: ["Labor Code 2810.5 notice"],
      citations: [c("Labor Code 2810.5", "DIR")],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-w4-de4",
    "☐ [Fed] [CA] Prepare W-4 and DE 4 (2026 version).",
    {
      title: "Prepare W-4 and DE 4 (2026)",
      trigger: T_PRE,
      timing: START(-1),
      timingText: "Before Day 1",
      documents: ["Form W-4 (2026)", "Form DE 4 (2026)"],
      citations: [c("IRS Form W-4", "Federal"), c("EDD Form DE 4", "EDD")],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-i9-section1",
    "☐ [Fed] I-9 Section 1 completed by the employee on or before Day 1.",
    {
      title: "I-9 Section 1 completed by the employee",
      trigger: T_PRE,
      timing: START(0),
      timingText: "On or before Day 1",
      documents: ["Form I-9 Section 1"],
      citations: [c("Form I-9 (USCIS)", "Federal")],
      flags: [
        "Identity documents are never uploaded to Baxter; record where the I-9 is kept as evidence.",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-pamphlet-packet",
    "☐ [CA] Assemble the 2026 pamphlet packet (full list in Part 2, Day 1). Download current PDFs from DIR, EDD, and CRD. Delivery by email with e-acknowledgment in BambooHR is permitted.",
    {
      title: "Assemble the 2026 pamphlet packet",
      trigger: T_PRE,
      timing: START(-1),
      timingText: "Before Day 1",
      documents: ["2026 pamphlet packet (see Day 1 legal list)"],
      platforms: ["bamboohr"],
      citations: [
        c("DIR Required Posters and Notices", "DIR"),
        c("EDD Required Notices and Pamphlets", "EDD"),
        c("CRD publications", "CRD"),
      ],
      flags: ["Never reuse a 2025 packet (document flag)."],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-posters",
    "☐ [CA] Confirm current labor law posters at the office and every active jobsite.",
    {
      title: "Confirm labor law posters (office and jobsites)",
      trigger: T_PRE,
      timing: START(-1),
      timingText: "Before Day 1",
      citations: [c("DIR Required Posters and Notices", "DIR")],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-payroll-setup",
    "☐ Payroll setup, pay schedule, direct deposit authorization (written consent required).",
    {
      title: "Payroll setup and direct deposit consent",
      trigger: T_PRE,
      stepType: "finance_handoff",
      timing: START(-3),
      timingText: "Before Day 1",
      documents: ["Direct deposit authorization (written consent)"],
      platforms: ["payroll_benefits"],
      flags: ["Sam never changes payroll; the head of finance completes and records it."],
    },
  ),
  item(
    "preboarding",
    PRE_LEGAL,
    "pre-expense-method",
    "☐ [CA] Expense reimbursement method set for mileage and phone (Labor Code 2802).",
    {
      title: "Expense reimbursement method (mileage, phone)",
      trigger: T_PRE,
      stepType: "finance_handoff",
      timing: START(-1),
      timingText: "Before Day 1",
      citations: [c("Labor Code 2802", "DIR")],
    },
  ),
  item(
    "preboarding",
    PRE_ALL,
    "pre-google-workspace",
    "☐ Google Workspace: Gmail account, Google Groups, shared Drives matched to role.",
    {
      title: "Google Workspace account, groups, and Drives",
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_ALL,
    "pre-slack",
    "☐ Slack: invite, 2FA enabled, added to #general. Add to the department channel for their role: #sales, #design, #production, #pm, or #marketing. The hiring manager then decides which project channels and special project channels they join and adds them directly.",
    {
      title: "Slack invite, 2FA, #general and department channel",
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["slack"],
      approvals: [
        ACCESS_APPROVAL,
        LOG_GRANT,
        "Hiring manager chooses project channels and adds them directly",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_ALL,
    "pre-jobtread",
    "☐ JobTread: user created, role and permissions set, added to active jobs. Confirm a seat is free.",
    {
      title: "JobTread user, role, and jobs (seat check)",
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["jobtread"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item("preboarding", PRE_ALL, "pre-verify-logins", "☐ Verify all four logins work before Day 1.", {
    title: "Verify all logins work",
    trigger: T_PRE,
    stepType: "access_request",
    timing: START(-1),
    timingText: "Before Day 1",
    platforms: ["google_workspace", "slack", "jobtread"],
    dependsOn: ["pre-google-workspace", "pre-slack", "pre-jobtread"],
    approvals: [ACCESS_APPROVAL],
    flags: [
      'The document says "all four logins" but this section lists three platforms (Google Workspace, Slack, JobTread). Confirm the fourth (for example Gmail separately, BambooHR, or Baxter).',
    ],
  }),
  item(
    "preboarding",
    PRE_DES,
    "pre-revit",
    "☐ Autodesk Revit named-user seat assigned in the Autodesk admin console.",
    {
      title: "Assign Autodesk Revit seat",
      roles: ["design"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["autodesk_revit"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_DES,
    "pre-bluebeam",
    "☐ Bluebeam Revu named-user license assigned in Bluebeam Cloud admin.",
    {
      title: "Assign Bluebeam Revu license",
      roles: ["design"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["bluebeam_revu"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_DES,
    "pre-design-drives",
    "☐ Added to design shared Drive, Revit template library, and project model folders.",
    {
      title: "Design shared Drive, templates, model folders",
      roles: ["design"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_DES,
    "pre-revit-laptop",
    "☐ Laptop meets Revit spec (dedicated GPU, 32GB RAM recommended).",
    {
      title: "Laptop meets Revit spec",
      roles: ["design"],
      trigger: T_PRE,
      timing: START(-3),
      timingText: "Before Day 1",
    },
  ),
  item(
    "preboarding",
    PRE_SALES,
    "pre-ghl-sales",
    "☐ GoHighLevel: user created, assigned to sales pipeline, lead assignment and round-robin set, calendar sync on, calling and texting permissions confirmed, A2P 10DLC registration complete before texting leads.",
    {
      title: "GoHighLevel sales user, pipeline, round-robin, A2P 10DLC",
      roles: ["sales"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1; A2P 10DLC before texting leads",
      platforms: ["gohighlevel"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_SALES,
    "pre-sales-drive",
    "☐ Added to sales shared Drive and proposal templates.",
    {
      title: "Sales shared Drive and proposal templates",
      roles: ["sales"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-ghl-marketing",
    "☐ GoHighLevel: marketing permissions (campaigns, automations, forms, funnels). Admin rights limited to one or two people.",
    {
      title: "GoHighLevel marketing permissions",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["gohighlevel"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-webflow",
    "☐ Webflow: workspace member with correct role (Designer, Content Editor, or Site Manager). Confirm a seat is free.",
    {
      title: "Webflow workspace member (seat check)",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["webflow"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-meta",
    "☐ Meta Business Suite: add as a person in Business Settings; assign Facebook Page, Instagram, ad account, and Pixel or datasets. Review agency partner permissions.",
    {
      title: "Meta Business Suite person and assets",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["meta_business_suite"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
      flags: [
        "Highest-risk area: confirm the company account is Primary Owner before granting (document flag).",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-x",
    "☐ X (Twitter): Delegate access, never the master password.",
    {
      title: "X (Twitter) delegate access",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["x_twitter"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-youtube",
    "☐ YouTube: Channel Manager or Editor via the brand account using their company Google address.",
    {
      title: "YouTube Channel Manager or Editor",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["youtube"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-linkedin",
    "☐ LinkedIn Company Page: admin role matched to need.",
    {
      title: "LinkedIn Company Page admin role",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["linkedin_page"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-gbp",
    "☐ Google Business Profile: Manager role. Primary Owner stays on a company-controlled account.",
    {
      title: "Google Business Profile Manager role",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_business_profile"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-google-ads",
    "☐ Google Ads: Standard or Admin user. Link through the agency MCC if one exists rather than duplicating.",
    {
      title: "Google Ads Standard or Admin user",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_ads"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT, PRIVILEGED],
      privilegedAccess: true,
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-ga4",
    "☐ Google Analytics (GA4): Editor or Analyst at property level.",
    {
      title: "GA4 Editor or Analyst",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_analytics"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-brand-assets",
    "☐ Brand assets Drive, podcast assets, and scheduling tool if used.",
    {
      title: "Brand assets, podcast assets, scheduling tool",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-2),
      timingText: "Before Day 1",
      platforms: ["google_workspace", "shared_credentials"],
      approvals: [ACCESS_APPROVAL, LOG_GRANT],
    },
  ),
  item(
    "preboarding",
    PRE_MKT,
    "pre-access-register",
    "☐ Log every grant in the access register (platform, role, date, approver).",
    {
      title: "Log every grant in the access register",
      roles: ["marketing"],
      trigger: T_PRE,
      stepType: "access_request",
      timing: START(-1),
      timingText: "Before Day 1",
      dependsOn: [
        "pre-ghl-marketing",
        "pre-webflow",
        "pre-meta",
        "pre-x",
        "pre-youtube",
        "pre-linkedin",
        "pre-gbp",
        "pre-google-ads",
        "pre-ga4",
        "pre-brand-assets",
      ],
      approvals: [ACCESS_APPROVAL],
      flags: [
        "Listed under marketing in the document; the access register records grants for every role.",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_GATE,
    "pre-licensed-gate",
    "☐ Before the offer goes out, confirm seat availability for JobTread, Webflow, Autodesk Revit, and Bluebeam Revu. Record seat cost on the hiring approval so finance signs off on fully loaded cost.",
    {
      title: "Licensed software gate: seats and seat cost",
      trigger: "Before the offer goes out",
      stepType: "finance_handoff",
      timing: OFFER(-1),
      timingText: "Before the offer goes out",
      platforms: ["jobtread", "webflow", "autodesk_revit", "bluebeam_revu"],
      approvals: [
        "Finance signs off on fully loaded cost (seat costs recorded on the hiring approval)",
      ],
      flags: [
        "Seat prices are never assumed: record the actual cost from the vendor invoice or admin console in the access register.",
      ],
    },
  ),
  item(
    "preboarding",
    PRE_OPS,
    "pre-equipment",
    "☐ Equipment ordered: laptop, phone. Field roles add PPE, tools, vehicle or mileage setup.",
    {
      title: "Order equipment (field roles: PPE, tools, vehicle/mileage)",
      trigger: T_PRE,
      owner: "hiring_manager",
      timing: START(-7),
      timingText: "Before Day 1",
    },
  ),
  item("preboarding", PRE_OPS, "pre-buddy", "☐ Buddy or mentor assigned.", {
    title: "Assign buddy or mentor",
    trigger: T_PRE,
    owner: "hiring_manager",
    timing: START(-5),
    timingText: "Before Day 1",
  }),
  item(
    "preboarding",
    PRE_OPS,
    "pre-306090-plan",
    "☐ 30/60/90 day plan drafted with the hiring manager.",
    {
      title: "Draft 30/60/90 day plan",
      trigger: T_PRE,
      owner: "hiring_manager",
      timing: START(-3),
      timingText: "Before Day 1",
    },
  ),
  item(
    "preboarding",
    PRE_OPS,
    "pre-welcome-email",
    "☐ Welcome email: Day 1 time, location, parking, dress code, schedule.",
    {
      title: "Welcome email (draft for review)",
      trigger: T_PRE,
      timing: START(-3),
      timingText: "Before Day 1",
      communication: "welcome_email",
    },
  ),
  item(
    "preboarding",
    PRE_OPS,
    "pre-calendar-announcement",
    "☐ Calendar invites, org chart, internal announcement.",
    {
      title: "Calendar invites, org chart, announcement",
      trigger: T_PRE,
      timing: START(-2),
      timingText: "Before Day 1",
      communication: "internal_announcement",
    },
  ),
  item("preboarding", PRE_OPS, "pre-workspace-ready", "☐ Workspace or jobsite assignment ready.", {
    title: "Workspace or jobsite assignment ready",
    trigger: T_PRE,
    owner: "hiring_manager",
    timing: START(-1),
    timingText: "Before Day 1",
  }),
];

// ---------------------------------------------------------------------------
// Part 2: Onboarding
// ---------------------------------------------------------------------------
const ON_D1_LEGAL = "Day 1, legal";
const ON_D1_OPS = "Day 1, operational";
const ON_D23 = "Day 2 to 3";
const ON_W1 = "Week 1";
const ON_20 = "Within 20 days";
const ON_D30 = "Day 30";
const ON_6M = "Within 6 months";
const ON_D60 = "Day 60";
const ON_D90 = "Day 90";

const onboarding: LifecycleItem[] = [
  item(
    "onboarding",
    ON_D1_LEGAL,
    "on-i9-section2",
    "☐ [Fed] I-9 Section 2 completed within 3 business days; identity documents verified.",
    {
      title: "I-9 Section 2 and identity verification",
      trigger: T_ON,
      timing: { kind: "business_days", anchor: "start_date", offset: 3 },
      timingText: "Within 3 business days",
      documents: ["Form I-9 Section 2"],
      citations: [c("Form I-9 (USCIS)", "Federal")],
      flags: [
        "Business days here skip weekends only; federal holidays are not removed. Confirm with counsel or the payroll provider (document flag).",
        "Identity documents are never uploaded to Baxter.",
      ],
    },
  ),
  item("onboarding", ON_D1_LEGAL, "on-w4-de4", "☐ [Fed] [CA] Collect signed W-4 and DE 4.", {
    title: "Collect signed W-4 and DE 4",
    trigger: T_ON,
    timing: START(0),
    timingText: "Day 1",
    documents: ["Signed W-4", "Signed DE 4"],
    citations: [c("IRS Form W-4", "Federal"), c("EDD Form DE 4", "EDD")],
  }),
  item(
    "onboarding",
    ON_D1_LEGAL,
    "on-pamphlets",
    "☐ [CA] Deliver the following with signed acknowledgment in BambooHR:",
    {
      title: "Deliver required notices with signed acknowledgment",
      trigger: T_ON,
      stepType: "checklist",
      timing: START(0),
      timingText: "Day 1 (Workers' Compensation pamphlet: at hire or by end of first pay period)",
      platforms: ["bamboohr"],
      subItems: [
        sub(
          "wtpa",
          "Wage Theft Prevention Act notice (non-exempt only)",
          [{ fact: "exempt", equals: false }],
          "Non-exempt hires only",
        ),
        sub(
          "sb294-kyr",
          "SB 294 Workplace Know Your Rights notice (required at hire from February 1, 2026; covers workers' comp, immigration protections, union rights, constitutional rights)",
        ),
        sub("sb294-emergency", "Emergency contact designation form (SB 294)"),
        sub("crd-harassment", "Sexual harassment prevention pamphlet (CRD)"),
        sub(
          "wc-time-of-hire",
          "Workers' Compensation Time of Hire pamphlet (at hire or by end of first pay period)",
        ),
        sub("de2511", "Paid Family Leave pamphlet (DE 2511)"),
        sub("de2515", "State Disability Insurance pamphlet (DE 2515)"),
        sub("survivors", "Survivors of Violence rights pamphlet (2026 version)"),
        sub(
          "pdl-cfra",
          "Pregnancy Disability Leave and CFRA notice (5+ employees)",
          [{ fact: "headcount", gte: 5 }],
          "Applies at 5+ employees",
        ),
        sub("psl", "Paid Sick Leave notice (Labor Code 246, 2026 version)"),
        sub("eitc", "Earned Income Tax Credit notice"),
        sub(
          "handbook",
          "Employee handbook with CA policies: harassment, meal and rest breaks, overtime, sick leave, lactation accommodation, expense reimbursement",
        ),
      ],
      citations: [
        c("Labor Code 2810.5", "DIR"),
        c("SB 294", "DIR"),
        c("CRD harassment pamphlet", "CRD"),
        c("DE 2511", "EDD"),
        c("DE 2515", "EDD"),
        c("Labor Code 246", "DIR"),
        c("EITC notice", "EDD"),
        c("PDL and CFRA notice", "CRD"),
      ],
      dependsOn: [],
    },
  ),
  item(
    "onboarding",
    ON_D1_LEGAL,
    "on-iipp",
    "☐ [CA] Cal/OSHA Injury and Illness Prevention Program orientation, signed (8 CCR 3203).",
    {
      title: "Cal/OSHA IIPP orientation, signed",
      trigger: T_ON,
      timing: START(0),
      timingText: "Day 1",
      citations: [c("8 CCR 3203", "Cal/OSHA")],
    },
  ),
  item(
    "onboarding",
    ON_D1_LEGAL,
    "on-heat-illness",
    "☐ [CA] Field roles: Heat Illness Prevention training before any outdoor work (8 CCR 3395); PPE issue log signed.",
    {
      title: "Heat Illness Prevention training and PPE log (field)",
      roles: ["field"],
      trigger: "Before any outdoor work",
      timing: START(0),
      timingText: "Before any outdoor work",
      citations: [c("8 CCR 3395", "Cal/OSHA")],
    },
  ),
  item(
    "onboarding",
    ON_D1_LEGAL,
    "on-meal-rest",
    "☐ [CA] Meal and rest period policy acknowledged; timekeeping set up for non-exempt staff.",
    {
      title: "Meal and rest policy; timekeeping (non-exempt)",
      trigger: T_ON,
      timing: START(0),
      timingText: "Day 1",
      flags: [
        "The policy acknowledgment applies to everyone; timekeeping setup is for non-exempt staff.",
      ],
    },
  ),
  item(
    "onboarding",
    ON_D1_OPS,
    "on-welcome-tour",
    "☐ Welcome, team intros, office or jobsite tour.",
    { title: "Welcome, intros, tour", trigger: T_ON, owner: "hiring_manager", timing: START(0) },
  ),
  item(
    "onboarding",
    ON_D1_OPS,
    "on-verify-logins",
    "☐ Verify all logins and 2FA. Designers open Revit and Bluebeam under their own license.",
    {
      title: "Verify logins and 2FA (designers: own Revit/Bluebeam license)",
      trigger: T_ON,
      stepType: "access_request",
      timing: START(0),
      platforms: ["google_workspace", "slack", "jobtread", "autodesk_revit", "bluebeam_revu"],
      approvals: [ACCESS_APPROVAL],
    },
  ),
  item(
    "onboarding",
    ON_D1_OPS,
    "on-benefits-start",
    "☐ Benefits enrollment started; deadlines explained.",
    {
      title: "Start benefits enrollment",
      trigger: T_ON,
      timing: START(0),
      platforms: ["payroll_benefits"],
    },
  ),
  item("onboarding", ON_D1_OPS, "on-plan-review", "☐ 30/60/90 plan reviewed with manager.", {
    title: "Review 30/60/90 plan",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(0),
  }),
  item(
    "onboarding",
    ON_D1_OPS,
    "on-baxter-intro",
    "☐ Slack onboarding automation fires the Baxter intro sequence: what Baxter is, which functions are staff-facing, and where to go when it misbehaves. Same content sent by email for a searchable copy.",
    {
      title: "Baxter intro sequence (Slack + email copy)",
      trigger: T_ON,
      owner: "tech_ops_manager",
      timing: START(0),
      platforms: ["slack", "baxter"],
      communication: "baxter_intro",
      flags: [
        "No Slack onboarding automation is switched on in Baxter. Sam prepares the intro as a draft; a person sends it until leadership configures and approves the automation.",
      ],
    },
  ),
  item("onboarding", ON_D1_OPS, "on-lunch", "☐ Lunch with manager or buddy.", {
    title: "Lunch with manager or buddy",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(0),
  }),
  item(
    "onboarding",
    ON_D23,
    "on-baxter-video",
    "☐ Recorded Baxter video walkthrough (Loom or similar) covering staff-facing modules only. Internal engineering functions stay out.",
    {
      title: "Baxter video walkthrough (staff-facing only)",
      trigger: T_ON,
      owner: "tech_ops_manager",
      timing: START(2),
      timingText: "Day 2 to 3",
      platforms: ["baxter"],
    },
  ),
  item("onboarding", ON_W1, "on-company-story", "☐ Company story, mission, and brand overview.", {
    title: "Company story, mission, brand",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(4),
    timingText: "Week 1",
  }),
  item(
    "onboarding",
    ON_W1,
    "on-role-training",
    "☐ Role training, SOPs, shadowing. Field roles ride along on an active project.",
    {
      title: "Role training, SOPs, shadowing (field: ride-along)",
      trigger: T_ON,
      owner: "hiring_manager",
      timing: START(4),
      timingText: "Week 1",
    },
  ),
  item(
    "onboarding",
    ON_W1,
    "on-baxter-live",
    "☐ Live 30-minute Baxter session with the tech ops manager, role-specific: sales sees lead intake and handoff; design sees document and project flow; marketing sees data and reporting; admin sees the rest.",
    {
      title: "Live role-specific Baxter session",
      trigger: T_ON,
      owner: "tech_ops_manager",
      timing: START(4),
      timingText: "Week 1",
      platforms: ["baxter"],
    },
  ),
  item(
    "onboarding",
    ON_W1,
    "on-baxter-checkpoint",
    "☐ Baxter checkpoint: employee completes a short role task in Baxter (log an entry, pull a report, trigger a handoff) and confirms in the Slack sequence. Step marked complete in BambooHR.",
    {
      title: "Baxter checkpoint task",
      trigger: T_ON,
      owner: "tech_ops_manager",
      timing: START(4),
      timingText: "Week 1",
      platforms: ["baxter", "slack", "bamboohr"],
      dependsOn: ["on-baxter-live"],
      flags: ["BambooHR is read-only for Sam; a person marks the BambooHR step complete."],
    },
  ),
  item(
    "onboarding",
    ON_W1,
    "on-cross-intros",
    "☐ Cross-functional intros: design, permits, construction, sales.",
    {
      title: "Cross-functional intros",
      trigger: T_ON,
      owner: "hiring_manager",
      timing: START(4),
      timingText: "Week 1",
    },
  ),
  item("onboarding", ON_W1, "on-first-deliverable", "☐ First small deliverable assigned.", {
    title: "Assign first small deliverable",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(4),
    timingText: "Week 1",
  }),
  item("onboarding", ON_W1, "on-week1-checkin", "☐ Manager check-in at end of week.", {
    title: "End-of-week manager check-in",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(4),
    timingText: "End of week 1",
  }),
  item(
    "onboarding",
    ON_20,
    "on-de34",
    "☐ [CA] File the DE 34 new employee report with EDD within 20 days of the start date.",
    {
      title: "File DE 34 new employee report",
      trigger: T_ON,
      stepType: "finance_handoff",
      timing: START(20),
      timingText: "Within 20 days of the start date",
      documents: ["DE 34 Report of New Employee(s)"],
      citations: [c("DE 34", "EDD")],
      flags: ["Often filed by the payroll provider — record who filed it and the confirmation."],
    },
  ),
  item("onboarding", ON_D30, "on-benefits-confirmed", "☐ Benefits enrollment confirmed.", {
    title: "Confirm benefits enrollment",
    trigger: T_ON,
    timing: START(29),
    timingText: "Day 30",
    platforms: ["payroll_benefits"],
    dependsOn: ["on-benefits-start"],
  }),
  item("onboarding", ON_D30, "on-gaps-closed", "☐ Access and equipment gaps closed.", {
    title: "Close access and equipment gaps",
    trigger: T_ON,
    stepType: "access_request",
    timing: START(29),
    timingText: "Day 30",
    approvals: [ACCESS_APPROVAL],
  }),
  item(
    "onboarding",
    ON_D30,
    "on-30-checkin",
    "☐ 30-day check-in: what is working, what is unclear, feedback both directions.",
    {
      title: "30-day check-in",
      trigger: T_ON,
      owner: "hiring_manager",
      timing: START(29),
      timingText: "Day 30",
    },
  ),
  item(
    "onboarding",
    ON_D30,
    "on-baxter-feedback",
    "☐ Slack prompt asks what was confusing about Baxter; answers routed to the tech ops manager for playbook updates.",
    {
      title: "Baxter feedback prompt",
      trigger: T_ON,
      owner: "tech_ops_manager",
      timing: START(29),
      timingText: "Day 30",
      platforms: ["slack", "baxter"],
      communication: "baxter_feedback",
    },
  ),
  item(
    "onboarding",
    ON_6M,
    "on-harassment-training",
    "☐ [CA] Harassment prevention training (5+ employees): 1 hour non-supervisory, 2 hours supervisory, within 6 months of hire or promotion, then every 2 years. Completion tracked in BambooHR.",
    {
      title: "Harassment prevention training (1h / 2h supervisory)",
      trigger: T_ON,
      conditions: [{ fact: "headcount", gte: 5 }],
      timing: { kind: "months", anchor: "start_date", offset: 6 },
      timingText: "Within 6 months of hire or promotion, then every 2 years",
      platforms: ["bamboohr"],
      citations: [c("Gov Code 12950.1", "CRD")],
    },
  ),
  item("onboarding", ON_D60, "on-mid-review", "☐ Mid-plan review against goals.", {
    title: "Mid-plan review",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(59),
    timingText: "Day 60",
  }),
  item(
    "onboarding",
    ON_D60,
    "on-expanded-ownership",
    "☐ Expanded ownership of a workflow or project.",
    {
      title: "Expanded ownership",
      trigger: T_ON,
      owner: "hiring_manager",
      timing: START(59),
      timingText: "Day 60",
    },
  ),
  item("onboarding", ON_D60, "on-peer-feedback", "☐ Peer feedback collected.", {
    title: "Collect peer feedback",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(59),
    timingText: "Day 60",
  }),
  item("onboarding", ON_D90, "on-90-review", "☐ Formal 90-day review and next-quarter goals.", {
    title: "Formal 90-day review",
    trigger: T_ON,
    owner: "hiring_manager",
    timing: START(89),
    timingText: "Day 90",
  }),
  item("onboarding", ON_D90, "on-survey", "☐ New hire onboarding survey.", {
    title: "New hire onboarding survey",
    trigger: T_ON,
    timing: START(89),
    timingText: "Day 90",
    communication: "onboarding_survey",
  }),
  item("onboarding", ON_D90, "on-plan-closed", "☐ Onboarding plan closed in BambooHR.", {
    title: "Close onboarding plan in BambooHR",
    trigger: T_ON,
    timing: START(89),
    timingText: "Day 90",
    platforms: ["bamboohr"],
    dependsOn: ["on-90-review"],
  }),
  item(
    "onboarding",
    ON_D90,
    "on-intro-outcome",
    "☐ Introductory period outcome confirmed in writing.",
    {
      title: "Introductory period outcome in writing",
      trigger: T_ON,
      owner: "hiring_manager",
      timing: START(89),
      timingText: "Day 90",
      dependsOn: ["on-90-review"],
      flags: ["The outcome is a human decision; Sam only tracks that it was documented."],
    },
  ),
];

// ---------------------------------------------------------------------------
// Part 3: Offboarding
// ---------------------------------------------------------------------------
const OFF_NOTICE = "Notice received";
const OFF_WEEK = "Last week";
const OFF_LEGAL = "Last day, legal";
const OFF_ACCESS = "Last day, access";
const OFF_POST = "Post-departure";
const AUTH = "off-authorization";

const offboarding: LifecycleItem[] = [
  item(
    "offboarding",
    OFF_NOTICE,
    "off-documented",
    "☐ Resignation documented in writing, or termination documentation completed with reasons and supporting file.",
    {
      title: "Resignation or termination documented",
      trigger: T_OFF,
      timing: NOTICE(0),
      timingText: "When notice is received",
      documents: ["Written resignation or termination documentation"],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_NOTICE,
    "off-cal-warn",
    "☐ [CA] Cal-WARN check: 75+ employees and 50+ affected at one site requires 60 days notice. Flag for future scale.",
    {
      title: "Cal-WARN check (75+ employees)",
      trigger: T_OFF,
      conditions: [{ fact: "headcount", gte: 75 }],
      timing: NOTICE(0),
      timingText: "When notice is received",
      citations: [c("Cal-WARN", "EDD")],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_NOTICE,
    "off-notify",
    "☐ Notify payroll, IT, and the direct team on a need-to-know basis.",
    {
      title: "Notify payroll, IT, and team (need-to-know)",
      trigger: T_OFF,
      timing: NOTICE(1),
      communication: "departure_notice",
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_NOTICE,
    "off-knowledge-transfer",
    "☐ Knowledge transfer plan: active projects, client contacts, open permits, vendor relationships.",
    {
      title: "Knowledge transfer plan",
      trigger: T_OFF,
      owner: "hiring_manager",
      timing: NOTICE(2),
      dependsOn: [AUTH],
    },
  ),
  item("offboarding", OFF_NOTICE, "off-exit-scheduled", "☐ Exit interview scheduled.", {
    title: "Schedule exit interview",
    trigger: T_OFF,
    timing: NOTICE(2),
    communication: "exit_interview",
    dependsOn: [AUTH],
  }),
  item(
    "offboarding",
    OFF_WEEK,
    "off-drive-transfer",
    "☐ Google Drive: transfer ownership of all files and folders to the manager. Orphaned ownership is the most common post-departure data loss.",
    {
      title: "Transfer Google Drive ownership to manager",
      trigger: "Last week",
      stepType: "access_request",
      timing: LAST(-3),
      timingText: "Last week",
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-jobtread-reassign",
    "☐ JobTread: reassign jobs, tasks, and daily log responsibilities before deactivation.",
    {
      title: "Reassign JobTread jobs, tasks, daily logs",
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(-3),
      timingText: "Before deactivation",
      platforms: ["jobtread"],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-design-handoff",
    "☐ Designers: all working Revit models saved to shared storage, not local drives. Bluebeam markup sessions handed off.",
    {
      title: "Designers: Revit models to shared storage, Bluebeam handoff",
      roles: ["design"],
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(-2),
      timingText: "Last week",
      platforms: ["autodesk_revit", "bluebeam_revu"],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-sales-handoff",
    "☐ Sales: reassign all open GoHighLevel opportunities and contacts; turn off round-robin for the user; export conversation history if needed.",
    {
      title: "Sales: reassign GHL opportunities, round-robin off",
      roles: ["sales"],
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(-2),
      timingText: "Last week",
      platforms: ["gohighlevel"],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-marketing-handoff",
    "☐ Marketing: reassign GoHighLevel campaigns and automations; confirm no Webflow pages are checked out or in draft under their name.",
    {
      title: "Marketing: reassign GHL campaigns, Webflow drafts",
      roles: ["marketing"],
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(-2),
      timingText: "Last week",
      platforms: ["gohighlevel", "webflow"],
      dependsOn: [AUTH],
    },
  ),
  item("offboarding", OFF_WEEK, "off-email-plan", "☐ Email forwarding and auto-reply plan set.", {
    title: "Email forwarding and auto-reply plan",
    trigger: "Last week",
    timing: LAST(-1),
    communication: "auto_reply",
    dependsOn: [AUTH],
  }),
  item(
    "offboarding",
    OFF_WEEK,
    "off-property",
    "☐ Collect company property: laptop, phone, keys, badges, vehicle, tools, PPE, credit cards. [CA] No wage deductions for unreturned items (Labor Code 221).",
    {
      title: "Collect company property (no wage deductions)",
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(0),
      citations: [c("Labor Code 221", "DIR")],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-no-clawback",
    "☐ [CA] No training-cost clawback. Most stay-or-pay agreements are void as of January 1, 2026.",
    {
      title: "No training-cost clawback (stay-or-pay)",
      trigger: "Last week",
      timing: LAST(-1),
      citations: [c("Stay-or-pay agreements void from January 1, 2026", "Legislature")],
      dependsOn: [AUTH],
      flags: ["The document cites no statute; the reviewer must find the official source."],
    },
  ),
  item(
    "offboarding",
    OFF_WEEK,
    "off-rosters",
    "☐ Remove from active jobsite rosters and client-facing contact lists.",
    {
      title: "Remove from jobsite rosters and client contact lists",
      trigger: "Last week",
      owner: "hiring_manager",
      timing: LAST(0),
      dependsOn: [AUTH],
    },
  ),
  item("offboarding", OFF_WEEK, "off-exit-conducted", "☐ Exit interview conducted.", {
    title: "Conduct exit interview",
    trigger: "Last week",
    timing: LAST(0),
    dependsOn: ["off-exit-scheduled"],
  }),
  item(
    "offboarding",
    OFF_LEGAL,
    "off-final-pay",
    "☐ [CA] Final pay timing: immediately if fired or laid off. If the employee resigns, within 72 hours, or on the last day if they gave 72+ hours notice (Labor Code 201, 202). Waiting time penalties under Labor Code 203 run up to 30 days of wages.",
    {
      title: "Final pay on time",
      trigger: "Last day",
      stepType: "finance_handoff",
      timing: { kind: "final_pay" },
      timingText:
        "Immediately if fired or laid off; within 72 hours of a resignation without notice; on the last day with 72+ hours' notice",
      citations: [
        c("Labor Code 201", "DIR"),
        c("Labor Code 202", "DIR"),
        c("Labor Code 203", "DIR"),
      ],
      dependsOn: [AUTH],
      flags: ["Sam never calculates or runs pay; the head of finance completes and records it."],
    },
  ),
  item(
    "offboarding",
    OFF_LEGAL,
    "off-vacation-payout",
    "☐ [CA] Pay out all accrued, unused vacation at the final rate of pay (Labor Code 227.3). Sick leave is not paid out.",
    {
      title: "Pay out accrued vacation",
      trigger: "Last day",
      stepType: "finance_handoff",
      timing: { kind: "final_pay" },
      timingText: "With final pay",
      citations: [c("Labor Code 227.3", "DIR")],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_LEGAL,
    "off-final-pay-method",
    "☐ [CA] Direct deposit for final pay only with written consent and only if timing is met; otherwise cut a paper check.",
    {
      title: "Final pay method (consent and timing)",
      trigger: "Last day",
      stepType: "finance_handoff",
      timing: { kind: "final_pay" },
      timingText: "With final pay",
      citations: [c("Final pay by direct deposit (written consent)", "DIR")],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_LEGAL,
    "off-wage-statement",
    "☐ [CA] Final itemized wage statement (Labor Code 226).",
    {
      title: "Final itemized wage statement",
      trigger: "Last day",
      stepType: "finance_handoff",
      timing: { kind: "final_pay" },
      timingText: "With final pay",
      citations: [c("Labor Code 226", "DIR")],
      dependsOn: [AUTH],
    },
  ),
  item("offboarding", OFF_LEGAL, "off-separation-notices", "☐ [CA] Separation notices delivered:", {
    title: "Deliver separation notices",
    trigger: "Last day",
    stepType: "checklist",
    timing: LAST(0),
    timingText: "Last day (COBRA election form within 20 days)",
    subItems: [
      sub(
        "change-in-relationship",
        "Notice to Employee as to Change in Relationship (discharge, layoff, or leave)",
      ),
      sub("de2320", "EDD For Your Benefit pamphlet (DE 2320)"),
      sub(
        "cobra",
        "COBRA (20+ employees) or Cal-COBRA (2 to 19 employees) election notice; COBRA election form within 20 days",
      ),
      sub(
        "dhcs9061",
        "Health Insurance Premium Payment notice (DHCS 9061) if on group health",
        [{ fact: "on_group_health", equals: true }],
        "Only if the employee is on group health",
      ),
    ],
    citations: [
      c("Notice to Employee as to Change in Relationship", "EDD"),
      c("DE 2320", "EDD"),
      c("COBRA", "Federal"),
      c("Cal-COBRA", "Legislature"),
      c("DHCS 9061", "DHCS"),
    ],
    dependsOn: [AUTH],
    flags: [
      "COBRA versus Cal-COBRA depends on headcount (20+ vs 2 to 19). The plan names which one applies, or flags it when headcount is unknown.",
    ],
  }),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-google-suspend",
    "☐ Google Workspace: suspend the account (do not delete) for 30 days; forward email to manager; set auto-reply.",
    {
      title: "Suspend Google Workspace (do not delete); forward; auto-reply",
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH, "off-drive-transfer"],
    },
  ),
  item("offboarding", OFF_ACCESS, "off-slack", "☐ Slack: deactivate. Channel history stays.", {
    title: "Deactivate Slack",
    trigger: "Last day",
    stepType: "access_request",
    timing: LAST(0),
    platforms: ["slack"],
    approvals: [ACCESS_APPROVAL],
    dependsOn: [AUTH],
  }),
  item("offboarding", OFF_ACCESS, "off-jobtread", "☐ JobTread: deactivate user; seat freed.", {
    title: "Deactivate JobTread user",
    trigger: "Last day",
    stepType: "access_request",
    timing: LAST(0),
    platforms: ["jobtread"],
    approvals: [ACCESS_APPROVAL],
    dependsOn: [AUTH, "off-jobtread-reassign"],
  }),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-design-licenses",
    "☐ Designers: unassign Revit and Bluebeam named-user licenses; seats returned to pool.",
    {
      title: "Unassign Revit and Bluebeam licenses",
      roles: ["design"],
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: ["autodesk_revit", "bluebeam_revu"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH, "off-design-handoff"],
    },
  ),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-ghl-sales",
    "☐ Sales: deactivate GoHighLevel user; release or reassign their phone number.",
    {
      title: "Deactivate GHL user; phone number",
      roles: ["sales"],
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: ["gohighlevel"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH, "off-sales-handoff"],
    },
  ),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-marketing-access",
    "☐ Marketing: deactivate GoHighLevel user; remove Webflow member; remove from Meta Business Suite, Facebook, Instagram, X, YouTube, LinkedIn, Google Business Profile, Google Ads, and GA4. Confirm Primary Owner on Google Business Profile, the YouTube brand account, and Meta Business Suite is still a company-controlled account.",
    {
      title: "Remove marketing and social access; confirm Primary Owners",
      roles: ["marketing"],
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: [
        "gohighlevel",
        "webflow",
        "meta_business_suite",
        "x_twitter",
        "youtube",
        "linkedin_page",
        "google_business_profile",
        "google_ads",
        "google_analytics",
      ],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH, "off-marketing-handoff"],
    },
  ),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-baxter",
    "☐ Baxter: deactivate user, API keys, and any automations running under their identity.",
    {
      title: "Deactivate Baxter user, keys, automations",
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: ["baxter"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-rotate-credentials",
    "☐ Rotate shared credentials: Wi-Fi, vendor logins, scheduling tools, stock photo accounts, podcast hosting.",
    {
      title: "Rotate shared credentials",
      trigger: "Last day",
      stepType: "access_request",
      timing: LAST(0),
      platforms: ["shared_credentials"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_ACCESS,
    "off-payroll-benefits",
    "☐ Deactivate payroll and benefits; provide 401k rollover instructions.",
    {
      title: "Deactivate payroll and benefits; 401k rollover info",
      trigger: "Last day",
      stepType: "finance_handoff",
      timing: LAST(0),
      platforms: ["payroll_benefits"],
      dependsOn: [AUTH, "off-final-pay"],
    },
  ),
  item(
    "offboarding",
    OFF_POST,
    "off-7day-audit",
    "☐ 7-day audit: Google admin, Slack, JobTread, GoHighLevel, Webflow, Autodesk, Bluebeam, Baxter, and every social and Google platform show no active access.",
    {
      title: "7-day access audit",
      trigger: "7 days after the last day",
      stepType: "access_request",
      timing: LAST(7),
      timingText: "7 days after departure",
      platforms: [
        "google_workspace",
        "slack",
        "jobtread",
        "gohighlevel",
        "webflow",
        "autodesk_revit",
        "bluebeam_revu",
        "baxter",
        "meta_business_suite",
        "x_twitter",
        "youtube",
        "linkedin_page",
        "google_business_profile",
        "google_ads",
        "google_analytics",
      ],
      approvals: [ACCESS_APPROVAL],
      dependsOn: [
        "off-google-suspend",
        "off-slack",
        "off-jobtread",
        "off-design-licenses",
        "off-ghl-sales",
        "off-marketing-access",
        "off-baxter",
      ],
    },
  ),
  item(
    "offboarding",
    OFF_POST,
    "off-retention",
    "☐ [CA] [Fed] Retention: personnel file 3 years after separation (Labor Code 1198.5); payroll and time records 3 years (Labor Code 1174); I-9 for 3 years from hire or 1 year from termination, whichever is later.",
    {
      title: "Set record retention dates",
      trigger: "After departure",
      timing: LAST(7),
      citations: [
        c("Labor Code 1198.5", "DIR"),
        c("Labor Code 1174", "DIR"),
        c("Form I-9 retention (USCIS)", "Federal"),
      ],
      dependsOn: [AUTH],
    },
  ),
  item(
    "offboarding",
    OFF_POST,
    "off-google-delete",
    "☐ Delete or archive the Google account after the retention window.",
    {
      title: "Delete or archive the Google account",
      trigger: "After the retention window",
      stepType: "access_request",
      timing: LAST(30),
      timingText: "After the retention window",
      platforms: ["google_workspace"],
      approvals: [ACCESS_APPROVAL],
      dependsOn: ["off-google-suspend", "off-retention"],
      flags: [
        'Ambiguous: "the retention window" could mean the 30-day suspension or the 3-year record retention. The default due date is 30 days after the last day; confirm before relying on it.',
      ],
    },
  ),
  item(
    "offboarding",
    OFF_POST,
    "off-exit-themes",
    "☐ Review exit interview themes with ownership.",
    {
      title: "Review exit themes with ownership",
      trigger: "After departure",
      owner: "leadership",
      timing: LAST(14),
      dependsOn: ["off-exit-conducted"],
    },
  ),
  item("offboarding", OFF_POST, "off-backfill", "☐ Open backfill requisition if needed.", {
    title: "Open backfill requisition if needed",
    trigger: "After departure",
    owner: "hiring_manager",
    timing: LAST(7),
  }),
  item(
    "offboarding",
    OFF_POST,
    "off-directory",
    "☐ Update org chart, website team page, and internal directory.",
    {
      title: "Update org chart, team page, directory",
      trigger: "After departure",
      timing: LAST(7),
    },
  ),
];

// ---------------------------------------------------------------------------
// Recurring compliance calendar
// ---------------------------------------------------------------------------
const recurring: RecurringItem[] = [
  {
    id: "rc-kyr-notice",
    item: "Know Your Rights notice to all employees",
    when: "On or before February 1 each year",
    requirement: "[CA] SB 294",
    tags: ["CA"],
    cadence: { kind: "annual", month: 2, day: 1 },
    citations: [c("SB 294", "DIR")],
    defaultOwner: "hr_admin",
    flags: [],
  },
  {
    id: "rc-harassment-refresh",
    item: "Harassment prevention training refresh",
    when: "Every 2 years per employee",
    requirement: "[CA] Gov Code 12950.1 (5+ employees)",
    tags: ["CA"],
    cadence: { kind: "per_employee_years", years: 2 },
    citations: [c("Gov Code 12950.1", "CRD")],
    defaultOwner: "hr_admin",
    flags: ["Applies at 5+ employees. Each employee's due date runs from their last completion."],
  },
  {
    id: "rc-eitc",
    item: "EITC notice",
    when: "Twice yearly per EDD schedule",
    requirement: "[CA]",
    tags: ["CA"],
    cadence: { kind: "twice_yearly" },
    citations: [c("EITC notice", "EDD")],
    defaultOwner: "hr_admin",
    flags: [
      "The document does not give the EDD dates. Occurrences have no due date until a reviewer enters the verified EDD schedule.",
    ],
  },
  {
    id: "rc-posters",
    item: "Labor law poster refresh, office and jobsites",
    when: "Each January",
    requirement: "[CA] [Fed]",
    tags: ["CA", "Fed"],
    cadence: { kind: "annual", month: 1, day: 31 },
    citations: [
      c("DIR Required Posters and Notices", "DIR"),
      c("Federal workplace posters", "Federal"),
    ],
    defaultOwner: "hr_admin",
    flags: ['"Each January" is tracked as due January 31.'],
  },
  {
    id: "rc-pamphlets",
    item: "Pamphlet packet refresh from DIR, EDD, CRD",
    when: "Each January",
    requirement: "[CA]",
    tags: ["CA"],
    cadence: { kind: "annual", month: 1, day: 31 },
    citations: [
      c("DIR Required Posters and Notices", "DIR"),
      c("EDD Required Notices and Pamphlets", "EDD"),
      c("CRD publications", "CRD"),
    ],
    defaultOwner: "hr_admin",
    flags: ['"Each January" is tracked as due January 31.'],
  },
  {
    id: "rc-baxter-review",
    item: "Slack onboarding automation and Baxter walkthrough review",
    when: "Quarterly, tech ops manager",
    requirement: "Best practice",
    tags: [],
    cadence: { kind: "quarterly" },
    citations: [],
    defaultOwner: "tech_ops_manager",
    flags: [],
  },
  {
    id: "rc-access-audit",
    item: "Access register audit (all platforms, all staff)",
    when: "Quarterly",
    requirement: "Best practice",
    tags: [],
    cadence: { kind: "quarterly" },
    citations: [],
    defaultOwner: "coo",
    flags: [],
  },
];

export const CHECKLIST_CATALOG: ChecklistCatalog = {
  documentKey: CHECKLIST_KEY,
  documentVersion: CHECKLIST_VERSION,
  title: CHECKLIST_TITLE,
  dateLine: "Oct 28, 2026 · @James Parks",
  howToUse: [
    "This is the standard pre-boarding, onboarding, and offboarding checklist for Acton ADU, mapped to California requirements. Items tagged [CA] or [Fed] are legal requirements. Untagged items are BambooHR best practice. Each hire or departure gets a copy with the boxes ticked in BambooHR or this doc.",
    "Employee-count thresholds (5, 20, 75) change what applies. Confirm Acton's current headcount against each tagged item, and have counsel or the payroll provider sanity-check timing items before adopting.",
  ],
  sourcesIntro:
    "Official and free. Pull current PDFs from these pages each January and whenever a hire starts; never reuse last year's packet.",
  sources: [
    {
      name: "DIR Required Posters and Notices",
      covers: "Labor Commissioner notices, Know Your Rights annual notice, posting rules",
      linkText: "dir.ca.gov/dlse/RequiredPosters.html",
      url: "https://dir.ca.gov/dlse/RequiredPosters.html",
      official: true,
    },
    {
      name: "DIR Workplace Postings",
      covers: "Downloadable posters and the Labor Code 2810.5 notice",
      linkText: "dir.ca.gov/wpnodb.html",
      url: "https://www.dir.ca.gov/wpnodb.html",
      official: true,
    },
    {
      name: "EDD Required Notices and Pamphlets",
      covers: "DE 2320, DE 2511, DE 2515, EITC notices",
      linkText: "edd.ca.gov Required Notices",
      url: "https://edd.ca.gov/en/Payroll_Taxes/Required_Notices_and_Pamphlets",
      official: true,
    },
    {
      name: "Civil Rights Department publications",
      covers: "Harassment pamphlet, PDL and CFRA notices, Survivors of Violence pamphlet",
      linkText: "calcivilrights.ca.gov/publications",
      url: "https://calcivilrights.ca.gov/publications/",
      official: true,
    },
    {
      name: "CalChamber HRCalifornia New Hire Guide (paid)",
      covers: "Packaged checklists, pamphlet bundles, year-round compliance alerts",
      linkText: "HRCalifornia New Hire Guide",
      url: "https://p-hrcalifornia.calchamber.com/forms-tools/new-hire-guide",
      official: false,
    },
  ],
  sourcesNote:
    "Use the state sites as the source of truth and CalChamber for the packaged kits and alerts.",
  phaseGoals: {
    preboarding:
      "Goal: every legal document, account, and seat is ready so Day 1 is orientation, not IT triage.",
    onboarding:
      "Goal: legal paperwork closed in the first week, the new hire productive in their tools by Day 30, and a formal review at Day 90.",
    offboarding:
      "Goal: final pay and notices delivered on time, every account and seat released, and no access lingering after 7 days.",
  },
  items: [...preboarding, ...onboarding, ...offboarding],
  recurringIntro:
    "These run on a schedule regardless of hires. Assign an owner in BambooHR for each.",
  recurring,
  flags: [
    "Employee-count thresholds (5, 20, 75) decide whether CFRA, COBRA vs Cal-COBRA, harassment training, and Cal-WARN apply. Confirm current headcount before adopting.",
    "SB 294 and the 2026 pamphlet revisions are new this year. Do not reuse a 2025 packet.",
    "Social media access is the highest-risk item on this list for a brand-forward company. Confirm the company Google Workspace account owns the YouTube channel and is Primary Owner on Meta Business Suite and Google Business Profile before the next hire or departure.",
    "Autodesk, Bluebeam, Webflow, and JobTread seats are real cost lines. The licensed software gate in Part 1 exists so finance sees them at hiring approval, not at invoice.",
    "Have employment counsel or the payroll provider check timing items (final pay, I-9, DE 34, training deadlines) before this goes live.",
  ],
};

/**
 * The offboarding authorization step added before anything else in an offboarding case. It is not
 * a checkbox in the leadership document; the brief requires explicit human authorization.
 */
export const OFFBOARDING_AUTHORIZATION: LifecycleItem = {
  id: AUTH,
  phase: "offboarding",
  origin: "system",
  sourceRef: {
    documentKey: CHECKLIST_KEY,
    documentVersion: CHECKLIST_VERSION,
    part: PART_3,
    section: "Added by Baxter (not in the document)",
    ordinal: 0,
  },
  text: "Leadership explicitly authorizes this separation before any offboarding task, notice, or access change begins.",
  title: "Leadership authorizes this separation",
  subItems: [],
  tags: [],
  jurisdiction: "Company practice",
  roles: "general",
  conditions: [],
  trigger: T_OFF,
  timing: NOTICE(0),
  timingText: "Before anything else",
  owner: "leadership",
  stepType: "approval",
  documents: [],
  platforms: [],
  approvals: [
    "CEO or COO approval recorded in Baxter (silence or a forwarded message never counts)",
  ],
  citations: [],
  dependsOn: [],
  privilegedAccess: false,
  communication: null,
  flags: [
    "Immediate or involuntary departures always need this approval; Sam never decides to end employment.",
  ],
};

export function itemsForPhase(phase: LifecyclePhase, catalog = CHECKLIST_CATALOG) {
  return catalog.items.filter((i) => i.phase === phase);
}

export function findItem(id: string, catalog = CHECKLIST_CATALOG): LifecycleItem | null {
  return catalog.items.find((i) => i.id === id) ?? null;
}
