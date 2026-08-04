/**
 * Customer Center — assembly, access rules, hard scope boundary, evidence-source claims.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assembleCustomerDossier,
  formatDossierChatSummary,
  isBroadDossierQuestion,
  resolveCustomFieldValueByLabel,
  GHL_PROJECT_TYPE_CONSIDERING_LABEL,
} from "@/lib/dossier";
import { BAXTER_TOOLS } from "@/lib/baxter/tools";
import { getAdminNavSections } from "@/lib/baxter/admin-nav";
import { getEmployeeNavLinks } from "@/lib/baxter/app-nav-links";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AssembleCustomerDossierDeps } from "@/lib/dossier/assemble";
import type { GhlEntityGraph } from "@/lib/connectors/ghl/entity-graph";
import type { PemProspectIndexEntry } from "@/lib/baxter-data/pem-neats/prospect-index";
import type { ProjectSetupRun } from "@/lib/project-setup/types";
import type { MonitoringFinding } from "@/lib/monitoring/types";
import { dossierEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/dossier";
import { ghlEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/ghl";
import { pemEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/pem";
import type { EvidenceSourceHandleInput } from "@/lib/baxter-ai/evidence-registry/types";
import { resolveQuestionEntity } from "@/lib/baxter-ai/evidence-registry";

function emptyGraph(overrides: Partial<GhlEntityGraph> = {}): GhlEntityGraph {
  return {
    retrievedAt: new Date().toISOString(),
    query: "Jane Smith",
    ambiguous: false,
    clarificationMessage: null,
    opportunityAmbiguous: false,
    contact: {
      id: "contact-1",
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "555-0100",
      address1: "123 Main St",
      city: "San Jose",
      state: "CA",
      postalCode: "95110",
      customFields: {
        "cf-project-type": "Detached ADU",
      },
    } as unknown as GhlEntityGraph["contact"],
    opportunities: [
      {
        opportunity: {
          id: "opp-1",
          name: "Jane ADU",
          status: "open",
          monetaryValue: 400000,
        } as GhlEntityGraph["opportunities"][number]["opportunity"],
        pipelineName: "Sales",
        stageName: "Proposal",
        ownerName: "Alex",
      },
    ],
    nextAppointment: null,
    recentConversation: null,
    recentMessages: [],
    customFieldLabels: {
      "cf-project-type": "What type of project are you considering?",
    },
    contactOwnerName: "Alex",
    ...overrides,
  };
}

function pemIndex(): PemProspectIndexEntry[] {
  return [
    {
      pemId: "pem-1",
      prospectName: "Jane Smith",
      normalizedName: "jane smith",
      baseName: "Jane Smith",
      normalizedBase: "jane smith",
      salesperson: "Alex",
      meetingDate: "2026-07-01",
      status: "completed",
    },
  ];
}

function baseDeps(
  overrides: Partial<AssembleCustomerDossierDeps> = {},
): AssembleCustomerDossierDeps {
  return {
    resolveGhl: vi.fn(async () => emptyGraph()),
    buildPemIndex: vi.fn(async () => pemIndex()),
    getPemById: vi.fn(async (id: string) =>
      id === "pem-1"
        ? {
            id: "pem-1",
            prospect_name: "Jane Smith",
            meeting_date: "2026-07-01",
            meeting_outcome: "won",
            qualification: "STRONGLY_QUALIFIED",
            status: "completed",
          }
        : null,
    ),
    listSetupRuns: vi.fn(async () => [] as ProjectSetupRun[]),
    listMonitoringFindings: vi.fn(async () => [] as MonitoringFinding[]),
    ...overrides,
  };
}

function handleInput(question: string): EvidenceSourceHandleInput {
  const entity = resolveQuestionEntity({ question });
  return {
    question,
    history: [],
    entity,
    preferredSource: null,
    conversationMetadata: {},
    role: "user",
    channel: "web",
    ghlConfigured: true,
  };
}

describe("isBroadDossierQuestion", () => {
  it("claims broad everything/full-picture questions", () => {
    expect(isBroadDossierQuestion("Tell me everything about Jane Smith")).toBe(true);
    expect(isBroadDossierQuestion("What's the full picture on Jane Smith?")).toBe(true);
    expect(isBroadDossierQuestion("Customer dossier for Jane Smith")).toBe(true);
    expect(isBroadDossierQuestion("What do we know about Jane Smith?")).toBe(true);
  });

  it("rejects narrow single-fact questions owned by GHL/PEM", () => {
    expect(isBroadDossierQuestion("What's Jane Smith's GHL stage?")).toBe(false);
    expect(isBroadDossierQuestion("What is Jane Smith's email?")).toBe(false);
    expect(isBroadDossierQuestion("Tell me about Jane Smith's PEM")).toBe(false);
    expect(isBroadDossierQuestion("Who is responsible for conducting the PEM?")).toBe(false);
  });
});

describe("Customer Center rename", () => {
  it("uses Customer Center labels on nav, dashboard card, and page heading", () => {
    expect(getEmployeeNavLinks().map((l) => l.label)).toContain("Customer Center");
    expect(getEmployeeNavLinks().map((l) => l.label)).not.toContain("Customer Dossier");

    const toolsLabels = getAdminNavSections()
      .find((s) => s.id === "tools")
      ?.links.map((l) => l.label);
    expect(toolsLabels).toContain("Customer Center");
    expect(toolsLabels).not.toContain("Customer Dossier");

    const card = BAXTER_TOOLS.find((t) => t.key === "customer-dossier");
    expect(card?.name).toBe("Customer Center");
    expect(card?.ctaLabel).toBe("Open Customer Center");

    const pageSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/customers/lookup/page.tsx"),
      "utf8",
    );
    expect(pageSrc).toContain(">Customer Center<");
    expect(pageSrc).not.toContain(">Customer Dossier<");
  });
});

describe("GHL address + project-type fields", () => {
  it("maps address/city/state/postal from the contact already returned by resolveGhlEntityGraph", async () => {
    const dossier = await assembleCustomerDossier({ name: "Jane Smith", role: "user" }, baseDeps());
    expect(dossier.ghl.address).toBe("123 Main St");
    expect(dossier.ghl.city).toBe("San Jose");
    expect(dossier.ghl.state).toBe("CA");
    expect(dossier.ghl.postalCode).toBe("95110");

    const summary = formatDossierChatSummary(dossier);
    expect(summary).toMatch(/Address: 123 Main St/);
    expect(summary).toMatch(/City: San Jose/);
    expect(summary).toMatch(/State: CA/);
    expect(summary).toMatch(/Postal code: 95110/);
  });

  it("resolves project-type custom field by label and omits it when absent", async () => {
    const withField = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps(),
    );
    expect(withField.ghl.projectTypeConsidering).toBe("Detached ADU");
    expect(formatDossierChatSummary(withField)).toMatch(/Project type considering: Detached ADU/);

    const withoutField = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps({
        resolveGhl: vi.fn(async () =>
          emptyGraph({
            contact: {
              id: "contact-1",
              name: "Jane Smith",
              email: "jane@example.com",
              phone: "555-0100",
              address1: null,
              city: null,
              state: null,
              postalCode: null,
              customFields: {},
            } as unknown as GhlEntityGraph["contact"],
            customFieldLabels: {
              "cf-other": "Some other field",
            },
          }),
        ),
      }),
    );
    expect(withoutField.ghl.projectTypeConsidering).toBeNull();
    expect(formatDossierChatSummary(withoutField)).not.toMatch(/Project type considering/);
  });

  it("resolveCustomFieldValueByLabel matches by name, not id", () => {
    expect(
      resolveCustomFieldValueByLabel(
        { "id-abc-different-per-subaccount": "Garage conversion" },
        { "id-abc-different-per-subaccount": GHL_PROJECT_TYPE_CONSIDERING_LABEL },
        GHL_PROJECT_TYPE_CONSIDERING_LABEL,
      ),
    ).toBe("Garage conversion");

    expect(
      resolveCustomFieldValueByLabel(
        { "id-abc": "" },
        { "id-abc": GHL_PROJECT_TYPE_CONSIDERING_LABEL },
        GHL_PROJECT_TYPE_CONSIDERING_LABEL,
      ),
    ).toBeNull();

    expect(
      resolveCustomFieldValueByLabel(
        { "id-abc": "x" },
        { "id-abc": "Unrelated" },
        GHL_PROJECT_TYPE_CONSIDERING_LABEL,
      ),
    ).toBeNull();
  });
});

describe("assembleCustomerDossier", () => {
  it("assembles all sections when sources succeed", async () => {
    const deps = baseDeps({
      listSetupRuns: vi.fn(async () => [
        {
          id: "run-1",
          status: "complete",
          dryRun: false,
          ghlContactId: "contact-1",
          projectNumber: "26-0100",
          folderName: "26-0100 Smith",
          charterName: "Smith Charter",
          slackChannelName: "26-0100-smith",
          contactSnapshot: { id: "contact-1", name: "Jane Smith" },
          projectLastName: "Smith",
        } as ProjectSetupRun,
      ]),
      listMonitoringFindings: vi.fn(async () => [
        {
          id: "f1",
          title: "Stale opportunity",
          severity: "warning",
          status: "open",
          check_key: "stale_opportunity",
          opportunity_id: "opp-1",
        } as MonitoringFinding,
      ]),
    });

    const dossier = await assembleCustomerDossier({ name: "Jane Smith", role: "admin" }, deps);

    expect(dossier.ghl.status).toBe("ok");
    expect(dossier.ghl.contactId).toBe("contact-1");
    expect(dossier.pemNeats.status).toBe("ok");
    expect(dossier.pemNeats.records[0]?.meetingOutcome).toBe("won");
    expect(dossier.projectSetup.status).toBe("ok");
    expect(dossier.projectSetup.runs[0]?.projectNumber).toBe("26-0100");
    expect(dossier.monitoring.status).toBe("ok");
    expect(dossier.monitoring.findings).toHaveLength(1);
  });

  it("cross-references GHL contact to PEM NEAT by reused prospect-index matching", async () => {
    const dossier = await assembleCustomerDossier({ name: "Jane Smith", role: "user" }, baseDeps());
    expect(dossier.pemNeats.records.some((r) => r.id === "pem-1")).toBe(true);
    expect(dossier.pemNeats.records[0]?.matchScore).toBeGreaterThanOrEqual(60);
  });

  it("degrades gracefully when GHL errors — other sections still load", async () => {
    const dossier = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps({
        resolveGhl: vi.fn(async () => {
          throw new Error("GHL rate limited");
        }),
      }),
    );
    expect(dossier.ghl.status).toBe("error");
    expect(dossier.ghl.error).toMatch(/rate limited/i);
    expect(dossier.pemNeats.status).toBe("ok");
    expect(dossier.projectSetup.status).toBe("empty");
  });

  it("degrades gracefully when PEM errors", async () => {
    const dossier = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps({
        buildPemIndex: vi.fn(async () => {
          throw new Error("PEM store down");
        }),
      }),
    );
    expect(dossier.ghl.status).toBe("ok");
    expect(dossier.pemNeats.status).toBe("error");
    expect(dossier.pemNeats.error).toMatch(/PEM store down/);
  });

  it("degrades gracefully when Project Setup errors", async () => {
    const dossier = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps({
        listSetupRuns: vi.fn(async () => {
          throw new Error("setup query failed");
        }),
      }),
    );
    expect(dossier.ghl.status).toBe("ok");
    expect(dossier.pemNeats.status).toBe("ok");
    expect(dossier.projectSetup.status).toBe("error");
  });

  it("degrades gracefully when Monitoring errors for admins", async () => {
    const dossier = await assembleCustomerDossier(
      { name: "Jane Smith", role: "admin" },
      baseDeps({
        listMonitoringFindings: vi.fn(async () => {
          throw new Error("findings unavailable");
        }),
      }),
    );
    expect(dossier.monitoring.status).toBe("error");
    expect(dossier.ghl.status).toBe("ok");
  });
});

describe("dossier monitoring access rule", () => {
  it("omits monitoring for non-admins even when findings exist", async () => {
    const deps = baseDeps({
      listMonitoringFindings: vi.fn(async () => [
        {
          id: "f1",
          title: "Stale opportunity",
          severity: "warning",
          status: "open",
          check_key: "stale_opportunity",
          opportunity_id: "opp-1",
        } as MonitoringFinding,
      ]),
    });

    const userDossier = await assembleCustomerDossier({ name: "Jane Smith", role: "user" }, deps);
    expect(userDossier.monitoring.status).toBe("omitted");
    expect(userDossier.monitoring.findings).toEqual([]);
    expect(deps.listMonitoringFindings).not.toHaveBeenCalled();

    const summary = formatDossierChatSummary(userDossier);
    expect(summary).not.toMatch(/Process Monitoring/i);
    expect(summary).not.toMatch(/Stale opportunity/);
  });

  it("includes monitoring for admins", async () => {
    const deps = baseDeps({
      listMonitoringFindings: vi.fn(async () => [
        {
          id: "f1",
          title: "Stale opportunity",
          severity: "warning",
          status: "open",
          check_key: "stale_opportunity",
          opportunity_id: "opp-1",
        } as MonitoringFinding,
      ]),
    });
    const adminDossier = await assembleCustomerDossier({ name: "Jane Smith", role: "admin" }, deps);
    expect(adminDossier.monitoring.status).toBe("ok");
    expect(adminDossier.monitoring.findings).toHaveLength(1);
    expect(formatDossierChatSummary(adminDossier)).toMatch(/Process Monitoring/);
  });
});

describe("hard scope boundary — no PEM→Project Setup connective action", () => {
  it("shows factual no-run message for a won PEM with no setup run, and no setup CTA", async () => {
    const dossier = await assembleCustomerDossier(
      { name: "Jane Smith", role: "user" },
      baseDeps({
        getPemById: vi.fn(async () => ({
          id: "pem-1",
          prospect_name: "Jane Smith",
          meeting_date: "2026-07-01",
          meeting_outcome: "won",
          qualification: "STRONGLY_QUALIFIED",
          status: "completed",
        })),
        listSetupRuns: vi.fn(async () => []),
      }),
    );

    expect(dossier.pemNeats.records[0]?.meetingOutcome).toBe("won");
    expect(dossier.projectSetup.status).toBe("empty");
    expect(dossier.projectSetup.emptyMessage).toMatch(/No Project Setup run found/i);
    expect(dossier.projectSetup.runs).toEqual([]);

    const summary = formatDossierChatSummary(dossier);
    expect(summary).toMatch(/No Project Setup run found/i);
    expect(summary).not.toMatch(/start project setup/i);
    expect(summary).not.toMatch(/begin setup/i);
    expect(summary).not.toMatch(/set up this project/i);
    expect(summary).not.toMatch(/\/projects\/setup\?/i);

    // Serialized dossier must not carry action affordances
    const serialized = JSON.stringify(dossier);
    expect(serialized).not.toMatch(/startProjectSetup|suggestSetup|setupCta|createSetup/i);
  });
});

describe("dossier evidence source claim scope", () => {
  it("claims broad dossier questions and leaves narrow GHL/PEM questions to those sources", () => {
    const broad = handleInput("Tell me everything about Jane Smith");
    expect(dossierEvidenceSource.canHandle(broad).plausible).toBe(true);
    expect(dossierEvidenceSource.canHandle(broad).confidence).toBeGreaterThanOrEqual(0.9);

    const stageQ = handleInput("What's Jane Smith's stage in GHL?");
    expect(dossierEvidenceSource.canHandle(stageQ).plausible).toBe(false);
    expect(ghlEvidenceSource.canHandle(stageQ).plausible).toBe(true);

    const pemQ = handleInput("Tell me about Jane Smith's PEM");
    expect(dossierEvidenceSource.canHandle(pemQ).plausible).toBe(false);
    expect(pemEvidenceSource.canHandle(pemQ).plausible).toBe(true);
  });
});
