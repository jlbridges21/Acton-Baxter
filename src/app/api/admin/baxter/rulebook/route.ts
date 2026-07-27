import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { z } from "zod";
import {
  getActiveRulebook,
  listRulebookVersions,
  loadRulebookTree,
  diffRulebookVersions,
  parseRulebookSheets,
  validateParsedRulebook,
  importParsedRulebook,
  activateRulebookVersion,
  listProcessRoles,
  listRoleAssignments,
  upsertRoleAssignment,
} from "@/lib/rulebook";
import { createServiceClient } from "@/lib/supabase/admin";
import { exportGoogleSheetStructured } from "@/lib/connectors/google/sheets";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_versions") }),
  z.object({
    action: z.literal("get_version"),
    versionId: z.string(),
  }),
  z.object({
    action: z.literal("get_diff"),
    draftVersionId: z.string(),
  }),
  z.object({
    action: z.literal("import_sheets"),
    sheets: z.record(z.string(), z.array(z.record(z.string(), z.string()))),
    sourceDescription: z.string().optional(),
    sourceReference: z.string().optional(),
  }),
  z.object({
    action: z.literal("import_csv_tabs"),
    sheets: z.record(z.string(), z.array(z.record(z.string(), z.string()))),
    sourceDescription: z.string().optional(),
    sourceReference: z.string().optional(),
  }),
  z.object({
    action: z.literal("activate"),
    versionId: z.string(),
  }),
  z.object({ action: z.literal("list_role_assignments") }),
  z.object({
    action: z.literal("upsert_role_assignment"),
    roleKey: z.string(),
    profileId: z.string().nullable(),
    slackUserId: z.string().nullable().optional(),
    effectiveFrom: z.string().optional(),
  }),
  z.object({ action: z.literal("list_profiles") }),
  z.object({
    action: z.literal("import_from_google_sheet"),
    fileId: z.string(),
  }),
]);

