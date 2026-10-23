/**
 * Report groups, smart suggestions, preferences, and Dexter's organization tools
 * (in-memory store, synthetic JobTread fixture — nothing external).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTool } from "@/lib/agents/tools";
import type { Requester } from "@/lib/agents/types";
import { clearJobDetailCache } from "@/lib/jobtread/detail";
import { runFullSync } from "@/lib/jobtread/sync";
import { getReportsAccess } from "@/lib/reports/access";
import { invalidateFieldCatalog } from "@/lib/reports/fields";
import { GALLERY_TEMPLATE_KEYS, galleryTemplates } from "@/lib/reports/gallery";
import {
  assignReportToGroup,
  createGroup,
  deleteGroup,
  listGroupsFor,
  removeReportFromGroup,
  setGroupArchived,
  updateGroup,
} from "@/lib/reports/groups";
import { getReportPrefs, setReportPrefs } from "@/lib/reports/prefs";
import {
  addShare,
  createReport,
  deleteReport,
  duplicateReport,
  ensureReportTemplates,
  listReportsFor,
  resetReportTemplatesForTests,
  saveReportVersion,
  updateReportMeta,
} from "@/lib/reports/repo";
import {
  dismissSuggestion,
  linkNewReportToSuggestion,
  markSuggestionStarted,
  resetSuggestionCacheForTests,
  suggestionStates,
  visibleSuggestions,
} from "@/lib/reports/smart-suggestions";
import { reportCoversSuggestion, specMatchesSuggestion } from "@/lib/reports/suggestion-match";
import { reportSpecSchema } from "@/lib/reports/spec";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";
import { agentDb, eq } from "@/lib/agents/store";
import { ADMIN_ID, EMPLOYEE_ID, HR_ID, requester, setupAgentTestEnv } from "./agents-test-helpers";
import { installFakePave, uninstallFakePave } from "./jobtread-fixtures";

const admin = requester(ADMIN_ID, "admin", "Avery Admin");
const employee = requester(EMPLOYEE_ID, "user", "Eli Employee");
const coworker = requester(HR_ID, "user", "Harper HR");

const spec = (title: string, extra: Record<string, unknown> = {}) =>
  reportSpecSchema.parse({
    title,
    datasets: [{ id: "jobs", source: "jobs" }],
    widgets: [
      {
        id: "w",
        type: "chart",
        dataset: "jobs",
        chart: "bar",
        groupBy: "sem:phase",
        title: "By phase",
      },
    ],
    ...extra,
  });
const pmWorkload = (title: string) =>
  reportSpecSchema.parse({
    title,
    datasets: [{ id: "jobs", source: "jobs" }],
    widgets: [
      {
        id: "pm",
        type: "chart",
        dataset: "jobs",
        chart: "bar",
        groupBy: "sem:project_manager",
        seriesBy: "sem:phase",
        title: "Load",
      },
    ],
  });

async function c(r: Requester) {
  return { requester: r, access: await getReportsAccess(r), actorLabel: r.label };
}
const toolCtx = async (r: Requester, taskId = "00000000-0000-4000-8000-0000000000f1") => ({
  task: { id: taskId, allowed_context: {} } as never,
  agent: {} as never,
  requester: r,
  access: new Set<never>(),
});

beforeEach(async () => {
  await setupAgentTestEnv();
  resetReportTemplatesForTests();
  resetSuggestionCacheForTests();
  clearJobDetailCache();
  invalidateFieldCatalog();
  installFakePave();
  await runFullSync("test");
  invalidateFieldCatalog();
});
afterEach(() => uninstallFakePave());

describe("template gallery", () => {
  it("shows exactly Active Projects, Design Handoff, Product Library, Blank — and keeps Sales Commissions available", async () => {
    await ensureReportTemplates();
    const all = (await listReportsFor(employee, await getReportsAccess(employee))).map(
      ({ report }) => ({
        ...report,
        templateKey: report.template_key,
        isTemplate: report.is_template,
      }),
    );
    const gallery = galleryTemplates(all);
    expect(GALLERY_TEMPLATE_KEYS).toEqual([
      "active_projects",
      "design_handoff",
      "product_library",
      "blank",
    ]);
    expect(gallery.map((t) => t.templateKey)).toEqual([
      "active_projects",
      "design_handoff",
      "product_library",
      "blank",
    ]);
    expect(gallery.some((t) => t.templateKey === "sales_commissions")).toBe(false);
    // Not deleted: still a template report and still a known template.
    expect(all.find((r) => r.templateKey === "sales_commissions")).toBeTruthy();
    expect(REPORT_TEMPLATES.map((t) => t.key)).toContain("sales_commissions");
  });
});

describe("report groups", () => {
  it("creates, renames, files, moves, removes, archives, and deletes groups", async () => {
    const e = await c(employee);
    const r1 = await createReport({
      spec: spec("Commission check"),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    const sales = await createGroup({ ...e, name: "Sales" });
    const ops = await createGroup({ ...e, name: "Operations", color: "teal", icon: "hammer" });
    await expect(createGroup({ ...e, name: "sales" })).rejects.toThrow(/already have a group/);

    await assignReportToGroup({ ...e, reportId: r1.id, groupId: sales.id });
    let view = await listGroupsFor(e);
    expect(view.groups.find((g) => g.id === sales.id)!.reportCount).toBe(1);
    expect(view.membership.get(r1.id)).toEqual([sales.id]);

    const move = await assignReportToGroup({ ...e, reportId: r1.id, groupId: ops.id });
    expect(move).toEqual({ moved: true, from: "Sales" });
    view = await listGroupsFor(e);
    expect(view.membership.get(r1.id)).toEqual([ops.id]); // one personal group at a time

    await updateGroup({ ...e, groupId: ops.id, patch: { name: "Ops & PM" } });
    expect((await listGroupsFor(e)).groups.find((g) => g.id === ops.id)!.name).toBe("Ops & PM");

    await expect(setGroupArchived({ ...e, groupId: ops.id, archived: true })).rejects.toThrow(
      /still has reports/,
    );
    await expect(deleteGroup({ ...e, groupId: ops.id })).rejects.toThrow(/isn't empty/);
    await removeReportFromGroup({ ...e, reportId: r1.id, groupId: ops.id });
    await setGroupArchived({ ...e, groupId: ops.id, archived: true });
    expect((await listGroupsFor(e)).groups.map((g) => g.id)).not.toContain(ops.id);
    await deleteGroup({ ...e, groupId: sales.id });
    expect((await listGroupsFor(e)).groups).toHaveLength(0);
    const audit = await agentDb().select<{ action: string }>("ai_audit_log", {});
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "reports.group_created",
        "reports.report_grouped",
        "reports.group_deleted",
      ]),
    );
  });

  it("keeps groups private, never grants report access, and hides other people's restricted reports", async () => {
    const e = await c(employee);
    const h = await c(coworker);
    const privateReport = await createReport({
      spec: spec("Secret margins"),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    const mine = await createGroup({ ...e, name: "Finance" });
    await assignReportToGroup({ ...e, reportId: privateReport.id, groupId: mine.id });
    // Someone else can't see, use, or file into another person's personal group.
    expect((await listGroupsFor(h)).groups).toHaveLength(0);
    await expect(
      assignReportToGroup({ ...h, reportId: privateReport.id, groupId: mine.id }),
    ).rejects.toThrow(/not found/i);
    await expect(updateGroup({ ...h, groupId: mine.id, patch: { name: "x" } })).rejects.toThrow(
      /not found/i,
    );

    // Company groups: names are visible to all, but counts only include reports you can open.
    await expect(createGroup({ ...e, name: "Company", scope: "company" })).rejects.toThrow(
      /Only Reports managers/,
    );
    const a = await c(admin);
    const company = await createGroup({ ...a, name: "Executive Dashboards", scope: "company" });
    const adminPrivate = await createReport({
      spec: spec("Board pack"),
      ownerId: ADMIN_ID,
      authorKind: "user",
    });
    await assignReportToGroup({ ...a, reportId: adminPrivate.id, groupId: company.id });
    const seenByEmployee = (await listGroupsFor(e)).groups.find((g) => g.id === company.id)!;
    expect(seenByEmployee.reportCount).toBe(0); // the private report's existence isn't disclosed
    expect(seenByEmployee.canManage).toBe(false);
    // Filing my own report in the company group doesn't share it with anyone.
    await assignReportToGroup({ ...e, reportId: privateReport.id, groupId: company.id });
    expect(
      (await listReportsFor(coworker, h.access)).some((x) => x.report.id === privateReport.id),
    ).toBe(false);
    // A view-only shared report can't go into a company group, but can go into a personal one.
    await addShare({
      report_id: adminPrivate.id,
      principal_type: "user",
      principal_value: EMPLOYEE_ID,
      permission: "view",
      created_by: ADMIN_ID,
    });
    await expect(
      assignReportToGroup({ ...e, reportId: adminPrivate.id, groupId: company.id }),
    ).rejects.toThrow(/view .* but not edit/);
    await assignReportToGroup({ ...e, reportId: adminPrivate.id, groupId: mine.id });
  });

  it("keeps group filing when the report is edited, renamed, or gets a new version", async () => {
    const e = await c(employee);
    const r = await createReport({
      spec: spec("Pipeline"),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    const g = await createGroup({ ...e, name: "Permitting" });
    await assignReportToGroup({ ...e, reportId: r.id, groupId: g.id });
    await saveReportVersion({
      report: r,
      spec: { ...r.spec, title: "Permit pipeline" },
      authorId: EMPLOYEE_ID,
      authorKind: "dexter",
      summary: "Renamed",
    });
    expect((await listGroupsFor(e)).membership.get(r.id)).toEqual([g.id]);
  });
});

describe("smart suggestions", () => {
  it("matches equivalent reports by what they analyse, not by name", () => {
    expect(specMatchesSuggestion(pmWorkload("PM Workload Dashboard"), "pm_workload")).toBe(true);
    expect(specMatchesSuggestion(spec("Project Manager Workload"), "pm_workload")).toBe(false); // name only
    expect(
      reportCoversSuggestion(
        { spec: spec("x"), origin_template_key: "active_projects" },
        { key: "active_portfolio", templateKey: "active_projects" },
      ),
    ).toBe(true);
    expect(
      reportCoversSuggestion(
        { spec: spec("x"), origin_suggestion_key: "field_explorer" },
        { key: "field_explorer" },
      ),
    ).toBe(true);
    expect(specMatchesSuggestion(spec("Custom field explorer"), "field_explorer")).toBe(false);
  });

  it("shows only feasible suggestions, hides built ones, and brings them back when the report goes away", async () => {
    const access = await getReportsAccess(employee);
    const all = await suggestionStates(employee, access);
    const visible = await visibleSuggestions(employee, access);
    expect(visible.every((s) => s.status === "ready" || s.status === "ready_with_gaps")).toBe(true);
    expect(visible.every((s) => !s.templateKey)).toBe(true);
    expect(
      all
        .filter((s) => s.state === "not_feasible")
        .every((s) => !visible.some((v) => v.key === s.key)),
    ).toBe(true);
    const target = visible.find((s) => s.key === "pm_workload");
    expect(target).toBeTruthy();

    // Starting with Dexter doesn't hide it; a failed attempt (no saved report) doesn't either.
    await markSuggestionStarted(EMPLOYEE_ID, "pm_workload");
    expect(
      (await visibleSuggestions(employee, access)).find((s) => s.key === "pm_workload")!.state,
    ).toBe("in_progress");

    // A saved report that is equivalent (different name) completes it.
    const r = await createReport({
      spec: pmWorkload("PM Workload Dashboard"),
      ownerId: EMPLOYEE_ID,
      authorKind: "dexter",
    });
    expect(await linkNewReportToSuggestion(EMPLOYEE_ID, r)).toBe("pm_workload");
    expect((await visibleSuggestions(employee, access)).some((s) => s.key === "pm_workload")).toBe(
      false,
    );
    expect(
      (await suggestionStates(employee, access)).find((s) => s.key === "pm_workload")!.coveredBy,
    ).toEqual({ id: r.id, title: "PM Workload Dashboard" });

    // Archiving the only equivalent report makes the suggestion eligible again.
    await updateReportMeta(r, { status: "archived" });
    expect((await visibleSuggestions(employee, access)).some((s) => s.key === "pm_workload")).toBe(
      true,
    );
    await deleteReport(r);
    expect((await visibleSuggestions(employee, access)).some((s) => s.key === "pm_workload")).toBe(
      true,
    );
  });

  it("respects dismissals per user and never fabricates suggestions", async () => {
    const access = await getReportsAccess(employee);
    const first = (await visibleSuggestions(employee, access))[0];
    if (!first) return;
    await dismissSuggestion(EMPLOYEE_ID, first.key);
    expect((await visibleSuggestions(employee, access)).some((s) => s.key === first.key)).toBe(
      false,
    );
    expect(
      (await visibleSuggestions(coworker, await getReportsAccess(coworker))).some(
        (s) => s.key === first.key,
      ),
    ).toBe(true);
    await expect(dismissSuggestion(EMPLOYEE_ID, "made_up_suggestion")).rejects.toThrow(
      /Unknown suggestion/,
    );
  });

  it("treats a report copied from a template as covering that template's suggestion", async () => {
    await ensureReportTemplates();
    const tpl = (
      await agentDb().select<{ id: string; template_key: string }>("bi_reports", {
        filters: [eq("template_key", "active_projects")],
      })
    )[0]!;
    const { getReport } = await import("@/lib/reports/repo");
    const copy = await duplicateReport((await getReport(tpl.id))!, EMPLOYEE_ID);
    expect(copy.origin_template_key).toBe("active_projects");
  });
});

describe("preferences", () => {
  it("persists collapse state per user", async () => {
    expect(await getReportPrefs(EMPLOYEE_ID)).toEqual({
      suggestionsCollapsed: false,
      templatesCollapsed: false,
    });
    await setReportPrefs(EMPLOYEE_ID, { templatesCollapsed: true });
    await setReportPrefs(EMPLOYEE_ID, { suggestionsCollapsed: true });
    expect(await getReportPrefs(EMPLOYEE_ID)).toEqual({
      suggestionsCollapsed: true,
      templatesCollapsed: true,
    });
    expect(await getReportPrefs(HR_ID)).toEqual({
      suggestionsCollapsed: false,
      templatesCollapsed: false,
    });
  });
});

describe("Dexter organization tools", () => {
  it("lists, creates, files, and finds ungrouped reports through real permission checks", async () => {
    const r1 = await createReport({
      spec: spec("Sales commission check"),
      ownerId: EMPLOYEE_ID,
      authorKind: "dexter",
    });
    const run = async (key: string, args: Record<string, unknown>, who = employee, task?: string) =>
      (await getTool(key)!.execute(await toolCtx(who, task), args)).data as Record<string, unknown>;
    expect(await run("reports_groups", {})).toMatchObject({ groups: [], ungroupedReports: 1 });
    expect(await run("reports_group_assign", { reportId: r1.id, group: "Sales" })).toMatchObject({
      ok: false,
    });
    expect(
      await run("reports_group_assign", { reportId: r1.id, group: "Sales", createIfMissing: true }),
    ).toMatchObject({ ok: true, group: "Sales", createdGroup: true });
    expect(await run("reports_group_reports", { group: "Sales" })).toMatchObject({
      group: "Sales",
      reports: [expect.objectContaining({ id: r1.id })],
    });
    expect(await run("reports_group_reports", { group: "ungrouped" })).toMatchObject({
      reports: [],
    });
    expect(
      await run("reports_group_update", { group: "Sales", name: "Sales & Commissions" }),
    ).toMatchObject({ ok: true });
    // Someone else can't touch it.
    expect(
      await run(
        "reports_group_assign",
        { reportId: r1.id, group: "Sales & Commissions" },
        coworker,
      ),
    ).toMatchObject({ ok: false });
    expect(await run("reports_group_remove", { reportId: r1.id })).toMatchObject({ ok: true });
  });

  it("files a new report into a named group at creation and suggests groups without moving anything", async () => {
    const e = await c(employee);
    await ensureReportTemplates(); // creates the default commissions rule set
    await createGroup({ ...e, name: "Sales" });
    await createGroup({ ...e, name: "Design" });
    const created = (
      await getTool("reports_create")!.execute(await toolCtx(employee), {
        spec: spec("Projects by phase"),
        group: "Design",
      })
    ).data as { saved: boolean; reportId: string; group: { filed: boolean; name: string } };
    expect(created.saved).toBe(true);
    expect(created.group).toEqual({ filed: true, name: "Design" });
    const r2 = await createReport({
      spec: reportSpecSchema.parse({
        title: "Commissions by salesperson",
        datasets: [{ id: "c", source: "commissions", ruleSet: "sales_commissions" }],
        widgets: [
          {
            id: "w",
            type: "chart",
            dataset: "c",
            chart: "bar",
            groupBy: "com.salesperson",
            title: "By rep",
          },
        ],
      }),
      ownerId: EMPLOYEE_ID,
      authorKind: "user",
    });
    const sugg = (await getTool("reports_group_suggest")!.execute(await toolCtx(employee), {}))
      .data as {
      proposals: Array<{ reportId: string; proposal: string | null; confidence: string }>;
    };
    expect(sugg.proposals.find((p) => p.reportId === r2.id)).toMatchObject({
      proposal: "Sales",
      confidence: "likely",
    });
    expect((await listGroupsFor(e)).membership.get(r2.id)).toBeUndefined(); // nothing moved
  });

  it("requires a preview and a confirmation in a later turn for bulk moves", async () => {
    const e = await c(employee);
    const sales = await createGroup({ ...e, name: "Sales" });
    const a = await createReport({ spec: spec("A"), ownerId: EMPLOYEE_ID, authorKind: "user" });
    const b = await createReport({ spec: spec("B"), ownerId: EMPLOYEE_ID, authorKind: "user" });
    const theirs = await createReport({ spec: spec("Theirs"), ownerId: HR_ID, authorKind: "user" });
    const turn1 = "00000000-0000-4000-8000-0000000000a1";
    const turn2 = "00000000-0000-4000-8000-0000000000a2";
    const preview = (
      await getTool("reports_group_bulk_move")!.execute(await toolCtx(employee, turn1), {
        reportIds: [a.id, b.id, theirs.id],
        group: "Sales",
      })
    ).data as {
      preview: boolean;
      willMove: string[];
      skipped: string[];
      confirmationToken: string;
      reportIds: string[];
    };
    expect(preview.preview).toBe(true);
    expect(preview.willMove).toEqual(["A", "B"]);
    expect(preview.skipped).toEqual(["(not available to you)"]);
    expect((await listGroupsFor(e)).groups.find((g) => g.id === sales.id)!.reportCount).toBe(0);
    // Same turn → refused.
    const sameTurn = (
      await getTool("reports_group_bulk_move")!.execute(await toolCtx(employee, turn1), {
        reportIds: preview.reportIds,
        group: "Sales",
        confirmationToken: preview.confirmationToken,
      })
    ).data;
    expect(sameTurn).toMatchObject({ ok: false });
    // Tampered list → refused.
    const tampered = (
      await getTool("reports_group_bulk_move")!.execute(await toolCtx(employee, turn2), {
        reportIds: [a.id, b.id, theirs.id],
        group: "Sales",
        confirmationToken: preview.confirmationToken,
      })
    ).data;
    expect(tampered).toMatchObject({ ok: false });
    const done = (
      await getTool("reports_group_bulk_move")!.execute(await toolCtx(employee, turn2), {
        reportIds: preview.reportIds,
        group: "Sales",
        confirmationToken: preview.confirmationToken,
      })
    ).data as { moved: number };
    expect(done.moved).toBe(2);
  });

  it("reports organization metadata in reports_list", async () => {
    const e = await c(employee);
    const r = await createReport({ spec: spec("Mine"), ownerId: EMPLOYEE_ID, authorKind: "user" });
    const g = await createGroup({ ...e, name: "Ops" });
    await assignReportToGroup({ ...e, reportId: r.id, groupId: g.id });
    const list = (await getTool("reports_list")!.execute(await toolCtx(employee), {}))
      .data as Array<{ id: string; groups: string[]; mine: boolean }>;
    expect(list.find((x) => x.id === r.id)).toMatchObject({ groups: ["Ops"], mine: true });
  });
});
