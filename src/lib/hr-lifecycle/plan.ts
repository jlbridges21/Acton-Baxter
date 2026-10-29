/**
 * The lifecycle planner (pure). Given a phase's items (from the published template version, so
 * admin edits apply), the employee's confirmed facts, and the key dates, it decides which items
 * apply and why, when each is due, who owns it, which legal items are still unverified, which
 * licensed seats are needed, what information or approvals are missing, and drafts the
 * communications for HR review. Starting a case persists exactly this plan.
 */

import { renderDraft, type CommunicationTemplate } from "./communications";
import { PLATFORM_BY_KEY } from "./platforms";
import {
  continuationCoverage,
  dueDateFor,
  evaluateItem,
  evaluateSubItem,
  hasSeventyTwoHoursNotice,
} from "./rules";
import {
  PHASE_LABELS,
  ROLE_KEY_LABELS,
  SEPARATION_LABELS,
  type Citation,
  type LifecycleDates,
  type LifecycleItem,
  type LifecyclePhase,
  type LifecycleProfile,
  type PlatformKey,
} from "./types";

export type VerificationState = "unverified" | "verified" | "discrepancy";

export type PlannedSubItem = { id: string; text: string; included: boolean; reasons: string[] };

export type PlannedItem = {
  itemId: string;
  origin: LifecycleItem["origin"];
  title: string;
  text: string;
  part: string;
  section: string;
  ordinal: number;
  tags: LifecycleItem["tags"];
  jurisdiction: LifecycleItem["jurisdiction"];
  legal: boolean;
  citations: Citation[];
  verification: VerificationState | null;
  included: boolean;
  reasons: string[];
  unknownFacts: string[];
  subItems: PlannedSubItem[];
  owner: LifecycleItem["owner"];
  stepType: LifecycleItem["stepType"];
  due: string | null;
  dueNote: string | null;
  timingText: string;
  missingDates: string[];
  dependsOn: string[];
  platforms: PlatformKey[];
  documents: string[];
  approvals: string[];
  privilegedAccess: boolean;
  communication: string | null;
  flags: string[];
};

export type LicenseNeed = {
  platform: PlatformKey;
  label: string;
  itemIds: string[];
  seatsAvailable: number | null;
  costRecorded: boolean;
  message: string;
};

export type DraftCommunication = {
  key: string;
  itemId: string;
  name: string;
  channel: "email" | "slack";
  subject: string;
  body: string;
  missing: string[];
};

export type LifecyclePlan = {
  phase: LifecyclePhase;
  phaseLabel: string;
  items: PlannedItem[];
  counts: { total: number; included: number; notApplicable: number; legal: number };
  legalFlags: Array<{
    itemId: string;
    title: string;
    citations: string[];
    verification: VerificationState;
    message: string;
  }>;
  licenseNeeds: LicenseNeed[];
  missingInfo: string[];
  missingApprovals: string[];
  drafts: DraftCommunication[];
  notes: string[];
};

export type SeatInfo = {
  seatsTotal: number | null;
  seatsUsed: number | null;
  seatCost: string | null;
};

export type PlanInput = {
  phase: LifecyclePhase;
  items: LifecycleItem[];
  profile: LifecycleProfile;
  dates: LifecycleDates;
  /** Verification register state per item id (missing = unverified). */
  verification?: Record<string, VerificationState>;
  seats?: Partial<Record<PlatformKey, SeatInfo>>;
  communications?: CommunicationTemplate[];
  /** Merge values for drafts (first name, manager name, …). Keep this minimal. */
  mergeValues?: Record<string, string | null | undefined>;
  /** Owners resolved from leadership decisions: role → configured? */
  ownersConfigured?: Partial<Record<LifecycleItem["owner"], boolean>>;
  /** True when a CEO/COO approval for this privileged grant already exists. */
  privilegedApprovals?: Set<string>;
};

const OWNER_LABELS: Record<string, string> = {
  ceo: "CEO",
  coo: "COO",
  leadership: "CEO or COO",
  hr_admin: "HR administrator",
  finance_owner: "Head of finance",
  hiring_manager: "Hiring manager",
  employee: "The employee",
  specific_person: "A specific person",
  tech_ops_manager: "Tech ops manager",
};
export const ownerLabel = (o: string) => OWNER_LABELS[o] ?? o;

function citationText(c: Citation) {
  return `${c.reference} (${c.authority})`;
}

