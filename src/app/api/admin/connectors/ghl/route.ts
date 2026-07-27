import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  getGhlAdminOverview,
  testGhlAuthentication,
  testGhlLocation,
} from "@/lib/connectors/ghl/diagnostics";
import {
  disconnectGhlConnection,
  upsertGhlPrivateIntegrationConnection,
} from "@/lib/connectors/ghl/connections";
import { invalidateCachedReference, invalidateAllGhlCache } from "@/lib/connectors/ghl/cache";
import { getGhlRuntimeConfig } from "@/lib/connectors/ghl/config";
import { resolveGhlCredentialProvider } from "@/lib/connectors/ghl/auth";
import { searchContacts, getContactById } from "@/lib/connectors/ghl/resources/contacts";
import {
  searchOpportunities,
  getOpportunityById,
} from "@/lib/connectors/ghl/resources/opportunities";
import { listPipelines } from "@/lib/connectors/ghl/resources/pipelines";
import { listCalendars } from "@/lib/connectors/ghl/resources/calendars";
import { searchConversations } from "@/lib/connectors/ghl/resources/conversations";
import { listUsers } from "@/lib/connectors/ghl/resources/users";
import { probeGhlCapabilities } from "@/lib/connectors/ghl/capabilities";
import { getRecentAuditEntries } from "@/lib/connectors/ghl/actions/audit";
import {
  listRecentPendingActions,
  createPendingAction,
  confirmPendingAction,
  cancelPendingAction,
  getPendingAction,
} from "@/lib/connectors/ghl/actions/pending-actions";
import { executeAction } from "@/lib/connectors/ghl/actions/execute";
import { canUserWriteGhl } from "@/lib/connectors/ghl/actions/permissions";
import {
  filterContactChanges,
  filterOpportunityChanges,
} from "@/lib/connectors/ghl/actions/allowlist";
import { warmGhlReferenceCache } from "@/lib/connectors/ghl/reference-data";
import {
  hydrateContactRows,
  hydrateOpportunityRows,
  hydrateConversationRows,
  buildContactDetailView,
  buildOpportunityDetailView,
  buildConversationDetailView,
} from "@/lib/connectors/ghl/admin-views";
import { buildPipelineBoard } from "@/lib/connectors/ghl/pipeline-board";
import { createServiceClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requireAdmin();
    const overview = await getGhlAdminOverview();
    return jsonOk(overview);
  } catch (error) {
    return jsonError(error, "GET /api/admin/connectors/ghl");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = z
      .object({
        action: z.enum([
          "test_connection",
          "test_authentication",
          "test_location",
          "browse",
          "refresh_reference_cache",
          "refresh_data",
          "refresh_capabilities",
          "list_recent_actions",
          "list_pipelines_for_opportunities",
          "get_pipeline_board",
          "get_contact_detail",
          "get_opportunity_detail",
          "get_conversation_detail",
          "propose_admin_action",
          "confirm_admin_action",
          "cancel_admin_action",
          "disconnect",
          "mark_connected_from_pit",
        ]),
        tab: z
          .enum([
            "overview",
            "contacts",
            "opportunities",
            "pipelines",
            "calendars",
            "conversations",
            "users",
            "voice-ai",
            "advanced",
            "recent-actions",
            "actions",
          ])
          .optional(),
        query: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
        pipelineId: z.string().optional(),
        pipelineStageId: z.string().optional(),
        contactId: z.string().optional(),
        opportunityId: z.string().optional(),
        conversationId: z.string().optional(),
        assignedTo: z.string().optional(),
        status: z.enum(["open", "won", "lost", "abandoned", "all"]).optional(),
        source: z.string().optional(),
        stageId: z.string().optional(),
        perStageLimit: z.number().optional(),
        resourceType: z
          .enum(["pipelines", "custom_fields", "tags", "users", "calendars", "phone_numbers"])
          .optional(),
        confirmDisconnect: z.boolean().optional(),
        pendingActionId: z.string().uuid().optional(),
        actionType: z
          .enum([
            "update_contact_fields",
            "add_contact_tag",
            "remove_contact_tag",
            "update_opportunity",
            "move_opportunity_stage",
          ])
          .optional(),
        resourceId: z.string().optional(),
        resourceName: z.string().optional(),
        proposedChanges: z.record(z.string(), z.unknown()).optional(),
        lastMessageId: z.string().optional(),
      })
      .parse(body);

    if (parsed.action === "test_connection" || parsed.action === "test_authentication") {
      const result = await testGhlAuthentication();
      if (result.pass) {
        await warmGhlReferenceCache().catch(() => null);
      }
      return jsonOk({ result });
    }

    if (parsed.action === "test_location") {
      const result = await testGhlLocation();
      return jsonOk({ result });
    }

    if (parsed.action === "refresh_data" || parsed.action === "refresh_reference_cache") {
      const config = getGhlRuntimeConfig();
      if (!config.locationId) {
        return jsonOk({
          result: { pass: false, message: "GHL_LOCATION_ID is not configured." },
        });
      }
      try {
        if (parsed.resourceType) {
          await invalidateCachedReference(config.locationId, parsed.resourceType);
        } else {
          await invalidateAllGhlCache();
        }
        const warmed = await warmGhlReferenceCache();
        return jsonOk({
          result: {
            pass: warmed.ok,
            message: warmed.message || "CRM data refreshed.",
            warmed: warmed.warmed,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            message: error instanceof Error ? error.message.slice(0, 240) : "Refresh failed",
          },
        });
      }
    }

    if (parsed.action === "browse") {
      const config = getGhlRuntimeConfig();
      if (!config.enabled) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_DISABLED",
            message: "GoHighLevel integration is disabled.",
          },
        });
      }

      try {
        await getGhlReferenceDataWarm();
        const page = parsed.page && parsed.page > 0 ? parsed.page : 1;
        const limit = parsed.limit && parsed.limit > 0 ? Math.min(parsed.limit, 50) : 25;
        let browseData: unknown = null;

        switch (parsed.tab) {
          case "contacts": {
            const contacts = await searchContacts({
              query: parsed.query,
              email: parsed.email,
              phone: parsed.phone,
              limit,
              page,
            });
            const rows = await hydrateContactRows(contacts.contacts);
            browseData = {
              type: "contacts",
              rows,
              contacts: rows,
              total: contacts.total,
              page: contacts.page,
              pageLimit: contacts.pageLimit,
              hasMore: contacts.hasMore,
            };
            break;
          }

          case "opportunities": {
            const opportunities = await searchOpportunities({
              q: parsed.query,
              pipelineId: parsed.pipelineId,
              pipelineStageId: parsed.pipelineStageId,
              contactId: parsed.contactId,
              assignedTo: parsed.assignedTo,
              status: parsed.status ?? "open",
              limit,
              page,
            });
            const rows = await hydrateOpportunityRows(opportunities.opportunities);
            browseData = {
              type: "opportunities",
              rows,
              opportunities: rows,
              total: opportunities.total,
              page,
              pageLimit: limit,
              hasMore: opportunities.hasMore,
            };
            break;
          }

          case "conversations": {
            const conversations = await searchConversations({
              contactId: parsed.contactId,
              limit,
            });
            const rows = await hydrateConversationRows(conversations.conversations);
            browseData = {
              type: "conversations",
              rows,
              conversations: rows,
              total: conversations.total,
              page,
              pageLimit: limit,
              hasMore: rows.length >= limit,
            };
            break;
          }

          case "pipelines": {
            browseData = { type: "pipelines", pipelines: await listPipelines() };
            break;
          }
          case "calendars": {
            browseData = { type: "calendars", calendars: await listCalendars() };
            break;
          }
          case "users": {
            browseData = { type: "users", users: await listUsers() };
            break;
          }

          case "recent-actions":
          case "actions": {
            const [audit, pending] = await Promise.all([
              getRecentAuditEntries({ limit: limit }),
              listRecentPendingActions({ limit: 20 }),
            ]);
            browseData = {
              type: "actions",
              rows: audit,
              audit,
              pending,
              total: audit.length,
              page: 1,
              pageLimit: limit,
              hasMore: false,
            };
            break;
          }

          case "overview":
          default: {
            const overview = await getGhlAdminOverview();
            browseData = {
              type: "overview",
              health: overview.health,
              connection: overview.connection,
            };
            break;
          }
        }

        return jsonOk({
          result: {
            pass: true,
            data: browseData,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code:
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: string }).code)
                : "BAXTER_GHL_API_UNAVAILABLE",
            message: error instanceof Error ? error.message.slice(0, 240) : "Browse failed",
          },
        });
      }
    }

    if (parsed.action === "list_pipelines_for_opportunities") {
      try {
        const pipelines = await listPipelines();
        return jsonOk({
          result: {
            pass: true,
            pipelines: pipelines.map((p) => ({
              id: p.id,
              name: p.name,
              stageCount: p.stages.length,
            })),
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_API_UNAVAILABLE",
            message:
              error instanceof Error ? error.message.slice(0, 240) : "Failed to list pipelines",
          },
        });
      }
    }

    if (parsed.action === "get_pipeline_board") {
      if (!parsed.pipelineId) {
        return jsonOk({ result: { pass: false, message: "pipelineId is required." } });
      }
      try {
        const board = await buildPipelineBoard(parsed.pipelineId, {
          q: parsed.query,
          status: parsed.status,
          assignedTo: parsed.assignedTo,
          source: parsed.source,
          perStageLimit: parsed.perStageLimit,
          stagePages: parsed.stageId && parsed.page ? { [parsed.stageId]: parsed.page } : undefined,
        });
        return jsonOk({ result: { pass: true, data: board } });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_API_UNAVAILABLE",
            message:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Failed to load pipeline board",
          },
        });
      }
    }

    if (parsed.action === "list_recent_actions") {
      try {
        const [auditEntries, pending] = await Promise.all([
          getRecentAuditEntries({ limit: parsed.limit ?? 50 }),
          listRecentPendingActions({ limit: 30 }),
        ]);
        const audit = await enrichAuditEntries(auditEntries);
        return jsonOk({
          result: {
            pass: true,
            data: {
              type: "actions",
              audit,
              pending: pending.map((p) => ({
                id: p.id,
                userId: p.userId,
                actionType: p.actionType,
                resourceType: p.resourceType,
                resourceId: p.resourceId,
                resourceName: p.resourceName,
                beforeState: p.beforeState,
                proposedChanges: p.proposedChanges,
                status: p.status,
                expiresAt: p.expiresAt,
                createdAt: p.createdAt,
                channel: p.channel,
              })),
            },
            entries: audit,
            total: audit.length,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_API_UNAVAILABLE",
            message:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Failed to fetch audit entries",
          },
        });
      }
    }

    if (parsed.action === "get_contact_detail") {
      if (!parsed.contactId) {
        return jsonOk({ result: { pass: false, message: "contactId is required." } });
      }
      const detail = await buildContactDetailView(parsed.contactId);
      if (!detail) {
        return jsonOk({ result: { pass: false, message: "Contact not found." } });
      }
      return jsonOk({ result: { pass: true, data: detail } });
    }

    if (parsed.action === "get_opportunity_detail") {
      if (!parsed.opportunityId) {
        return jsonOk({ result: { pass: false, message: "opportunityId is required." } });
      }
      const detail = await buildOpportunityDetailView(parsed.opportunityId);
      if (!detail) {
        return jsonOk({ result: { pass: false, message: "Opportunity not found." } });
      }
      return jsonOk({ result: { pass: true, data: detail } });
    }

    if (parsed.action === "get_conversation_detail") {
      if (!parsed.conversationId) {
        return jsonOk({ result: { pass: false, message: "conversationId is required." } });
      }
      const detail = await buildConversationDetailView(parsed.conversationId, {
        limit: parsed.limit ?? 30,
        lastMessageId: parsed.lastMessageId,
      });
      return jsonOk({ result: { pass: true, data: detail } });
    }

    if (parsed.action === "propose_admin_action") {
      const permission = canUserWriteGhl(user.profile);
      if (!permission.canWrite) {
        return jsonOk({
          result: {
            pass: false,
            message:
              permission.reason || "CRM updates through Baxter are currently restricted to admins.",
          },
        });
      }
      if (!parsed.actionType || !parsed.resourceId || !parsed.proposedChanges) {
        return jsonOk({
          result: {
            pass: false,
            message: "actionType, resourceId, and proposedChanges are required.",
          },
        });
      }

      const resourceType =
        parsed.actionType.includes("opportunity") || parsed.actionType === "move_opportunity_stage"
          ? "opportunity"
          : "contact";

      let beforeState: Record<string, unknown> = {};
      let resourceName = parsed.resourceName || resourceType;

      if (resourceType === "contact") {
        const contact = await getContactById(parsed.resourceId);
        if (!contact) {
          return jsonOk({ result: { pass: false, message: "Contact not found." } });
        }
        resourceName = contact.name || resourceName;
        beforeState = {
          dateUpdated: contact.dateUpdated,
          ...Object.fromEntries(
            Object.keys(parsed.proposedChanges).map((k) => [
              k,
              (contact as unknown as Record<string, unknown>)[k] ?? null,
            ]),
          ),
        };
        if (parsed.actionType === "update_contact_fields") {
          const { rejected } = filterContactChanges(parsed.proposedChanges);
          if (rejected.length) {
            return jsonOk({
              result: { pass: false, message: `Fields not allowed: ${rejected.join(", ")}` },
            });
          }
        }
      } else {
        const opportunity = await getOpportunityById(parsed.resourceId);
        if (!opportunity) {
          return jsonOk({ result: { pass: false, message: "Opportunity not found." } });
        }
        resourceName = opportunity.name || resourceName;
        beforeState = {
          dateUpdated: opportunity.dateUpdated,
          pipelineStageId: opportunity.pipelineStageId,
          assignedTo: opportunity.assignedTo,
          monetaryValue: opportunity.monetaryValue,
          status: opportunity.status,
        };
        if (parsed.actionType === "update_opportunity") {
          const { rejected } = filterOpportunityChanges(parsed.proposedChanges);
          if (rejected.length) {
            return jsonOk({
              result: { pass: false, message: `Fields not allowed: ${rejected.join(", ")}` },
            });
          }
        }
      }

      const pending = await createPendingAction({
        userId: user.id,
        conversationId: null,
        channel: "web",
        actionType: parsed.actionType,
        resourceType,
        resourceId: parsed.resourceId,
        resourceName,
        beforeState,
        proposedChanges: parsed.proposedChanges,
        metadata: { source: "admin_crm_ui" },
      });

      return jsonOk({
        result: {
          pass: true,
          message: "Proposed GoHighLevel update. Confirm to apply.",
          pending,
        },
      });
    }

    if (parsed.action === "confirm_admin_action") {
      const permission = canUserWriteGhl(user.profile);
      if (!permission.canWrite) {
        return jsonOk({
          result: {
            pass: false,
            message: "CRM updates through Baxter are currently restricted to admins.",
          },
        });
      }
      if (!parsed.pendingActionId) {
        return jsonOk({ result: { pass: false, message: "pendingActionId is required." } });
      }
      const pending = await getPendingAction(parsed.pendingActionId);
      if (!pending) {
        return jsonOk({ result: { pass: false, message: "Pending action not found." } });
      }
      if (pending.userId && pending.userId !== user.id) {
        return jsonOk({
          result: {
            pass: false,
            message: "You can only confirm your own pending GoHighLevel updates.",
          },
        });
      }
      const confirmed = await confirmPendingAction(parsed.pendingActionId);
      if (!confirmed.success || !confirmed.action) {
        return jsonOk({
          result: { pass: false, message: confirmed.error || "Could not confirm action." },
        });
      }
      const result = await executeAction(confirmed.action.id);
      return jsonOk({
        result: {
          pass: result.success,
          message: result.success
            ? "GoHighLevel update completed."
            : result.errorMessage || "Update failed. Nothing was changed.",
          errorCode: result.errorCode,
        },
      });
    }

    if (parsed.action === "cancel_admin_action") {
      if (!parsed.pendingActionId) {
        return jsonOk({ result: { pass: false, message: "pendingActionId is required." } });
      }
      const pending = await getPendingAction(parsed.pendingActionId);
      if (pending?.userId && pending.userId !== user.id) {
        return jsonOk({
          result: { pass: false, message: "You can only cancel your own pending updates." },
        });
      }
      const cancelled = await cancelPendingAction(parsed.pendingActionId);
      return jsonOk({
        result: {
          pass: cancelled.success,
          message: cancelled.success ? "Pending update cancelled." : cancelled.error,
        },
      });
    }

    if (parsed.action === "disconnect") {
      if (!parsed.confirmDisconnect) {
        return jsonOk({
          result: { pass: false, message: "Confirmation required to disconnect." },
        });
      }
      await disconnectGhlConnection({ adminUserId: user.id });
      return jsonOk({
        result: { pass: true, message: "GoHighLevel disconnected successfully." },
      });
    }

    if (parsed.action === "mark_connected_from_pit") {
      const config = getGhlRuntimeConfig();
      if (config.authMode !== "private_integration") {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_BAD_REQUEST",
            message: "This action is only available in Private Integration mode.",
          },
        });
      }
      if (!config.locationId) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_LOCATION_INVALID",
            message: "GHL_LOCATION_ID is not configured.",
          },
        });
      }
      try {
        const provider = await resolveGhlCredentialProvider();
        const identity = await provider.getIdentity();
        const health = await provider.health();
        if (!health.ok) {
          return jsonOk({
            result: {
              pass: false,
              code: health.code,
              message: `Cannot verify Private Integration Token: ${health.message}`,
            },
          });
        }
        const connection = await upsertGhlPrivateIntegrationConnection({
          locationId: identity.locationId,
          companyId: identity.companyId,
          locationName: identity.locationName,
          locationTimezone: identity.timezone,
          connectedBy: user.id,
        });
        await warmGhlReferenceCache().catch(() => null);
        return jsonOk({
          result: {
            pass: true,
            message: "Private Integration connection verified and marked as connected.",
            connection,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code:
              error && typeof error === "object" && "code" in error
                ? String((error as { code?: string }).code)
                : "BAXTER_GHL_AUTH_FAILED",
            message:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Connection verification failed",
          },
        });
      }
    }

    if (parsed.action === "refresh_capabilities") {
      try {
        const capabilityMatrix = await probeGhlCapabilities();
        return jsonOk({
          result: {
            pass: capabilityMatrix.coreAvailable,
            capabilityMatrix,
            message: capabilityMatrix.coreAvailable
              ? `Connected with ${capabilityMatrix.coreCapabilities.length} core + ${capabilityMatrix.optionalAvailable.length} optional capabilities.`
              : `Core CRM capabilities not available. Check scopes.`,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            code: "BAXTER_GHL_API_UNAVAILABLE",
            message:
              error instanceof Error ? error.message.slice(0, 240) : "Capability probe failed",
          },
        });
      }
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/ghl");
  }
}

async function getGhlReferenceDataWarm() {
  const { getGhlReferenceData } = await import("@/lib/connectors/ghl/reference-data");
  await getGhlReferenceData().catch(() => null);
}

async function enrichAuditEntries(entries: Awaited<ReturnType<typeof getRecentAuditEntries>>) {
  const supabase = await createServiceClient();
  const userIds = [...new Set(entries.map((e) => e.actorUserId).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const row of data ?? []) {
      nameById.set(String(row.id), String(row.full_name || "User"));
    }
  }
  return entries.map((e) => ({
    id: e.id,
    user: e.actorUserId ? nameById.get(e.actorUserId) || "User" : "System",
    userId: e.actorUserId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    before: e.beforeState,
    after: e.afterState,
    status: e.status,
    channel: e.channel || "web",
    time: e.executedAt || e.confirmedAt || e.createdAt,
    errorCode: e.errorCode,
  }));
}
