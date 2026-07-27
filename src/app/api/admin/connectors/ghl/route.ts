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
import { searchContacts } from "@/lib/connectors/ghl/resources/contacts";
import { searchOpportunities } from "@/lib/connectors/ghl/resources/opportunities";
import { listPipelines } from "@/lib/connectors/ghl/resources/pipelines";
import { listCalendars } from "@/lib/connectors/ghl/resources/calendars";
import { searchConversations } from "@/lib/connectors/ghl/resources/conversations";
import { listUsers } from "@/lib/connectors/ghl/resources/users";

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
          ])
          .optional(),
        query: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
        pipelineId: z.string().optional(),
        contactId: z.string().optional(),
        resourceType: z
          .enum(["pipelines", "custom_fields", "tags", "users", "calendars", "phone_numbers"])
          .optional(),
        confirmDisconnect: z.boolean().optional(),
      })
      .parse(body);

    if (parsed.action === "test_connection") {
      const result = await testGhlAuthentication();
      return jsonOk({ result });
    }

    if (parsed.action === "test_authentication") {
      const result = await testGhlAuthentication();
      return jsonOk({ result });
    }

    if (parsed.action === "test_location") {
      const result = await testGhlLocation();
      return jsonOk({ result });
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
        const provider = await resolveGhlCredentialProvider();
        const identity = await provider.getIdentity();

        let browseData: unknown = null;

        switch (parsed.tab) {
          case "contacts": {
            const contacts = await searchContacts({
              query: parsed.query,
              email: parsed.email,
              phone: parsed.phone,
              limit: parsed.limit ?? 10,
              page: parsed.page ?? 1,
            });
            browseData = {
              type: "contacts",
              contacts: contacts.contacts,
              total: contacts.total,
              hasMore: contacts.hasMore,
            };
            break;
          }

          case "opportunities": {
            const opportunities = await searchOpportunities({
              pipelineId: parsed.pipelineId,
              contactId: parsed.contactId,
              limit: parsed.limit ?? 10,
            });
            browseData = {
              type: "opportunities",
              opportunities: opportunities.opportunities,
              total: opportunities.total,
              hasMore: opportunities.hasMore,
            };
            break;
          }

          case "pipelines": {
            const pipelines = await listPipelines();
            browseData = {
              type: "pipelines",
              pipelines,
            };
            break;
          }

          case "calendars": {
            const calendars = await listCalendars();
            browseData = {
              type: "calendars",
              calendars,
            };
            break;
          }

          case "conversations": {
            const conversations = await searchConversations({
              contactId: parsed.contactId,
              limit: parsed.limit ?? 10,
            });
            browseData = {
              type: "conversations",
              conversations: conversations.conversations,
              total: conversations.total,
            };
            break;
          }

          case "users": {
            const users = await listUsers();
            browseData = {
              type: "users",
              users,
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
              locationName: identity.locationName,
              locationId: identity.locationId,
              companyId: identity.companyId,
              timezone: identity.timezone,
            };
            break;
          }
        }

        return jsonOk({
          result: {
            pass: true,
            identity,
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

    if (parsed.action === "refresh_reference_cache") {
      const config = getGhlRuntimeConfig();
      if (!config.locationId) {
        return jsonOk({
          result: {
            pass: false,
            message: "GHL_LOCATION_ID is not configured.",
          },
        });
      }

      try {
        if (parsed.resourceType) {
          await invalidateCachedReference(config.locationId, parsed.resourceType);
        } else {
          await invalidateAllGhlCache();
        }

        return jsonOk({
          result: {
            pass: true,
            message: parsed.resourceType
              ? `Cache cleared for ${parsed.resourceType}`
              : "All GHL cache cleared",
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            message: error instanceof Error ? error.message.slice(0, 240) : "Cache refresh failed",
          },
        });
      }
    }

    if (parsed.action === "disconnect") {
      if (!parsed.confirmDisconnect) {
        return jsonOk({
          result: {
            pass: false,
            message: "Confirmation required to disconnect.",
          },
        });
      }

      await disconnectGhlConnection({ adminUserId: user.id });
      return jsonOk({
        result: {
          pass: true,
          message: "GoHighLevel disconnected successfully.",
        },
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

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "POST /api/admin/connectors/ghl");
  }
}
