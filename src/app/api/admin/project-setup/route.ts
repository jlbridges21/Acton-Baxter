import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  getProjectSetupSettings,
  listProjectSetupRuns,
  updateProjectSetupSettings,
} from "@/lib/project-setup/store";
import {
  projectSetupSettingsPatchSchema,
  validateSettingsEmails,
} from "@/lib/project-setup/validation";

export async function GET() {
  try {
    await requireAdmin();
    const [settings, runs] = await Promise.all([
      getProjectSetupSettings(),
      listProjectSetupRuns(30),
    ]);
    const warnings = validateSettingsEmails({
      memberEmails: settings.memberEmails,
      testMemberEmails: settings.testMemberEmails,
    });
    return jsonOk({ settings, runs, warnings });
  } catch (error) {
    return jsonError(error, "GET /api/admin/project-setup");
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const parsed = projectSetupSettingsPatchSchema.parse(body);
    const settings = await updateProjectSetupSettings(parsed, admin.id);
    const warnings = validateSettingsEmails({
      memberEmails: settings.memberEmails,
      testMemberEmails: settings.testMemberEmails,
    });
    return jsonOk({ settings, warnings });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/project-setup");
  }
}