export function buildLifecyclePlan(input: PlanInput): LifecyclePlan {
  const { phase, profile, dates } = input;
  const notes: string[] = [];
  const missingInfo = new Set<string>();
  const missingApprovals = new Set<string>();

  const required: Record<LifecyclePhase, Array<keyof LifecycleDates>> = {
    preboarding: ["offer_date", "start_date"],
    onboarding: ["start_date"],
    offboarding: ["notice_date", "last_day"],
  };
  const dateLabels: Record<string, string> = {
    offer_date: "Offer date",
    start_date: "Start date",
    notice_date: "Notice date",
    last_day: "Last day",
  };
  for (const k of required[phase]) if (!dates[k]) missingInfo.add(dateLabels[k]!);
  if (!profile.rolesConfirmed)
    missingInfo.add(
      "Confirm the employee's roles (design, sales, marketing, field). Role tasks and role access stay off until HR confirms them.",
    );
  if (profile.headcount === null)
    missingInfo.add("Company headcount (thresholds at 5, 20, and 75 employees)");
  if (phase !== "offboarding" && profile.exempt === null)
    missingInfo.add("Exempt or non-exempt status");
  if (phase === "offboarding") {
    if (!profile.separation) missingInfo.add("Separation type");
    if (profile.onGroupHealth === null) missingInfo.add("Whether the employee is on group health");
    if (
      profile.separation === "resignation_with_notice" &&
      dates.notice_date &&
      dates.last_day &&
      !hasSeventyTwoHoursNotice(dates.notice_date, dates.last_day)
    ) {
      notes.push(
        "The notice date is less than 72 hours before the last day, so final pay follows the without-notice rule. Check the separation type.",
      );
    }
    if (profile.separation === "involuntary" || profile.separation === "layoff")
      notes.push(
        `${SEPARATION_LABELS[profile.separation]}: final pay is due on the last day, and access removal happens that day. Leadership must authorize the separation first.`,
      );
  }
  if (profile.roles.length > 1 && profile.rolesConfirmed)
    notes.push(
      `Several roles confirmed (${profile.roles.map((r) => ROLE_KEY_LABELS[r]).join(", ")}): tasks from every role are included once each.`,
    );

  const items: PlannedItem[] = input.items.map((item) => {
    const evald = evaluateItem(item, profile);
    for (const u of evald.unknown) missingInfo.add(u);
    const subItems = item.subItems.map((s) => {
      const r = evaluateSubItem(s, profile);
      for (const u of r.unknown) missingInfo.add(u);
      return { id: s.id, text: s.text, included: r.included, reasons: r.reasons };
    });
    const due = dueDateFor(item.timing, dates, profile.separation);
    const legal = item.tags.length > 0;
    const flags = [...item.flags];
    if (item.id === "off-separation-notices") {
      const cov = continuationCoverage(profile.headcount);
      flags.unshift(
        cov.notice ? `Continuation coverage: ${cov.notice}. ${cov.reason}` : cov.reason,
      );
    }
    if (item.id === "on-harassment-training" && profile.supervisor !== null)
      flags.unshift(
        profile.supervisor
          ? "Supervisor: 2 hours of training."
          : "Non-supervisory: 1 hour of training.",
      );
    if (item.id === "on-harassment-training" && profile.supervisor === null)
      missingInfo.add("Supervisor status (decides 1 or 2 hours of harassment training)");
    return {
      itemId: item.id,
      origin: item.origin,
      title: item.title,
      text: item.text,
      part: item.sourceRef.part,
      section: item.sourceRef.section,
      ordinal: item.sourceRef.ordinal,
      tags: item.tags,
      jurisdiction: item.jurisdiction,
      legal,
      citations: item.citations,
      verification: legal ? (input.verification?.[item.id] ?? "unverified") : null,
      included: evald.included,
      reasons: evald.reasons,
      unknownFacts: evald.unknown,
      subItems,
      owner: item.owner,
      stepType: item.stepType,
      due: evald.included ? due.due : null,
      dueNote: due.note,
      timingText: item.timingText,
      missingDates: evald.included ? due.missing : [],
      dependsOn: item.dependsOn,
      platforms: item.platforms,
      documents: item.documents,
      approvals: item.approvals,
      privilegedAccess: item.privilegedAccess,
      communication: item.communication,
      flags,
    };
  });

  for (const it of items) if (it.included) for (const m of it.missingDates) missingInfo.add(m);

  // Legal flags: every included [CA]/[Fed] item, with its verification state.
  const legalFlags = items
    .filter((i) => i.included && i.legal)
    .map((i) => ({
      itemId: i.itemId,
      title: i.title,
      citations: i.citations.map(citationText),
      verification: i.verification ?? "unverified",
      message:
        i.verification === "verified"
          ? "Legal requirement; timing verified by a named reviewer."
          : i.verification === "discrepancy"
            ? "Legal requirement; a reviewer flagged a discrepancy with the official source. See the verification register."
            : "Legal requirement; deadline and wording are unverified until a named reviewer checks the official source.",
    }));

  // Licensed seats needed by the included items.
  const seatMap = new Map<PlatformKey, string[]>();
  for (const i of items.filter((x) => x.included))
    for (const p of i.platforms)
      if (PLATFORM_BY_KEY.get(p)?.licensedSeat && i.stepType === "access_request")
        seatMap.set(p, [...(seatMap.get(p) ?? []), i.itemId]);
  const licenseNeeds: LicenseNeed[] =
    phase === "offboarding"
      ? []
      : [...seatMap.entries()].map(([platform, itemIds]) => {
          const s = input.seats?.[platform];
          const available =
            s && s.seatsTotal !== null && s.seatsUsed !== null ? s.seatsTotal - s.seatsUsed : null;
          const label = PLATFORM_BY_KEY.get(platform)!.label;
          return {
            platform,
            label,
            itemIds,
            seatsAvailable: available,
            costRecorded: Boolean(s?.seatCost),
            message:
              available === null
                ? `${label}: seat availability not recorded — confirm in the admin console before the offer.`
                : available > 0
                  ? `${label}: ${available} seat(s) free per the access register.`
                  : `${label}: no free seat recorded — finance must approve an added seat before the offer.`,
          };
        });
  for (const l of licenseNeeds) {
    if (l.seatsAvailable === null || l.seatsAvailable <= 0)
      missingApprovals.add(`Seat for ${l.label} (licensed software gate)`);
    if (!l.costRecorded)
      missingInfo.add(`${l.label} seat cost (record the actual cost; Baxter never assumes prices)`);
  }

  // Approvals that must exist before or during the case.
  missingApprovals.add(
    `CEO or COO approval to start this ${PHASE_LABELS[phase].toLowerCase()} case`,
  );
  if (phase === "offboarding")
    missingApprovals.add("CEO or COO authorization of the separation (first task)");
  if (phase === "preboarding" && licenseNeeds.length)
    missingApprovals.add("Finance sign-off on fully loaded cost, including seat costs");
  for (const i of items.filter((x) => x.included && x.privilegedAccess)) {
    if (!input.privilegedApprovals?.has(i.itemId))
      missingApprovals.add(
        `${i.title}: any admin or owner-level role needs a named CEO/COO approval in the access register`,
      );
  }
  for (const i of items.filter((x) => x.included)) {
    if (input.ownersConfigured && input.ownersConfigured[i.owner] === false)
      missingInfo.add(`Owner not configured: ${ownerLabel(i.owner)} (Sam Operations → Setup)`);
  }

  // Drafts for HR review (never sent).
  const templates = new Map((input.communications ?? []).map((t) => [t.key, t]));
  const drafts: DraftCommunication[] = items
    .filter((i) => i.included && i.communication && templates.has(i.communication))
    .map((i) => {
      const t = templates.get(i.communication!)!;
      const rendered = renderDraft(t, {
        ...input.mergeValues,
        start_date: dates.start_date ?? null,
        last_day: dates.last_day ?? null,
        role_names: profile.rolesConfirmed
          ? profile.roles.map((r) => ROLE_KEY_LABELS[r]).join(", ") || "the"
          : null,
      });
      return {
        key: t.key,
        itemId: i.itemId,
        name: t.name,
        channel: t.channel,
        ...rendered,
      };
    });

  const included = items.filter((i) => i.included);
  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    items,
    counts: {
      total: items.length,
      included: included.length,
      notApplicable: items.length - included.length,
      legal: included.filter((i) => i.legal).length,
    },
    legalFlags,
    licenseNeeds,
    missingInfo: [...missingInfo],
    missingApprovals: [...missingApprovals],
    drafts,
    notes,
  };
}

/** Suggest roles from a job title. Suggestions are never applied until HR confirms them. */
export function suggestRolesFromTitle(title: string | null | undefined): Array<{
  role: keyof typeof ROLE_KEY_LABELS;
  because: string;
}> {
  const t = (title ?? "").toLowerCase();
  const out: Array<{ role: keyof typeof ROLE_KEY_LABELS; because: string }> = [];
  const rules: Array<[keyof typeof ROLE_KEY_LABELS, RegExp]> = [
    ["design", /\b(design|designer|drafter|architect|revit|cad)\b/],
    ["sales", /\b(sales|account executive|business development|estimator|consultant)\b/],
    ["marketing", /\b(marketing|social media|content|brand|seo|growth)\b/],
    [
      "field",
      /\b(field|superintendent|foreman|carpenter|laborer|construction|site|production|installer|crew)\b/,
    ],
  ];
  for (const [role, re] of rules) {
    const m = t.match(re);
    if (m) out.push({ role, because: `Job title mentions "${m[0]}"` });
  }
  return out;
}
