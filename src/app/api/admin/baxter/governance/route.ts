import { requireAdmin } from "@/lib/auth/session";
import { isSuperAdminRole } from "@/lib/auth/roles";
import { jsonError, jsonOk } from "@/lib/api";
import { z } from "zod";
import {
  activateGovernanceVersion,
  approveDraftSection,
  assignDomainOwner,
  diffGovernanceSections,
  getActivationGate,
  getActiveGovernanceVersion,
  getGovernanceVersionSections,
  getOrCreateDraftVersion,
  listDomainOwners,
  listGovernanceVersions,
  listSectionApprovals,
  updateDraftSection,
  GOVERNANCE_DOMAINS,
  GOVERNANCE_SURFACES,
  GOVERNANCE_SURFACE_LABELS,
  SECTION_DOMAIN,
  SECTION_LABELS,
  GOVERNANCE_DOMAIN_LABELS,
  loadActiveGovernanceContent,
  sectionKeysForSurface,
} from "@/lib/baxter-ai/governance";
import type {
  GovernanceDomain,
  GovernanceSectionKey,
  GovernanceSurface,
} from "@/lib/baxter-ai/governance";
import { ALL_GOVERNANCE_SECTION_KEYS } from "@/lib/baxter-ai/governance/section-meta";

const surfaceSchema = z.enum(
  GOVERNANCE_SURFACES as unknown as [GovernanceSurface, ...GovernanceSurface[]],
);

function parseSurface(raw: string | null | undefined): GovernanceSurface {
  const parsed = surfaceSchema.safeParse(raw ?? "baxter_runtime");
  return parsed.success ? parsed.data : "baxter_runtime";
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "overview";
    const surface = parseSurface(searchParams.get("surface"));
    const sectionKeys = sectionKeysForSurface(surface);

    const [active, versions, owners, loaded] = await Promise.all([
      getActiveGovernanceVersion(surface),
      listGovernanceVersions(surface),
      listDomainOwners(),
      loadActiveGovernanceContent(surface),
    ]);

    const activeSections = active ? await getGovernanceVersionSections(active.id) : [];
    const draft = versions.find((v) => v.status === "draft") ?? null;
    const draftSections = draft ? await getGovernanceVersionSections(draft.id) : [];
    const draftApprovals = draft ? await listSectionApprovals(draft.id) : [];
    const gate = draft ? await getActivationGate(draft.id) : null;

    if (view === "history") {
      const history = [];
      for (let i = 0; i < versions.length - 1; i++) {
        const newer = versions[i]!;
        const older = versions[i + 1]!;
        const newerSecs = await getGovernanceVersionSections(newer.id);
        const olderSecs = await getGovernanceVersionSections(older.id);
        history.push({
          fromVersion: older.version_number,
          toVersion: newer.version_number,
          changedSections: diffGovernanceSections(olderSecs, newerSecs, surface),
        });
      }
      return jsonOk({ history, versions, surface });
    }

    return jsonOk({
      surface,
      active,
      activeSections,
      draft,
      draftSections,
      draftApprovals,
      gate,
      owners,
      versions,
      loaded,
      meta: {
        surface,
        surfaceLabels: GOVERNANCE_SURFACE_LABELS,
        surfaces: GOVERNANCE_SURFACES,
        sectionKeys,
        sectionLabels: SECTION_LABELS,
        sectionDomains: SECTION_DOMAIN,
        domains: GOVERNANCE_DOMAINS,
        domainLabels: GOVERNANCE_DOMAIN_LABELS,
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/baxter/governance");
  }
}

const sectionKeySchema = z.enum(
  ALL_GOVERNANCE_SECTION_KEYS as unknown as [GovernanceSectionKey, ...GovernanceSectionKey[]],
);
const domainSchema = z.enum(
  GOVERNANCE_DOMAINS as unknown as [GovernanceDomain, ...GovernanceDomain[]],
);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const action = z.string().parse(body.action);
    const surface = parseSurface(
      typeof body.surface === "string" ? body.surface : "baxter_runtime",
    );

    if (action === "ensure_draft") {
      const draft = await getOrCreateDraftVersion(
        user.id,
        typeof body.rationale === "string" ? body.rationale : null,
        surface,
      );
      return jsonOk({ draft });
    }

    if (action === "update_section") {
      const versionId = z.string().uuid().parse(body.versionId);
      const sectionKey = sectionKeySchema.parse(body.sectionKey);
      const content = z.string().min(1).parse(body.content);
      await updateDraftSection(versionId, sectionKey, content);
      return jsonOk({ updated: true });
    }

    if (action === "approve_section") {
      const versionId = z.string().uuid().parse(body.versionId);
      const sectionKey = sectionKeySchema.parse(body.sectionKey);
      const result = await approveDraftSection({
        versionId,
        sectionKey,
        approvedBy: user.id,
        role: user.profile.role,
      });
      if (!result.ok) return jsonError(new Error(result.error), "approve_section");
      return jsonOk({ approved: true });
    }

    if (action === "activate") {
      const versionId = z.string().uuid().parse(body.versionId);
      const result = await activateGovernanceVersion(versionId, user.id, user.profile.role);
      if (!result.ok) {
        return jsonOk({ activated: false, ...result }, { status: 409 });
      }
      return jsonOk({
        activated: true,
        version: result.version,
        changedSections: result.changedSections,
      });
    }

    if (action === "assign_domain_owner") {
      if (!isSuperAdminRole(user.profile.role)) {
        return jsonError(new Error("Only super_admin can assign domain owners"), "assign");
      }
      const domain = domainSchema.parse(body.domain) as GovernanceDomain;
      const profileId =
        body.profileId === null || body.profileId === ""
          ? null
          : z.string().uuid().parse(body.profileId);
      const owner = await assignDomainOwner(domain, profileId, user.id);
      return jsonOk({ owner });
    }

    return jsonError(new Error(`Unknown action: ${action}`), "POST governance");
  } catch (error) {
    return jsonError(error, "POST /api/admin/baxter/governance");
  }
}
