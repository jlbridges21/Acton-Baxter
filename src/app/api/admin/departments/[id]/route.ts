import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { AppError, ValidationError } from "@/lib/errors";
import { deactivateDepartment, getDepartmentById, updateDepartment } from "@/lib/org/departments";
import { isUuid } from "@/lib/utils";

const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  deactivate: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const { id } = await context.params;
    if (!isUuid(id)) {
      throw new ValidationError("Invalid department id");
    }

    const existing = await getDepartmentById(id);
    if (!existing) {
      throw new AppError("Department not found", {
        code: "DEPARTMENT_NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }

    const body = await request.json();
    const parsed = updateDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid department");
    }

    const department = parsed.data.deactivate
      ? await deactivateDepartment(id)
      : await updateDepartment(id, parsed.data);

    return jsonOk({ department });
  } catch (error) {
    return jsonError(error, "PATCH /api/admin/departments/[id]");
  }
}