export async function GET() {
  try {
    await requireAdmin();

    const active = await getActiveRulebook();
    const versions = await listRulebookVersions();

    if (!active) {
      return NextResponse.json({
        success: true,
        activeVersion: null,
        versions: versions.map((v) => ({
          id: v.id,
          versionNumber: v.version_number,
          status: v.status,
          createdAt: v.created_at,
          activatedAt: v.activated_at,
          validation: v.validation_report_json,
        })),
        stagesCount: 0,
        stepsCount: 0,
        rolesCount: 0,
        validation: null,
      });
    }

    const supabase = createServiceClient();

    const [stagesResult, stepsResult, rolesResult] = await Promise.all([
      supabase
        .from("process_stages")
        .select("id", { count: "exact", head: true })
        .eq("version_id", active.id),
      supabase
        .from("process_steps")
        .select("id", { count: "exact", head: true })
        .eq("version_id", active.id),
      supabase.from("process_roles").select("id", { count: "exact", head: true }),
    ]);

    return NextResponse.json({
      success: true,
      activeVersion: {
        id: active.id,
        versionNumber: active.version_number,
        activatedAt: active.activated_at,
        activatedBy: active.activated_by,
        sourceDescription: active.source_description,
        validation: active.validation_report_json,
      },
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        status: v.status,
        createdAt: v.created_at,
        activatedAt: v.activated_at,
        validation: v.validation_report_json,
      })),
      stagesCount: stagesResult.count ?? 0,
      stepsCount: stepsResult.count ?? 0,
      rolesCount: rolesResult.count ?? 0,
      validation: active.validation_report_json,
    });
  } catch (error) {
    console.error("Error fetching rulebook summary:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = ActionSchema.parse(body);

    switch (parsed.action) {
      case "list_versions": {
        const versions = await listRulebookVersions();
        return NextResponse.json({
          success: true,
          versions: versions.map((v) => ({
            id: v.id,
            versionNumber: v.version_number,
            status: v.status,
            createdAt: v.created_at,
            activatedAt: v.activated_at,
            sourceDescription: v.source_description,
            validation: v.validation_report_json,
          })),
        });
      }

      case "get_version": {
        const tree = await loadRulebookTree(parsed.versionId);
        if (!tree) {
          return NextResponse.json({ success: false, error: "Version not found" }, { status: 404 });
        }

        const roles = await listProcessRoles();
        const roleMap = new Map(roles.map((r) => [r.role_key, r.display_name]));

        return NextResponse.json({
          success: true,
          tree: {
            ...tree,
            stages: tree.stages.map((stage) => ({
              ...stage,
              steps: stage.steps.map((step) => ({
                ...step,
                raci: step.raci.map((r) => ({
                  ...r,
                  roleName: roleMap.get(r.role_key) || r.role_key,
                })),
              })),
            })),
          },
        });
      }

      case "get_diff": {
        const active = await getActiveRulebook();
        if (!active) {
          return NextResponse.json({
            success: false,
            error: "No active version to compare against",
          });
        }

        const diff = await diffRulebookVersions(parsed.draftVersionId, active.id);
        if (!diff) {
          return NextResponse.json(
            { success: false, error: "Failed to compute diff" },
            { status: 500 },
          );
        }

        return NextResponse.json({
          success: true,
          diff,
        });
      }

      case "import_sheets":
      case "import_csv_tabs": {
        const sheets = parsed.sheets as Record<string, Array<Record<string, string>>>;
        const parsedRulebook = parseRulebookSheets({ sheets });
        const validationReport = validateParsedRulebook(parsedRulebook);

        const result = await importParsedRulebook(parsedRulebook, validationReport, {
          sourceDescription: parsed.sourceDescription,
          sourceReference: parsed.sourceReference,
          importedBy: user.id,
        });

        return NextResponse.json(result);
      }

      case "activate": {
        const result = await activateRulebookVersion(parsed.versionId, user.id);
        return NextResponse.json(result);
      }

      case "list_role_assignments": {
        const roles = await listProcessRoles();
        const assignments = await listRoleAssignments();

        const supabase = createServiceClient();
        const profileIds = assignments
          .map((a) => a.profile_id)
          .filter((id): id is string => id !== null);

        let profilesMap = new Map<string, { full_name: string; email: string }>();

        if (profileIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", profileIds);

          if (profiles) {
            profilesMap = new Map(profiles.map((p) => [p.id, p]));
          }
        }

        const now = new Date().toISOString();

        const rolesWithAssignments = roles.map((role) => {
          const currentAssignment = assignments
            .filter((a) => a.role_key === role.role_key)
            .filter((a) => a.effective_from <= now)
            .filter((a) => !a.effective_to || a.effective_to > now)
            .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

          let assigneeName: string | null = null;
          if (currentAssignment?.profile_id) {
            const profile = profilesMap.get(currentAssignment.profile_id);
            assigneeName = profile?.full_name || profile?.email || "Unknown";
          }

          return {
            ...role,
            currentAssignment: currentAssignment
              ? {
                  ...currentAssignment,
                  assigneeName,
                }
              : null,
          };
        });

        return NextResponse.json({
          success: true,
          roles: rolesWithAssignments,
        });
      }

      case "upsert_role_assignment": {
        const result = await upsertRoleAssignment({
          role_key: parsed.roleKey,
          profile_id: parsed.profileId,
          slack_user_id: parsed.slackUserId || null,
          effective_from: parsed.effectiveFrom || new Date().toISOString(),
          effective_to: null,
        });

        return NextResponse.json(result);
      }

      case "list_profiles": {
        const supabase = createServiceClient();
        const { data: profiles, error } = await supabase
          .from("profiles")
          .select("id, full_name, email, role")
          .order("full_name");

        if (error) {
          throw error;
        }

        return NextResponse.json({
          success: true,
          profiles: profiles || [],
        });
      }

      case "import_from_google_sheet": {
        try {
          const exported = await exportGoogleSheetStructured(parsed.fileId);

          const sheetRecords: Record<string, Array<Record<string, string>>> = {};
          for (const tab of exported.tabs) {
            sheetRecords[tab.title] = tab.grid.slice(1).map((row) => {
              const record: Record<string, string> = {};
              tab.grid[0]?.forEach((header, idx) => {
                if (header && row[idx] !== undefined) {
                  record[header] = row[idx] ?? "";
                }
              });
              return record;
            });
          }

          const parsedRulebook = parseRulebookSheets({ sheets: sheetRecords });
          const validationReport = validateParsedRulebook(parsedRulebook);

          const result = await importParsedRulebook(parsedRulebook, validationReport, {
            sourceDescription: `Google Sheet: ${exported.workbook.title}`,
            sourceReference: `https://docs.google.com/spreadsheets/d/${parsed.fileId}`,
            importedBy: user.id,
          });

          return NextResponse.json(result);
        } catch (error) {
          console.error("Error importing from Google Sheet:", error);
          return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to import from Google Sheet",
            validationReport: {
              valid: false,
              errors: [
                {
                  type: "unknown_stage_ref" as const,
                  message:
                    error instanceof Error ? error.message : "Failed to import from Google Sheet",
                },
              ],
              warnings: [],
            },
          });
        }
      }

      default: {
        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
      }
    }
  } catch (error) {
    console.error("Error processing rulebook action:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
