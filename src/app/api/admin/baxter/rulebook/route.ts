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
import {
  createDraftFromVersion,
  createEmptyDraft,
  addStage,
  updateStage,
  deleteStage,
  reorderStages,
  addStep,
  updateStep,
  deleteStep,
  reorderSteps,
  moveStep,
  setStepRaci,
  addDataRequirement,
  updateDataRequirement,
  deleteDataRequirement,
  createRole,
  updateRole,
  retireRole,
} from "@/lib/rulebook/draft";
import { exportRulebookAsSheets } from "@/lib/rulebook/export";
import { listMappings, upsertMapping, deleteMapping } from "@/lib/rulebook/mappings";
import { createServiceClient } from "@/lib/supabase/admin";
import { exportGoogleSheetStructured } from "@/lib/connectors/google/sheets";
import { listCustomFields } from "@/lib/connectors/ghl/resources/custom-fields";
import { listPipelines } from "@/lib/connectors/ghl/resources/pipelines";

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
  // Draft creation
  z.object({
    action: z.literal("create_draft_from_active"),
  }),
  z.object({
    action: z.literal("create_draft_from_version"),
    versionId: z.string(),
  }),
  z.object({
    action: z.literal("create_empty_draft"),
  }),
  // Stage CRUD
  z.object({
    action: z.literal("add_stage"),
    versionId: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    durationDaysBudget: z.number().optional(),
    externalStageName: z.string().optional(),
  }),
  z.object({
    action: z.literal("update_stage"),
    versionId: z.string(),
    stageId: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    durationDaysBudget: z.number().optional(),
    externalStageName: z.string().optional(),
  }),
  z.object({
    action: z.literal("delete_stage"),
    versionId: z.string(),
    stageId: z.string(),
  }),
  z.object({
    action: z.literal("reorder_stages"),
    versionId: z.string(),
    orderedStageIds: z.array(z.string()),
  }),
  // Step CRUD
  z.object({
    action: z.literal("add_step"),
    versionId: z.string(),
    stageId: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    durationDaysBudget: z.number().optional(),
  }),
  z.object({
    action: z.literal("update_step"),
    versionId: z.string(),
    stepId: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    durationDaysBudget: z.number().optional(),
  }),
  z.object({
    action: z.literal("delete_step"),
    versionId: z.string(),
    stepId: z.string(),
  }),
  z.object({
    action: z.literal("reorder_steps"),
    versionId: z.string(),
    stageId: z.string(),
    orderedStepIds: z.array(z.string()),
  }),
  z.object({
    action: z.literal("move_step"),
    versionId: z.string(),
    stepId: z.string(),
    toStageId: z.string(),
  }),
  // RACI
  z.object({
    action: z.literal("set_step_raci"),
    versionId: z.string(),
    stepId: z.string(),
    responsibleRoleKey: z.string().nullable(),
    accountableRoleKey: z.string().nullable(),
    consultedRoleKeys: z.array(z.string()),
    informedRoleKeys: z.array(z.string()),
  }),
  // Data requirements
  z.object({
    action: z.literal("add_data_requirement"),
    versionId: z.string(),
    stepId: z.string(),
    fieldKey: z.string(),
    displayName: z.string(),
    sourceSystem: z.enum(["ghl", "buildertrend", "knowledge", "manual"]),
    sourceFieldPath: z.string().optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("update_data_requirement"),
    versionId: z.string(),
    requirementId: z.string(),
    fieldKey: z.string().optional(),
    displayName: z.string().optional(),
    sourceSystem: z.enum(["ghl", "buildertrend", "knowledge", "manual"]).optional(),
    sourceFieldPath: z.string().optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("delete_data_requirement"),
    versionId: z.string(),
    requirementId: z.string(),
  }),
  // Roles
  z.object({
    action: z.literal("create_role"),
    roleKey: z.string().optional(),
    displayName: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("update_role"),
    roleKey: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("retire_role"),
    roleKey: z.string(),
  }),
  // Validation
  z.object({
    action: z.literal("validate_draft"),
    versionId: z.string(),
  }),
  // Export
  z.object({
    action: z.literal("export_version"),
    versionId: z.string(),
  }),
  // Mappings
  z.object({
    action: z.literal("list_mappings"),
  }),
  z.object({
    action: z.literal("upsert_mapping"),
    ghlPipelineId: z.string(),
    ghlPipelineName: z.string().optional(),
    ghlStageId: z.string(),
    ghlStageName: z.string().optional(),
    rulebookStageKey: z.string(),
    rulebookStepKey: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("delete_mapping"),
    mappingId: z.string(),
  }),
  // GHL reference data
  z.object({
    action: z.literal("list_ghl_custom_fields"),
  }),
  z.object({
    action: z.literal("list_ghl_pipelines"),
  }),
]);

