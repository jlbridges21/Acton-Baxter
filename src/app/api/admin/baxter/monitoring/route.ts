import { jsonError, jsonOk } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth/session";

export async function GET(_request: Request) {
  try {
    await requireAdmin();
    const { getMonitoringDashboardSummary } = await import("@/lib/monitoring");

    const summary = await getMonitoringDashboardSummary();

    return jsonOk(summary);
  } catch (error) {
    return jsonError(error, "GET /api/admin/baxter/monitoring");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = await request.json();

    const action = body.action as string | undefined;

    if (!action) {
      throw new AppError("Missing action", { statusCode: 400 });
    }

    if (action === "get_settings") {
      const { getMonitoringSettings } = await import("@/lib/monitoring");
      const settings = await getMonitoringSettings();
      return jsonOk({ settings });
    }

    if (action === "update_settings") {
      const { updateMonitoringSettings } = await import("@/lib/monitoring");
      const patch = body.patch as Record<string, unknown>;
      if (!patch) {
        throw new AppError("Missing patch", { statusCode: 400 });
      }

      const settings = await updateMonitoringSettings(patch, session.id);
      return jsonOk({ settings });
    }

    if (action === "list_findings") {
      const { listFindings } = await import("@/lib/monitoring");
      const filters = body.filters as Record<string, unknown> | undefined;
      const findings = await listFindings(filters);
      return jsonOk({ findings });
    }

    if (action === "get_finding") {
      const { getFinding } = await import("@/lib/monitoring");
      const id = body.id as string | undefined;
      if (!id) {
        throw new AppError("Missing finding id", { statusCode: 400 });
      }
      const finding = await getFinding(id);
      return jsonOk({ finding });
    }

    if (action === "list_runs") {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const supabase = createServiceClient();
      const limit = typeof body.limit === "number" ? body.limit : 50;

      const { data: runs, error } = await supabase
        .from("monitoring_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to list runs: ${error.message}`);
      }

      return jsonOk({ runs });
    }

    if (action === "run_sweep") {
      const { runMonitoringSweep } = await import("@/lib/monitoring");
      const force = body.force === true;
      const summary = await runMonitoringSweep({
        trigger: "manual",
        force,
      });
      return jsonOk({ summary });
    }

    if (action === "list_mappings") {
      const { createServiceClient } = await import("@/lib/supabase/admin");
      const supabase = createServiceClient();

      const { data: mappings, error } = await supabase
        .from("ghl_rulebook_mappings")
        .select("*")
        .order("ghl_pipeline_name", { ascending: true });

      if (error) {
        throw new Error(`Failed to list mappings: ${error.message}`);
      }

      return jsonOk({ mappings });
    }

    if (action === "update_check_config") {
      const { updateMonitoringSettings } = await import("@/lib/monitoring");
      const checkKey = body.checkKey as string | undefined;
      const config = body.config as Record<string, unknown> | undefined;

      if (!checkKey) {
        throw new AppError("Missing checkKey", { statusCode: 400 });
      }

      const { getMonitoringSettings } = await import("@/lib/monitoring");
      const currentSettings = await getMonitoringSettings();
      const checkConfigs = { ...currentSettings.check_configs };
      checkConfigs[checkKey] = config || {};

      const settings = await updateMonitoringSettings({ check_configs: checkConfigs }, session.id);
      return jsonOk({ settings });
    }

    throw new AppError(`Unknown action: ${action}`, { statusCode: 400 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/baxter/monitoring");
  }
}
