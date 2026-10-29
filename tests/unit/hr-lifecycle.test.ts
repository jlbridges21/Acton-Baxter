/**
 * HR lifecycle coordinator (leadership Staff Lifecycle Checklist, Oct 28, 2026).
 * Synthetic employees only, in-memory store, no network. Each describe block maps to one of the
 * fifteen acceptance items in the brief.
 */

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideApproval } from "@/lib/agents/approvals";
import { agentDb, eq, selectOne } from "@/lib/agents/store";
import type { Requester } from "@/lib/agents/types";
import {
  CHECKLIST_CATALOG,
  OFFBOARDING_AUTHORIZATION,
  itemsForPhase,
} from "@/lib/hr-lifecycle/catalog";
import { buildLifecyclePlan, suggestRolesFromTitle } from "@/lib/hr-lifecycle/plan";
import { isPrivilegedRole } from "@/lib/hr-lifecycle/platforms";
import { occurrencesFor, reminderThresholds, sweepLifecycle } from "@/lib/hr-lifecycle/reminders";
import {
  addBusinessDays,
  addMonths,
  canTransition,
  continuationCoverage,
  displayStatus,
  dueDateFor,
  finalPayDue,
} from "@/lib/hr-lifecycle/rules";
import * as svc from "@/lib/hr-lifecycle/service";
import {
  parseChecklistDocx,
  parseChecklistHtml,
  reconcile,
} from "@/lib/hr-lifecycle/source-document";
import {
  applyItemEdits,
  complianceChanges,
  definitionFromCatalog,
  itemsFromDefinition,
} from "@/lib/hr-lifecycle/templates";
import type { LifecycleProfile, LifecyclePhase } from "@/lib/hr-lifecycle/types";
import { validateDefinition } from "@/lib/ops/definition";
import { getInstanceDetail, requestPublish, type StepRow } from "@/lib/ops/engine";
import { setOpsFetcherForTests } from "@/lib/ops/integrations";
import {
  getOpsAccess,
  listEntities,
  resetOpsOrgForTests,
  setDecision,
  type OpsAccess,
} from "@/lib/ops/org";
import * as reg from "@/lib/ops/registers";
import { STARTER_WORKFLOWS } from "@/lib/ops/starters";
import { workflowDefinitionSchema } from "@/lib/ops/definition";
import { getReportStore } from "@/lib/research/report-store";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, setupAgentTestEnv } from "./agents-test-helpers";

const FIXTURE = "tests/fixtures/hr/staff-lifecycle-checklist-2026-10-28.docx";
const CEO_ID = "00000000-0000-4000-8000-0000000000b1";
const COO_ID = "00000000-0000-4000-8000-0000000000b2";
const FIN_ID = "00000000-0000-4000-8000-0000000000b3";
const TECH_ID = "00000000-0000-4000-8000-0000000000b4";
const MANAGER_ID = "00000000-0000-4000-8000-0000000000b5";

const req = (id: string, role = "user"): Requester => ({
  userId: id,
  role,
  departmentId: null,
  label: "Tester",
  verifiedVia: "web_session",
});
const access = (id: string, role = "user") => getOpsAccess(req(id, role));

const profile = (p: Partial<LifecycleProfile> = {}): LifecycleProfile => ({
  roles: [],
  rolesConfirmed: true,
  exempt: false,
  supervisor: false,
  headcount: 12,
  onGroupHealth: true,
  separation: null,
  ...p,
});

let externalCalls = 0;

async function bootstrap(headcount: number | null = 12) {
  const admin = await access(ADMIN_ID, "admin");
  await setDecision({
    key: "ceo_account",
    status: "confirmed",
    value: CEO_ID,
    access: admin,
    actorLabel: "Admin",
  });
  const ceo = await access(CEO_ID);
  for (const [key, value] of [
    ["coo_account", COO_ID],
    ["finance_owner", FIN_ID],
    ["hr_admins", [HR_ID]],
    ["tech_ops_manager", TECH_ID],
  ] as const)
    await setDecision({ key, status: "confirmed", value, access: ceo, actorLabel: "CEO" });
  if (headcount !== null)
    await setDecision({
      key: "company_headcount",
      status: "confirmed",
      value: headcount,
      access: ceo,
      actorLabel: "CEO",
    });
  const hr = await access(HR_ID);
  await svc.ensureLifecycleSetup(hr);
  return { ceo, hr, coo: await access(COO_ID), fin: await access(FIN_ID), admin };
}

async function publishAll(ceo: OpsAccess) {
  for (const phase of ["preboarding", "onboarding", "offboarding"] as LifecyclePhase[]) {
    const t = await svc.lifecycleTemplate(phase);
    const res = await requestPublish({
      templateId: t.template.id,
      versionId: t.latest!.id,
      access: ceo,
      actorLabel: "CEO",
    });
    expect(res.published).toBe(true);
  }
}

async function syntheticPerson(
  hr: OpsAccess,
  name = "Robin Synthetic",
  position = "Junior Designer",
) {
  const [entity] = await listEntities();
  return reg.savePerson({
    values: {
      full_name: name,
      personal_email: "robin.synthetic@example.com",
      entity_id: entity!.id,
      position,
      status: "pre_hire",
      start_date: "2030-01-14",
      manager_profile_id: MANAGER_ID,
      test_record: true,
    },
    access: hr,
    actorLabel: "HR",
  });
}

const caseInput = (personId: string, over: Partial<svc.CaseInput> = {}): svc.CaseInput => ({
  phase: "preboarding",
  personId,
  roles: ["design"],
  rolesConfirmed: true,
  exempt: false,
  supervisor: false,
  onGroupHealth: null,
  separation: null,
  dates: { offer_date: "2029-12-20", start_date: "2030-01-14" },
  hiringManagerProfileId: MANAGER_ID,
  ...over,
});

async function stepsOf(instanceId: string) {
  const s = await agentDb().select<StepRow>("ops_workflow_steps", {
    filters: [eq("instance_id", instanceId)],
  });
  return Object.fromEntries(s.map((x) => [x.step_key, x]));
}