export async function GET() {
  try {
    await requireAdmin();

    const active = await getActiveRulebook();
    const versions = await listRulebookVersions();

    const supabase = createServiceClient();

    // Get counts
    const [draftCountResult, mappingCountResult] = await Promise.all([
      supabase
        .from("rulebook_versions")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase.from("ghl_rulebook_mappings").select("id", { count: "exact", head: true }),
    ]);

    if (!active) {
      const rolesResult = await supabase
        .from("process_roles")
        .select("id", { count: "exact", head: true });

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
        rolesCount: rolesResult.count ?? 0,
        draftCount: draftCountResult.count ?? 0,
        mappingCount: mappingCountResult.count ?? 0,
        validation: null,
      });
    }

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
      draftCount: draftCountResult.count ?? 0,
      mappingCount: mappingCountResult.count ?? 0,
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

      // Draft creation
      case "create_draft_from_active": {
        const active = await getActiveRulebook();
        if (!active) {
          return NextResponse.json({ success: false, error: "No active version" }, { status: 404 });
        }
        const result = await createDraftFromVersion(active.id, user.id);
        return NextResponse.json({ success: true, ...result });
      }

      case "create_draft_from_version": {
        const result = await createDraftFromVersion(parsed.versionId, user.id);
        return NextResponse.json({ success: true, ...result });
      }

      case "create_empty_draft": {
        const result = await createEmptyDraft(user.id);
        return NextResponse.json({ success: true, ...result });
      }

      // Stage CRUD
      case "add_stage": {
        const result = await addStage(
          parsed.versionId,
          {
            displayName: parsed.displayName,
            description: parsed.description,
            durationDaysBudget: parsed.durationDaysBudget,
            externalStageName: parsed.externalStageName,
          },
          user.id,
        );
        return NextResponse.json({ success: true, ...result });
      }

      case "update_stage": {
        await updateStage(
          parsed.versionId,
          parsed.stageId,
          {
            displayName: parsed.displayName,
            description: parsed.description,
            durationDaysBudget: parsed.durationDaysBudget,
            externalStageName: parsed.externalStageName,
          },
          user.id,
        );
        return NextResponse.json({ success: true });
      }

      case "delete_stage": {
        await deleteStage(parsed.versionId, parsed.stageId, user.id);
        return NextResponse.json({ success: true });
      }

      case "reorder_stages": {
        await reorderStages(parsed.versionId, parsed.orderedStageIds, user.id);
        return NextResponse.json({ success: true });
      }

      // Step CRUD
      case "add_step": {
        const result = await addStep(
          parsed.versionId,
          parsed.stageId,
          {
            displayName: parsed.displayName,
            description: parsed.description,
            durationDaysBudget: parsed.durationDaysBudget,
          },
          user.id,
        );
        return NextResponse.json({ success: true, ...result });
      }

      case "update_step": {
        await updateStep(
          parsed.versionId,
          parsed.stepId,
          {
            displayName: parsed.displayName,
            description: parsed.description,
            durationDaysBudget: parsed.durationDaysBudget,
          },
          user.id,
        );
        return NextResponse.json({ success: true });
      }

      case "delete_step": {
        await deleteStep(parsed.versionId, parsed.stepId, user.id);
        return NextResponse.json({ success: true });
      }

      case "reorder_steps": {
        await reorderSteps(parsed.versionId, parsed.stageId, parsed.orderedStepIds, user.id);
        return NextResponse.json({ success: true });
      }

      case "move_step": {
        await moveStep(parsed.versionId, parsed.stepId, parsed.toStageId, user.id);
        return NextResponse.json({ success: true });
      }

      // RACI
      case "set_step_raci": {
        await setStepRaci(
          parsed.versionId,
          parsed.stepId,
          {
            responsibleRoleKey: parsed.responsibleRoleKey,
            accountableRoleKey: parsed.accountableRoleKey,
            consultedRoleKeys: parsed.consultedRoleKeys,
            informedRoleKeys: parsed.informedRoleKeys,
          },
          user.id,
        );
        return NextResponse.json({ success: true });
      }

      // Data requirements
      case "add_data_requirement": {
        const result = await addDataRequirement(
          parsed.versionId,
          parsed.stepId,
          {
            fieldKey: parsed.fieldKey,
            displayName: parsed.displayName,
            sourceSystem: parsed.sourceSystem,
            sourceFieldPath: parsed.sourceFieldPath,
            required: parsed.required,
            description: parsed.description,
          },
          user.id,
        );
        return NextResponse.json({ success: true, ...result });
      }

      case "update_data_requirement": {
        await updateDataRequirement(
          parsed.versionId,
          parsed.requirementId,
          {
            fieldKey: parsed.fieldKey,
            displayName: parsed.displayName,
            sourceSystem: parsed.sourceSystem,
            sourceFieldPath: parsed.sourceFieldPath,
            required: parsed.required,
            description: parsed.description,
          },
          user.id,
        );
        return NextResponse.json({ success: true });
      }

      case "delete_data_requirement": {
        await deleteDataRequirement(parsed.versionId, parsed.requirementId, user.id);
        return NextResponse.json({ success: true });
      }

      // Roles
      case "create_role": {
        const result = await createRole(
          {
            roleKey: parsed.roleKey,
            displayName: parsed.displayName,
            description: parsed.description,
          },
          user.id,
        );
        return NextResponse.json({ success: true, ...result });
      }

      case "update_role": {
        await updateRole(
          parsed.roleKey,
          {
            displayName: parsed.displayName,
            description: parsed.description,
          },
          user.id,
        );
        return NextResponse.json({ success: true });
      }

      case "retire_role": {
        await retireRole(parsed.roleKey, user.id);
        return NextResponse.json({ success: true });
      }

      // Validation
      case "validate_draft": {
        const tree = await loadRulebookTree(parsed.versionId);
        if (!tree) {
          return NextResponse.json({ success: false, error: "Version not found" }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          validation: tree.validation_report_json,
        });
      }

      // Export
      case "export_version": {
        const sheets = await exportRulebookAsSheets(parsed.versionId);
        return NextResponse.json({
          success: true,
          sheets,
        });
      }

      // Mappings
      case "list_mappings": {
        const mappings = await listMappings();
        return NextResponse.json({
          success: true,
          mappings,
        });
      }

      case "upsert_mapping": {
        const result = await upsertMapping(
          {
            ghlPipelineId: parsed.ghlPipelineId,
            ghlPipelineName: parsed.ghlPipelineName,
            ghlStageId: parsed.ghlStageId,
            ghlStageName: parsed.ghlStageName,
            rulebookStageKey: parsed.rulebookStageKey,
            rulebookStepKey: parsed.rulebookStepKey,
            enabled: parsed.enabled,
          },
          user.id,
        );
        return NextResponse.json({ success: true, ...result });
      }

      case "delete_mapping": {
        await deleteMapping(parsed.mappingId);
        return NextResponse.json({ success: true });
      }

      // GHL reference data
      case "list_ghl_custom_fields": {
        try {
          const fields = await listCustomFields();
          return NextResponse.json({
            success: true,
            fields,
          });
        } catch (error) {
          console.error("Error listing GHL custom fields:", error);
          return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to list custom fields",
          });
        }
      }

      case "list_ghl_pipelines": {
        try {
          const pipelines = await listPipelines();
          return NextResponse.json({
            success: true,
            pipelines,
          });
        } catch (error) {
          console.error("Error listing GHL pipelines:", error);
          return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to list pipelines",
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
