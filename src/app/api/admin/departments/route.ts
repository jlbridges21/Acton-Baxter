import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { createDepartment, listDepartments } from "@/lib/org/departments";

const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  sort_order: z.number().int().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const departments = await listDepartments({ includeInactive: true });
    return jsonOk({ departments });
  } catch (error) {
    return jsonError(error, "GET /api/admin/departments");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid department");
    }

    const department = await createDepartment(parsed.data);
    return jsonOk({ department }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/departments");
  }
}