async function approveStart(instanceId: string, by = COO_ID) {
  const inst = (await getInstanceDetail(instanceId)).instance;
  await decideApproval({
    id: inst.start_approval_id!,
    decision: "approved",
    userId: by,
    note: null,
  });
}

beforeEach(async () => {
  await setupAgentTestEnv();
  resetOpsOrgForTests();
  const store = getReportStore();
  const now = new Date().toISOString();
  for (const [id, full_name] of [
    [CEO_ID, "Casey CEO"],
    [COO_ID, "Morgan COO"],
    [FIN_ID, "Finley Finance"],
    [TECH_ID, "Taylor TechOps"],
    [MANAGER_ID, "Jamie Manager"],
  ] as const)
    await store.ensureProfile({ id, full_name, role: "user", created_at: now, updated_at: now });
  externalCalls = 0;
  setOpsFetcherForTests(async () => {
    externalCalls++;
    return new Response("{}", { status: 200 });
  });
});
afterEach(() => setOpsFetcherForTests(null));

// ---------------------------------------------------------------------------
describe("1. full import of the leadership document", () => {
  it("parses all seven parts and every checkbox, table row, and flag", async () => {
    const parsed = await parseChecklistDocx(readFileSync(FIXTURE));
    expect(parsed.title).toBe("Acton ADU Staff Lifecycle Checklist");
    expect(parsed.dateLine).toContain("Oct 28, 2026");
    expect(parsed.parts).toEqual([
      "How to use this checklist",
      "Part 1: Pre-boarding (offer accepted to Day 1)",
      "Part 2: Onboarding (Day 1 to 90)",
      "Part 3: Offboarding (notice to close)",
      "Recurring compliance calendar",
      "Flags",
    ]);
    // The seventh part (California compliance sources) is a section with its source table.
    expect(parsed.sections.some((s) => s.section === "California compliance sources")).toBe(true);
    expect(parsed.tables[0]!.rows).toHaveLength(6); // header + 5 sources
    expect(parsed.tables[1]!.rows).toHaveLength(8); // header + 7 recurring items
    expect(parsed.items).toHaveLength(105);
    expect(parsed.notes.filter((n) => n.part === "Flags")).toHaveLength(5);
    const rec = reconcile(parsed);
    expect(rec.matched).toHaveLength(105);
    expect(rec.changed).toEqual([]);
    expect(rec.added).toEqual([]);
    expect(rec.removed).toEqual([]);
    expect(rec.recurringChanged).toEqual([]);
    expect(rec.flagsChanged).toBe(false);
    expect(CHECKLIST_CATALOG.sources.map((s) => s.linkText)).toEqual(
      parsed.tables[0]!.rows.slice(1).map((r) => r[2]),
    );
  });

  it("imports into the Knowledge Hub with version metadata; a new version keeps history", async () => {
    const { hr, ceo } = await bootstrap();
    const buffer = readFileSync(FIXTURE);
    const first = await svc.importSourceDocument({
      buffer,
      filename: "checklist.docx",
      versionLabel: "2026-10-28",
      note: "Original",
      access: hr,
      actorLabel: "HR",
    });
    expect(first.source.status).toBe("current");
    expect(first.source.item_count).toBe(105);
    expect(first.draftsCreated).toEqual([]); // identical to the mapping
    const kb = await selectOne<{ id: string; title: string; version: number; category: string }>(
      "ai_knowledge_documents",
      { filters: [eq("id", first.source.knowledge_document_id!)] },
    );
    expect(kb!.title).toContain("version 2026-10-28");
    await expect(
      svc.importSourceDocument({
        buffer,
        filename: "again.docx",
        versionLabel: "x2",
        note: "",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/already imported/);

    // A running case pinned to v1 before the new version arrives.
    await publishAll(ceo);
    const person = await syntheticPerson(hr);
    const { instance } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    const before = await stepsOf(instance.id);

    // New version: one wording change, one new checkbox.
    const zip = await JSZip.loadAsync(buffer);
    let xml = await zip.file("word/document.xml")!.async("string");
    xml = xml.replace("Buddy or mentor assigned.", "Buddy and mentor assigned.");
    xml = xml.replace(
      "Lunch with manager or buddy.",
      'Lunch with manager or buddy.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>☐ Parking pass issued.',
    );
    zip.file("word/document.xml", xml);
    const v2 = await zip.generateAsync({ type: "nodebuffer" });
    const second = await svc.importSourceDocument({
      buffer: v2,
      filename: "checklist-v2.docx",
      versionLabel: "2026-11-15",
      note: "Edited",
      access: hr,
      actorLabel: "HR",
    });
    expect(second.reconciliation.changed.map((c) => c.itemId)).toEqual(["pre-buddy"]);
    expect(second.reconciliation.added.map((a) => a.text)).toEqual(["☐ Parking pass issued."]);
    expect(second.draftsCreated.sort()).toEqual(["onboarding", "preboarding"]);
    const sources = await svc.listSources();
    expect(sources.find((s) => s.version_label === "2026-10-28")!.status).toBe("superseded");
    const oldKb = await selectOne<{ status: string }>("ai_knowledge_documents", {
      filters: [eq("id", first.source.knowledge_document_id!)],
    });
    expect(oldKb!.status).toBe("archived"); // archived, not deleted
    // Drafts are not published; the running case keeps its version and wording.
    const pre = await svc.lifecycleTemplate("preboarding");
    expect(pre.latest!.status).toBe("draft");
    expect(pre.published!.version).toBe(1);
    const draftItem = itemsFromDefinition(pre.latest!.definition).find(
      (i) => i.id === "pre-buddy",
    )!;
    expect(draftItem.text).toBe("☐ Buddy and mentor assigned.");
    expect(draftItem.flags[0]).toContain('Previous wording: "☐ Buddy or mentor assigned."');
    const after = await stepsOf(instance.id);
    expect(after["pre-buddy"]!.config.lifecycle!.text).toBe(
      before["pre-buddy"]!.config.lifecycle!.text,
    );
    expect(after["pre-buddy"]!.config.lifecycle!.sourceRef.documentVersion).toBe("2026-10-28");
  });
});

// ---------------------------------------------------------------------------
describe("2. traceability", () => {
  it("maps every document checkbox to exactly one workflow step with the exact wording", async () => {
    const parsed = parseChecklistHtml(
      (await import("mammoth")).default
        ? (await (await import("mammoth")).default.convertToHtml({ buffer: readFileSync(FIXTURE) }))
            .value
        : "",
    );
    const steps = (["preboarding", "onboarding", "offboarding"] as const).flatMap(
      (p) => definitionFromCatalog(p).steps,
    );
    const docSteps = steps.filter((s) => s.lifecycle?.origin === "document");
    expect(docSteps).toHaveLength(parsed.items.length);
    for (const p of parsed.items) {
      const hits = docSteps.filter((s) => s.lifecycle!.text === p.text);
      expect(hits, p.text).toHaveLength(1);
      const ref = hits[0]!.lifecycle!.sourceRef;
      expect([ref.part, ref.section, ref.ordinal]).toEqual([p.part, p.section, p.ordinal]);
      expect(hits[0]!.description).toBe(p.text);
      expect(hits[0]!.checklist).toEqual(p.subItems);
    }
    // Tags come from the wording itself.
    const w4 = docSteps.find((s) => s.key === "pre-w4-de4")!.lifecycle!;
    expect(w4.tags).toEqual(["CA", "Fed"]);
    expect(w4.jurisdiction).toBe("California + Federal");
    // Only the offboarding authorization is system-added, and it says so.
    const system = steps.filter((s) => s.lifecycle?.origin === "system");
    expect(system.map((s) => s.key)).toEqual(["off-authorization"]);
    expect(system[0]!.lifecycle!.sourceRef.section).toMatch(/Added by Baxter/);
    for (const p of ["preboarding", "onboarding", "offboarding"] as const)
      expect(
        validateDefinition(definitionFromCatalog(p)).filter((i) => i.severity === "error"),
      ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("3. role-specific conditional tasks", () => {
  const pre = [...itemsForPhase("preboarding")];
  const ids = (p: ReturnType<typeof buildLifecyclePlan>) =>
    p.items.filter((i) => i.included).map((i) => i.itemId);

  it("adds each confirmed role's tasks once, and records why others were excluded", () => {
    const general = buildLifecyclePlan({
      phase: "preboarding",
      items: pre,
      profile: profile(),
      dates: {},
    });
    expect(ids(general)).not.toContain("pre-revit");
    expect(general.items.find((i) => i.itemId === "pre-revit")!.reasons.join(" ")).toMatch(
      /Not a Design role/,
    );
    const designer = buildLifecyclePlan({
      phase: "preboarding",
      items: pre,
      profile: profile({ roles: ["design"] }),
      dates: {},
    });
    expect(ids(designer)).toEqual(
      expect.arrayContaining([
        "pre-revit",
        "pre-bluebeam",
        "pre-design-drives",
        "pre-revit-laptop",
      ]),
    );
    expect(ids(designer)).not.toContain("pre-ghl-sales");
    const multi = buildLifecyclePlan({
      phase: "preboarding",
      items: pre,
      profile: profile({ roles: ["design", "sales", "marketing"] }),
      dates: {},
    });
    expect(ids(multi)).toEqual(
      expect.arrayContaining(["pre-revit", "pre-ghl-sales", "pre-ghl-marketing", "pre-webflow"]),
    );
    expect(new Set(ids(multi)).size).toBe(ids(multi).length);
    expect(multi.notes.join(" ")).toMatch(/Several roles confirmed/);
    const field = buildLifecyclePlan({
      phase: "onboarding",
      items: itemsForPhase("onboarding"),
      profile: profile({ roles: ["field"] }),
      dates: {},
    });
    expect(ids(field)).toContain("on-heat-illness");
  });

  it("never adds role tasks or privileged access from a job title alone", () => {
    expect(suggestRolesFromTitle("Marketing Manager").map((s) => s.role)).toEqual(["marketing"]);
    const unconfirmed = buildLifecyclePlan({
      phase: "preboarding",
      items: pre,
      profile: profile({ roles: ["marketing"], rolesConfirmed: false }),
      dates: {},
    });
    expect(ids(unconfirmed)).not.toContain("pre-ghl-marketing");
    expect(unconfirmed.items.find((i) => i.itemId === "pre-ghl-marketing")!.reasons[0]).toMatch(
      /job title alone never/,
    );
    expect(unconfirmed.missingInfo.join(" ")).toMatch(/Confirm the employee's roles/);
    // Confirmed marketing: privileged items still need a named approval.
    const confirmed = buildLifecyclePlan({
      phase: "preboarding",
      items: pre,
      profile: profile({ roles: ["marketing"] }),
      dates: {},
    });
    expect(confirmed.missingApprovals.join(" ")).toMatch(
      /GoHighLevel marketing permissions: any admin or owner-level role needs a named CEO\/COO approval/,
    );
    expect(isPrivilegedRole("gohighlevel", "Admin")).toBe(true);
    expect(isPrivilegedRole("google_analytics", "Analyst")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("4. dates", () => {
  it("computes calendar, business-day, month, and anchor-relative due dates", () => {
    expect(addBusinessDays("2030-01-18", 3)).toBe("2030-01-23"); // Fri → Wed (skips the weekend)
    expect(addMonths("2030-08-31", 6)).toBe("2031-02-28");
    const dates = { start_date: "2030-01-18", offer_date: "2030-01-02" };
    const plan = buildLifecyclePlan({
      phase: "onboarding",
      items: itemsForPhase("onboarding"),
      profile: profile(),
      dates,
    });
    const due = (id: string) => plan.items.find((i) => i.itemId === id)!.due;
    expect(due("on-i9-section2")).toBe("2030-01-23");
    expect(due("on-de34")).toBe("2030-02-07");
    expect(due("on-30-checkin")).toBe("2030-02-16"); // Day 30 = start + 29
    expect(due("on-90-review")).toBe("2030-04-17");
    expect(due("on-harassment-training")).toBe("2030-07-18");
    const prePlan = buildLifecyclePlan({
      phase: "preboarding",
      items: itemsForPhase("preboarding"),
      profile: profile(),
      dates,
    });
    expect(prePlan.items.find((i) => i.itemId === "pre-licensed-gate")!.due).toBe("2030-01-01");
  });

  it("applies the final-pay rule and never schedules offboarding before the notice date", () => {
    expect(
      finalPayDue("involuntary", { last_day: "2030-03-05", notice_date: "2030-03-05" }).due,
    ).toBe("2030-03-05");
    expect(finalPayDue("layoff", { last_day: "2030-03-05", notice_date: "2030-03-01" }).due).toBe(
      "2030-03-05",
    );
    expect(
      finalPayDue("resignation_with_notice", { last_day: "2030-03-15", notice_date: "2030-03-01" })
        .due,
    ).toBe("2030-03-15");
    expect(
      finalPayDue("resignation_without_notice", {
        last_day: "2030-03-05",
        notice_date: "2030-03-05",
      }).due,
    ).toBe("2030-03-08");
    expect(finalPayDue(null, { last_day: "2030-03-05" }).missing).toContain("Separation type");
    const r = dueDateFor(
      { kind: "days", anchor: "last_day", offset: -3 },
      { last_day: "2030-03-05", notice_date: "2030-03-05" },
      "involuntary",
    );
    expect(r.due).toBe("2030-03-05");
    expect(r.note).toMatch(/notice date/);
  });
});

// ---------------------------------------------------------------------------
describe("5. conditions", () => {
  it("applies exempt, headcount, group-health, and Cal-WARN conditions with reasons", () => {
    const on = itemsForPhase("onboarding");
    const exempt = buildLifecyclePlan({
      phase: "onboarding",
      items: on,
      profile: profile({ exempt: true }),
      dates: {},
    });
    const packet = exempt.items.find((i) => i.itemId === "on-pamphlets")!;
    expect(packet.subItems.find((s) => s.id === "wtpa")!.included).toBe(false);
    const small = buildLifecyclePlan({
      phase: "onboarding",
      items: on,
      profile: profile({ headcount: 4 }),
      dates: {},
    });
    expect(small.items.find((i) => i.itemId === "on-harassment-training")!.included).toBe(false);
    expect(
      small.items
        .find((i) => i.itemId === "on-pamphlets")!
        .subItems.find((s) => s.id === "pdl-cfra")!.included,
    ).toBe(false);
    // Unknown headcount never silently removes a legal item.
    const unknown = buildLifecyclePlan({
      phase: "onboarding",
      items: on,
      profile: profile({ headcount: null }),
      dates: {},
    });
    expect(unknown.items.find((i) => i.itemId === "on-harassment-training")!.included).toBe(true);
    expect(unknown.missingInfo.join(" ")).toMatch(/headcount is not confirmed/);
    const off = [OFFBOARDING_AUTHORIZATION, ...itemsForPhase("offboarding")];
    const offPlan = buildLifecyclePlan({
      phase: "offboarding",
      items: off,
      profile: profile({ headcount: 12, onGroupHealth: false, separation: "layoff" }),
      dates: { notice_date: "2030-03-01", last_day: "2030-03-01" },
    });
    expect(offPlan.items.find((i) => i.itemId === "off-cal-warn")!.included).toBe(false);
    const notices = offPlan.items.find((i) => i.itemId === "off-separation-notices")!;
    expect(notices.subItems.find((s) => s.id === "dhcs9061")!.included).toBe(false);
    expect(notices.flags[0]).toMatch(/Cal-COBRA/);
    expect(continuationCoverage(25).notice).toBe("COBRA");
    expect(continuationCoverage(null).notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("6. legal flags and the verification register", () => {
  it("flags legal items unverified until a named reviewer checks an official source", async () => {
    const { hr, ceo } = await bootstrap();
    const person = await syntheticPerson(hr);
    const preview = await svc.previewCase(caseInput(person.id, { phase: "onboarding" }), hr);
    const i9 = preview.plan.legalFlags.find((f) => f.itemId === "on-i9-section2")!;
    expect(i9.verification).toBe("unverified");
    expect(i9.citations).toEqual(["Form I-9 (USCIS) (Federal)"]);
    const row = (
      await agentDb().select<svc.VerificationRow>("ops_compliance_verifications", {
        filters: [eq("item_id", "on-i9-section2")],
      })
    )[0]!;
    await expect(
      svc.verifyRequirement({
        id: row.id,
        status: "verified",
        officialSourceUrl: "https://example.com/i9",
        officialSourceTitle: "Blog",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/official government source/);
    await svc.verifyRequirement({
      id: row.id,
      status: "verified",
      officialSourceUrl: "https://www.uscis.gov/i-9-central",
      officialSourceTitle: "USCIS I-9 Central",
      access: hr,
      actorLabel: "HR",
    });
    expect(
      (
        await svc.previewCase(caseInput(person.id, { phase: "onboarding" }), hr)
      ).plan.legalFlags.find((f) => f.itemId === "on-i9-section2")!.verification,
    ).toBe("verified");

    // A discrepancy is recorded next to the original wording, which never changes.
    const de34 = (
      await agentDb().select<svc.VerificationRow>("ops_compliance_verifications", {
        filters: [eq("item_id", "on-de34")],
      })
    )[0]!;
    await expect(
      svc.verifyRequirement({
        id: de34.id,
        status: "discrepancy",
        officialSourceUrl: "https://edd.ca.gov/x",
        officialSourceTitle: "EDD",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/Describe the discrepancy/);
    const flagged = await svc.verifyRequirement({
      id: de34.id,
      status: "discrepancy",
      officialSourceUrl: "https://edd.ca.gov/en/payroll_taxes/new_hire_reporting",
      officialSourceTitle: "EDD New Hire Reporting",
      discrepancy: "Synthetic test discrepancy",
      access: hr,
      actorLabel: "HR",
    });
    expect(flagged.original_text).toBe(de34.original_text);
    expect(flagged.reviewer_profile_id).toBe(HR_ID);

    // Editing a verified legal item sends publication through review and resets verification.
    await publishAll(ceo);
    await svc.saveItemEdits({
      phase: "onboarding",
      edits: [
        {
          itemId: "on-i9-section2",
          timing: { kind: "business_days", anchor: "start_date", offset: 4 },
        },
      ],
      changeSummary: "Synthetic edit",
      access: hr,
      actorLabel: "HR",
    });
    const t = await svc.lifecycleTemplate("onboarding");
    const res = await requestPublish({
      templateId: t.template.id,
      versionId: t.latest!.id,
      access: ceo,
      actorLabel: "CEO",
    });
    expect(res.published).toBe(false); // even leadership goes through the recorded review
    const act = await selectOne<{ approval_request_id: string }>("ops_actions", {
      filters: [eq("id", res.actionId!)],
    });
    await decideApproval({
      id: act!.approval_request_id,
      decision: "approved",
      userId: COO_ID,
      note: null,
    });
    const i9Rows = await agentDb().select<svc.VerificationRow>("ops_compliance_verifications", {
      filters: [eq("item_id", "on-i9-section2")],
    });
    expect(i9Rows[0]!.status).toBe("unverified");
    expect(i9Rows[0]!.history.at(-1)!.note).toMatch(/re-verify/);
  });

  it("lists compliance changes only for legal items", () => {
    const def = definitionFromCatalog("preboarding");
    const edited = applyItemEdits(def, [{ itemId: "pre-buddy", title: "Pair a buddy" }]);
    expect(complianceChanges(def, edited)).toEqual([]);
    const legal = applyItemEdits(def, [{ itemId: "pre-i9-section1", owner: "hiring_manager" }]);
    expect(complianceChanges(def, legal)[0]).toMatch(/I-9 Section 1.*owner/);
  });
});

// ---------------------------------------------------------------------------
describe("7. Baxter delegation is registry-driven", () => {
  it("routes lifecycle requests to Sam from Sam's configured keywords and examples", async () => {
    const { scoreSpecialist, RULES_DELEGATE_THRESHOLD } = await import("@/lib/agents/router");
    const { listResolvedAgents } = await import("@/lib/agents/registry");
    const agents = await listResolvedAgents({ fresh: true });
    const sam = agents.find((a) => a.row.slug === "sam")!;
    const dexter = agents.find((a) => a.row.slug === "dexter");
    expect(sam.config.tools.enabled).toEqual(
      expect.arrayContaining(["lifecycle_checklist", "lifecycle_plan_preview", "lifecycle_cases"]),
    );
    for (const q of [
      "What does pre-boarding involve for a new designer?",
      "What do we owe someone who resigns without notice for final pay?",
      "When is the DE 34 due for our new hire?",
      "Which accounts do we remove when a marketing person leaves? Use the offboarding checklist.",
    ]) {
      const s = scoreSpecialist(q, sam);
      expect(s.score, q).toBeGreaterThanOrEqual(RULES_DELEGATE_THRESHOLD);
      if (dexter) expect(scoreSpecialist(q, dexter).score, q).toBeLessThan(s.score);
    }
    // Routing follows configuration: without the lifecycle keywords and examples the score drops.
    const stripped = {
      ...sam,
      config: {
        ...sam.config,
        delegation: { ...sam.config.delegation, keywords: [], positiveExamples: [] },
      },
    };
    expect(scoreSpecialist("When is the DE 34 due for our new hire?", stripped).score).toBeLessThan(
      RULES_DELEGATE_THRESHOLD,
    );
    // Sam's instructions say she coordinates and never decides, with the task statuses.
    expect(sam.config.instructions.rules).toMatch(/you coordinate; people decide/);
    expect(sam.config.instructions.rules).toMatch(/external verification/);
  });
});

// ---------------------------------------------------------------------------
describe("8. authorization", () => {
  it("lets only HR and leadership see or start cases, and every start needs CEO/COO approval", async () => {
    const { hr, admin, ceo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr);
    const employee = await access(EMPLOYEE_ID);
    await expect(svc.previewCase(caseInput(person.id), employee)).rejects.toThrow(/own HR records/);
    await expect(svc.previewCase(caseInput(person.id), admin)).rejects.toThrow(/own HR records/); // app admins configure but don't see HR records
    await expect(
      svc.startCase({
        case: caseInput(person.id),
        mode: "live",
        reason: "Offer accepted",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/Synthetic \(test\) employee records/);
    const { instance } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    expect(instance.status).toBe("pending_approval");
    expect(instance.subject_label).toMatch(/^Pre-boarding case LC-[0-9A-F]{6}$/);
    await expect(
      decideApproval({
        id: instance.start_approval_id!,
        decision: "approved",
        userId: HR_ID,
        note: null,
      }),
    ).rejects.toThrow();
    const s = await stepsOf(instance.id);
    await expect(
      svc.changeTaskStatus({
        stepId: s["pre-buddy"]!.id,
        transition: "complete",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/waiting for CEO\/COO approval/);
    await approveStart(instance.id);
    expect((await getInstanceDetail(instance.id)).instance.status).toBe("active");
    expect((await svc.listCases(employee)).length).toBe(0);
    await expect(svc.caseDetail(instance.id, employee)).rejects.toThrow(/assigned to you/);
    // Access register: only the COO/CEO record grants; privileged needs a leader as approver.
    await expect(
      svc.recordGrant({
        personId: person.id,
        platform: "gohighlevel",
        role: "Admin",
        grantedOn: "2030-01-10",
        approverProfileId: HR_ID,
        approvalNote: "x",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/Only the COO/);
    const coo = await access(COO_ID);
    await expect(
      svc.recordGrant({
        personId: person.id,
        platform: "gohighlevel",
        role: "Admin",
        grantedOn: "2030-01-10",
        approverProfileId: MANAGER_ID,
        approvalNote: "Hiring manager says so",
        access: coo,
        actorLabel: "COO",
      }),
    ).rejects.toThrow(/privileged.*CEO or COO/);
    const g = await svc.recordGrant({
      personId: person.id,
      platform: "gohighlevel",
      role: "Admin",
      grantedOn: "2030-01-10",
      approverProfileId: CEO_ID,
      approvalNote: "Second marketing admin approved (synthetic)",
      access: coo,
      actorLabel: "COO",
    });
    expect(g.privileged).toBe(true);
    await expect(
      svc.savePlatform({
        key: "webflow",
        seatsTotal: 3,
        seatsUsed: 2,
        seatCost: "$1/seat",
        seatCostSource: null,
        ownerProfileId: null,
        notes: "",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/never estimates prices/);
  });
});

// ---------------------------------------------------------------------------
describe("9. status integrity", () => {
  it("enforces allowed transitions and derives the seven display statuses", async () => {
    expect(canTransition("blocked", "complete")).toBe(false);
    expect(canTransition("awaiting_approval", "complete")).toBe(false);
    expect(canTransition("completed", "mark_not_applicable")).toBe(false);
    expect(displayStatus({ status: "ready", due_at: "2020-01-01T17:00:00Z" }, "2026-10-29")).toBe(
      "overdue",
    );
    expect(displayStatus({ status: "ready", due_at: "2030-01-01T17:00:00Z" }, "2026-10-29")).toBe(
      "awaiting_action",
    );
    expect(displayStatus({ status: "not_applicable", due_at: null }, "2026-10-29")).toBe(
      "not_applicable",
    );
    expect(displayStatus({ status: "external_verification", due_at: null }, "2026-10-29")).toBe(
      "external_verification",
    );

    const { hr, ceo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr);
    const { instance } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    await approveStart(instance.id);
    let s = await stepsOf(instance.id);
    expect(s["pre-offer-letter"]!.status).toBe("blocked"); // waits for the licensed software gate
    await expect(
      svc.changeTaskStatus({
        stepId: s["pre-offer-letter"]!.id,
        transition: "complete",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/blocked by an earlier task/);
    await expect(
      svc.changeTaskStatus({
        stepId: s["pre-buddy"]!.id,
        transition: "mark_not_applicable",
        note: "",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/Explain why/);
    await expect(
      svc.changeTaskStatus({
        stepId: s["pre-i9-section1"]!.id,
        transition: "mark_not_applicable",
        note: "Not needed (synthetic)",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/Legal .* CEO or COO/);
    // Legal items need evidence; external verification needs a confirmation with evidence.
    await expect(
      svc.changeTaskStatus({
        stepId: s["pre-i9-section1"]!.id,
        transition: "complete",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/evidence/);
    await svc.changeTaskStatus({
      stepId: s["pre-i9-section1"]!.id,
      transition: "send_to_external_verification",
      note: "Synthetic: Section 1 in the I-9 system",
      access: hr,
      actorLabel: "HR",
    });
    s = await stepsOf(instance.id);
    expect(s["pre-i9-section1"]!.status).toBe("external_verification");
    await svc.changeTaskStatus({
      stepId: s["pre-i9-section1"]!.id,
      transition: "confirm_external_verification",
      note: "Checked in the I-9 system (synthetic)",
      access: hr,
      actorLabel: "HR",
    });
    await svc.changeTaskStatus({
      stepId: s["pre-buddy"]!.id,
      transition: "mark_not_applicable",
      note: "Team of one (synthetic)",
      access: hr,
      actorLabel: "HR",
    });
    s = await stepsOf(instance.id);
    expect(s["pre-i9-section1"]!.status).toBe("completed");
    expect(s["pre-buddy"]!.status).toBe("not_applicable");
    await svc.changeTaskStatus({
      stepId: s["pre-buddy"]!.id,
      transition: "reopen",
      note: "Buddy available after all",
      access: hr,
      actorLabel: "HR",
    });
    s = await stepsOf(instance.id);
    expect(s["pre-buddy"]!.status).toBe("ready");
    const detail = await svc.caseDetail(instance.id, hr);
    const i9 = detail.tasks.find((t) => t.itemId === "pre-i9-section1")!;
    expect(i9.history.map((h) => h.event)).toEqual(
      expect.arrayContaining([
        "created",
        "external_verification_requested",
        "external_verification_confirmed",
      ]),
    );
    expect(detail.tasks.find((t) => t.itemId === "pre-revit")!.display).not.toBe("not_applicable");
    expect(detail.tasks.find((t) => t.itemId === "pre-ghl-sales")!.display).toBe("not_applicable");
    expect(
      detail.tasks.find((t) => t.itemId === "pre-ghl-sales")!.inclusionReasons.join(" "),
    ).toMatch(/Not a Sales role/);
  });
});

// ---------------------------------------------------------------------------
describe("10. offboarding approvals", () => {
  it("requires explicit leadership authorization before anything else, and never acts on accounts or pay", async () => {
    const { hr, ceo, coo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr, "Sky Synthetic", "Marketing Coordinator");
    const off = caseInput(person.id, {
      phase: "offboarding",
      roles: ["marketing"],
      separation: "involuntary",
      onGroupHealth: true,
      dates: { notice_date: "2030-03-05", last_day: "2030-03-05" },
    });
    await expect(
      svc.startCase({ case: off, mode: "test", reason: "short", access: hr, actorLabel: "HR" }),
    ).rejects.toThrow(/written reason/);
    const { instance, plan } = await svc.startCase({
      case: off,
      mode: "test",
      reason: "Synthetic involuntary separation for testing",
      access: hr,
      actorLabel: "HR",
    });
    expect(plan.missingApprovals).toContain(
      "CEO or COO authorization of the separation (first task)",
    );
    expect(plan.items.find((i) => i.itemId === "off-final-pay")!.due).toBe("2030-03-05");
    await approveStart(instance.id);
    let s = await stepsOf(instance.id);
    expect(s["off-authorization"]!.status).toBe("awaiting_approval");
    const blocked = Object.values(s).filter(
      (x) => x.step_key !== "off-authorization" && x.status !== "not_applicable",
    );
    expect(blocked.every((x) => x.status === "blocked")).toBe(true);
    const authAction = await selectOne<{ approval_request_id: string; action_type: string }>(
      "ops_actions",
      {
        filters: [eq("id", String(s["off-authorization"]!.data.actionId))],
      },
    );
    expect(authAction!.action_type).toBe("approve_step");
    await expect(
      decideApproval({
        id: authAction!.approval_request_id,
        decision: "approved",
        userId: HR_ID,
        note: null,
      }),
    ).rejects.toThrow();
    await decideApproval({
      id: authAction!.approval_request_id,
      decision: "approved",
      userId: CEO_ID,
      note: null,
    });
    s = await stepsOf(instance.id);
    expect(s["off-authorization"]!.status).toBe("completed");
    expect(s["off-slack"]!.status).toBe("ready");
    expect(s["off-slack"]!.assignee_profile_id).toBe(COO_ID);
    expect(s["off-final-pay"]!.assignee_profile_id).toBe(FIN_ID);
    await expect(
      svc.changeTaskStatus({
        stepId: s["off-slack"]!.id,
        transition: "complete",
        note: "done",
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/COO/);
    await svc.changeTaskStatus({
      stepId: s["off-slack"]!.id,
      transition: "complete",
      note: "Deactivated in Slack admin (synthetic)",
      access: coo,
      actorLabel: "COO",
    });
    // Nothing deactivated, paid, or sent by the system: only start/approval actions exist.
    const actions = await agentDb().select<{ action_type: string }>("ops_actions", {
      filters: [eq("instance_id", instance.id)],
    });
    expect(new Set(actions.map((a) => a.action_type))).toEqual(
      new Set(["start_workflow", "approve_step"]),
    );
    expect(externalCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("11. reminders are scheduled and never duplicated", () => {
  it("raises each in-app reminder once; external notifications stay off until enabled, then need approval", async () => {
    expect(reminderThresholds("2030-01-10", "2030-01-09", 2).map((t) => t.key)).toEqual([
      "due-soon",
    ]);
    expect(reminderThresholds("2030-01-01", "2030-01-09", 2).map((t) => t.key)).toEqual([
      "overdue-1",
      "overdue-7",
    ]);
    expect(
      occurrencesFor({ cadence: { kind: "twice_yearly" }, verified_dates: [] }, "2030-05-01")[0]!
        .due,
    ).toBeNull();
    expect(
      occurrencesFor({ cadence: { kind: "quarterly" }, verified_dates: [] }, "2030-05-01")[0],
    ).toEqual({ periodKey: "2030-Q2", due: "2030-06-30" });

    const { hr, ceo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr);
    const { instance } = await svc.startCase({
      case: caseInput(person.id, { dates: { offer_date: "2026-09-01", start_date: "2026-10-01" } }),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    await approveStart(instance.id);
    const now = new Date("2026-10-29T12:00:00Z");
    const first = await sweepLifecycle(now);
    expect(first.lifecycleReminders).toBeGreaterThan(0);
    expect(first.lifecycleExternalProposed).toBe(0);
    const count = (await agentDb().select("ops_reminders", {})).length;
    const second = await sweepLifecycle(now);
    expect(second.lifecycleReminders).toBe(0);
    expect((await agentDb().select("ops_reminders", {})).length).toBe(count);
    const reminders = await agentDb().select<{ message: string }>("ops_reminders", {});
    expect(reminders.every((r) => !r.message.includes("Robin"))).toBe(true);
    expect(
      await agentDb().select("ops_actions", { filters: [eq("action_type", "notify_slack")] }),
    ).toEqual([]);

    // Only leadership can switch external reminders on; even then each is an approval request.
    await expect(
      svc.saveLifecycleSettings({
        leadDays: 2,
        externalEnabled: true,
        access: hr,
        actorLabel: "HR",
      }),
    ).rejects.toThrow(/CEO or COO/);
    await svc.saveLifecycleSettings({
      leadDays: 2,
      externalEnabled: true,
      access: ceo,
      actorLabel: "CEO",
    });
    // A new threshold (the Q4 access-register audit comes within 30 days) after enabling.
    const later = await sweepLifecycle(new Date("2026-12-05T12:00:00Z"));
    expect(later.lifecycleReminders).toBeGreaterThan(0);
    const slack = await agentDb().select<{ status: string }>("ops_actions", {
      filters: [eq("action_type", "notify_slack")],
    });
    expect(slack.length).toBeGreaterThan(0);
    expect(slack.every((a) => a.status === "pending_approval")).toBe(true);
    const again = await sweepLifecycle(new Date("2026-12-05T12:00:00Z"));
    expect(again.lifecycleExternalProposed).toBe(0);
    expect(externalCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("12. template edits never change existing cases", () => {
  it("pins running cases to their version; new cases follow the published edit", async () => {
    const { hr, ceo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr);
    const { instance: oldCase } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    const before = await stepsOf(oldCase.id);
    await svc.saveItemEdits({
      phase: "preboarding",
      edits: [
        {
          itemId: "pre-buddy",
          title: "Assign a buddy (edited)",
          owner: "hr_admin",
          timing: { kind: "days", anchor: "start_date", offset: -10 },
          position: 0,
        },
      ],
      changeSummary: "Synthetic edit",
      access: hr,
      actorLabel: "HR",
    });
    const t = await svc.lifecycleTemplate("preboarding");
    expect(t.latest!.version).toBe(2);
    expect(t.latest!.definition.steps[0]!.key).toBe("pre-buddy");
    await requestPublish({
      templateId: t.template.id,
      versionId: t.latest!.id,
      access: ceo,
      actorLabel: "CEO",
    });
    const after = await stepsOf(oldCase.id);
    expect(after["pre-buddy"]!.title).toBe(before["pre-buddy"]!.title);
    expect(after["pre-buddy"]!.due_at).toBe(before["pre-buddy"]!.due_at);
    expect(after["pre-buddy"]!.assignee_role).toBe("hiring_manager");
    const { instance: newCase } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    const fresh = await stepsOf(newCase.id);
    expect(fresh["pre-buddy"]!.title).toBe("Assign a buddy (edited)");
    expect(fresh["pre-buddy"]!.due_at!.slice(0, 10)).toBe("2030-01-04");
    // Communication template edits don't rewrite existing drafts either.
    const draftBefore = (await stepsOf(oldCase.id))["pre-welcome-email"]!.data.draft as {
      body: string;
    };
    await svc.saveCommTemplate({
      key: "welcome_email",
      name: "Welcome email",
      channel: "email",
      subject: "Hi",
      body: "Changed body {{first_name}}",
      changeSummary: "Synthetic",
      access: hr,
      actorLabel: "HR",
    });
    expect(
      ((await stepsOf(oldCase.id))["pre-welcome-email"]!.data.draft as { body: string }).body,
    ).toBe(draftBefore.body);
    const rolled = await svc.rollbackCommTemplate({
      key: "welcome_email",
      version: 1,
      access: hr,
      actorLabel: "HR",
    });
    expect(rolled.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe("13. citations", () => {
  it("Sam's checklist tool quotes the wording with part, section, item number, and version", async () => {
    await bootstrap();
    const { LIFECYCLE_TOOLS } = await import("@/lib/agents/lifecycle-tools");
    const tool = LIFECYCLE_TOOLS.find((t) => t.key === "lifecycle_checklist")!;
    const ctx = { requester: req(HR_ID) } as Parameters<typeof tool.execute>[0];
    const out = await tool.execute(ctx, { phase: "onboarding", query: "DE 34" });
    const data = out.data as { document: string; items: Array<Record<string, unknown>> };
    expect(data.document).toBe("Acton ADU Staff Lifecycle Checklist, version 2026-10-28");
    expect(data.items[0]).toMatchObject({
      wording:
        "☐ [CA] File the DE 34 new employee report with EDD within 20 days of the start date.",
      part: "Part 2: Onboarding (Day 1 to 90)",
      section: "Within 20 days",
      itemNumber: 1,
      citations: ["DE 34 (EDD)"],
      verification: "unverified",
    });
    const rec = await tool.execute(ctx, { phase: "recurring", query: "Know Your Rights" });
    expect((rec.data as { items: Array<{ requirement: string }> }).items[0]!.requirement).toBe(
      "[CA] SB 294",
    );
  });
});

// ---------------------------------------------------------------------------
describe("14. missing information", () => {
  it("lists missing dates, facts, owners, seats, approvals, and draft merge fields", async () => {
    const { hr } = await bootstrap(null);
    const person = await syntheticPerson(hr);
    const { plan, published } = await svc.previewCase(
      caseInput(person.id, { exempt: null, supervisor: null, dates: {}, rolesConfirmed: true }),
      hr,
    );
    expect(published).toBe(false);
    expect(plan.missingApprovals[0]).toMatch(/Publish the Pre-boarding template/);
    expect(plan.missingInfo).toEqual(
      expect.arrayContaining([
        "Offer date",
        "Start date",
        "Exempt or non-exempt status",
        "Company headcount (thresholds at 5, 20, and 75 employees)",
        "Autodesk Revit seat cost (record the actual cost; Baxter never assumes prices)",
      ]),
    );
    expect(plan.licenseNeeds.map((l) => l.label)).toEqual(
      expect.arrayContaining(["JobTread", "Autodesk Revit", "Bluebeam Revu"]),
    );
    expect(plan.licenseNeeds.every((l) => l.seatsAvailable === null)).toBe(true);
    const welcome = plan.drafts.find((d) => d.key === "welcome_email")!;
    expect(welcome.subject).toBe("Welcome to Acton ADU, Robin");
    expect(welcome.missing).toEqual(
      expect.arrayContaining(["day1_time", "work_location", "start_date"]),
    );
  });
});

// ---------------------------------------------------------------------------
describe("15. regressions and privacy", () => {
  it("keeps ordinary Sam Operations workflows valid and keeps names out of logs and tools", async () => {
    for (const s of STARTER_WORKFLOWS) {
      const def = workflowDefinitionSchema.parse(s.definition);
      expect(def.lifecycle).toBeNull();
      expect(def.steps.every((x) => x.lifecycle === null)).toBe(true);
    }
    const { hr, ceo } = await bootstrap();
    await publishAll(ceo);
    const person = await syntheticPerson(hr, "Quinn Privacy-Test");
    const { instance } = await svc.startCase({
      case: caseInput(person.id),
      mode: "test",
      reason: "",
      access: hr,
      actorLabel: "HR",
    });
    await approveStart(instance.id);
    const audit = await agentDb().select<{ summary: string }>("ai_audit_log", {});
    expect(audit.some((a) => a.summary.includes("Quinn"))).toBe(false);
    const actions = await agentDb().select<{ title: string; summary: string }>("ops_actions", {});
    expect(actions.some((a) => `${a.title} ${a.summary}`.includes("Quinn"))).toBe(false);
    const summary = (await getInstanceDetail(instance.id)).instance as unknown as {
      lifecycle: object;
    };
    expect(JSON.stringify(summary.lifecycle)).not.toContain("Quinn");
    const { LIFECYCLE_TOOLS } = await import("@/lib/agents/lifecycle-tools");
    const cases = LIFECYCLE_TOOLS.find((t) => t.key === "lifecycle_cases")!;
    const ctx = { requester: req(HR_ID) } as Parameters<typeof cases.execute>[0];
    const list = await cases.execute(ctx, {});
    expect(JSON.stringify(list)).not.toContain("Quinn");
    const ref = (list.data as { cases: Array<{ reference: string }> }).cases[0]!.reference;
    const one = await cases.execute(ctx, { reference: ref });
    expect(JSON.stringify(one)).not.toContain("Quinn");
    expect(one.logSummary).toBe(`Read lifecycle case ${ref}.`);
    // HR sees the name in the dashboard (server-side, permission-checked).
    expect((await svc.caseDetail(instance.id, hr)).case.person!.name).toBe("Quinn Privacy-Test");
  });
});

// ---------------------------------------------------------------------------
describe("document-to-workflow mapping doc", () => {
  it("docs/hr-lifecycle/mapping.md matches the catalog", async () => {
    const { mappingMarkdown } = await import("@/lib/hr-lifecycle/mapping");
    const { existsSync, writeFileSync, mkdirSync } = await import("node:fs");
    const path = "docs/hr-lifecycle/mapping.md";
    // Compare in the repository's Prettier format (the file is formatted like every other doc).
    const prettier = await import("prettier");
    const md = await prettier.format(mappingMarkdown(), {
      ...((await prettier.resolveConfig(path)) ?? {}),
      parser: "markdown",
    });
    if (process.env.UPDATE_LIFECYCLE_MAPPING === "1") {
      mkdirSync("docs/hr-lifecycle", { recursive: true });
      writeFileSync(path, md);
    }
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(md);
  });
});
