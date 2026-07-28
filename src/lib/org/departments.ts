import "server-only";

import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { getReportStore } from "@/lib/research/report-store";
import type { Profile } from "@/lib/research/db-types";
import type {
  CreateDepartmentInput,
  Department,
  UpdateDepartmentInput,
} from "@/lib/org/department-types";

export { SALES_DEPARTMENT_SLUG } from "@/lib/org/department-types";
export type { CreateDepartmentInput, Department, UpdateDepartmentInput } from "@/lib/org/department-types";

type MemoryState = {
  departments: Map<string, Department>;
  departmentSlugIndex: Map<string, string>;
};

const globalMemory = globalThis as typeof globalThis & {
  __actonDepartmentsMemory?: MemoryState;
};

function getMemoryState(): MemoryState {
  if (!globalMemory.__actonDepartmentsMemory) {
    globalMemory.__actonDepartmentsMemory = {
      departments: new Map(),
      departmentSlugIndex: new Map(),
    };
  }
  return globalMemory.__actonDepartmentsMemory;
}

function nowIso() {
  return new Date().toISOString();
}

function shouldUseMemoryStore(): boolean {
  const env = getEnv();
  return (
    env.E2E_TEST_AUTH_BYPASS ||
    env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1") ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("test-")
  );
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const SEED_DEPARTMENTS: Array<{ name: string; slug: string; sort_order: number }> = [
  { name: "Sales", slug: "sales", sort_order: 10 },
  { name: "Design", slug: "design", sort_order: 20 },
  { name: "Marketing", slug: "marketing", sort_order: 30 },
  { name: "Project Management", slug: "project_management", sort_order: 40 },
  { name: "Production", slug: "production", sort_order: 50 },
  { name: "Operations", slug: "operations", sort_order: 60 },
];

function seedMemoryDepartmentsIfEmpty(): void {
  const state = getMemoryState();
  if (state.departments.size > 0) return;

  const timestamp = nowIso();
  for (const seed of SEED_DEPARTMENTS) {
    const id = randomUUID();
    const department: Department = {
      id,
      name: seed.name,
      slug: seed.slug,
      description: null,
      is_active: true,
      sort_order: seed.sort_order,
      created_at: timestamp,
      updated_at: timestamp,
    };
    state.departments.set(id, department);
    state.departmentSlugIndex.set(seed.slug, id);
  }
}

function mapDepartmentRow(row: Record<string, unknown>): Department {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    is_active: Boolean(row.is_active ?? true),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listDepartments(options?: {
  includeInactive?: boolean;
}): Promise<Department[]> {
  if (shouldUseMemoryStore()) {
    seedMemoryDepartmentsIfEmpty();
    const rows = Array.from(getMemoryState().departments.values());
    const filtered = options?.includeInactive ? rows : rows.filter((d) => d.is_active);
    return filtered.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  const supabase = createServiceClient();
  let query = supabase.from("departments").select("*").order("sort_order", { ascending: true });
  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapDepartmentRow(row as Record<string, unknown>));
}

export async function getDepartmentById(id: string): Promise<Department | null> {
  if (shouldUseMemoryStore()) {
    seedMemoryDepartmentsIfEmpty();
    return getMemoryState().departments.get(id) ?? null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("departments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDepartmentRow(data as Record<string, unknown>) : null;
}

export async function getDepartmentBySlug(slug: string): Promise<Department | null> {
  if (shouldUseMemoryStore()) {
    seedMemoryDepartmentsIfEmpty();
    const id = getMemoryState().departmentSlugIndex.get(slug);
    return id ? (getMemoryState().departments.get(id) ?? null) : null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDepartmentRow(data as Record<string, unknown>) : null;
}

export async function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  const name = input.name.trim();
  const slug = (input.slug?.trim() || slugify(name)).toLowerCase();
  if (!name) throw new Error("Department name is required");

  if (shouldUseMemoryStore()) {
    seedMemoryDepartmentsIfEmpty();
    const state = getMemoryState();
    if (state.departmentSlugIndex.has(slug)) {
      throw new Error("A department with this slug already exists");
    }
    const timestamp = nowIso();
    const id = randomUUID();
    const department: Department = {
      id,
      name,
      slug,
      description: input.description?.trim() || null,
      is_active: true,
      sort_order: input.sort_order ?? 0,
      created_at: timestamp,
      updated_at: timestamp,
    };
    state.departments.set(id, department);
    state.departmentSlugIndex.set(slug, id);
    return department;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({
      name,
      slug,
      description: input.description?.trim() || null,
      sort_order: input.sort_order ?? 0,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDepartmentRow(data as Record<string, unknown>);
}

export async function updateDepartment(
  id: string,
  input: UpdateDepartmentInput,
): Promise<Department> {
  if (shouldUseMemoryStore()) {
    seedMemoryDepartmentsIfEmpty();
    const state = getMemoryState();
    const existing = state.departments.get(id);
    if (!existing) throw new Error("Department not found");

    const nextSlug = input.slug?.trim().toLowerCase() ?? existing.slug;
    if (nextSlug !== existing.slug) {
      const conflictId = state.departmentSlugIndex.get(nextSlug);
      if (conflictId && conflictId !== id) {
        throw new Error("A department with this slug already exists");
      }
      state.departmentSlugIndex.delete(existing.slug);
      state.departmentSlugIndex.set(nextSlug, id);
    }

    const updated: Department = {
      ...existing,
      name: input.name?.trim() ?? existing.name,
      slug: nextSlug,
      description:
        input.description !== undefined ? input.description?.trim() || null : existing.description,
      sort_order: input.sort_order ?? existing.sort_order,
      is_active: input.is_active ?? existing.is_active,
      updated_at: nowIso(),
    };
    state.departments.set(id, updated);
    return updated;
  }

  const supabase = createServiceClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.slug !== undefined) patch.slug = input.slug.trim().toLowerCase();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await supabase
    .from("departments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDepartmentRow(data as Record<string, unknown>);
}

export async function deactivateDepartment(id: string): Promise<Department> {
  return updateDepartment(id, { is_active: false });
}

export async function assignUserDepartment(
  profileId: string,
  departmentId: string | null,
): Promise<Profile> {
  if (departmentId) {
    const department = await getDepartmentById(departmentId);
    if (!department || !department.is_active) {
      throw new Error("Department not found or inactive");
    }
  }

  if (shouldUseMemoryStore()) {
    const store = getReportStore();
    const existing = await store.getProfile(profileId);
    if (!existing) throw new Error("Profile not found");

    let departmentName: string | null = null;
    if (departmentId) {
      const department = await getDepartmentById(departmentId);
      departmentName = department?.name ?? null;
    }

    const updated: Profile = {
      ...existing,
      department_id: departmentId,
      department_name: departmentName,
      updated_at: nowIso(),
    };
    return store.ensureProfile(updated);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ department_id: departmentId })
    .eq("id", profileId)
    .select("*, departments(name)")
    .single();

  if (error) throw new Error(error.message);

  const row = data as Record<string, unknown> & { departments?: { name?: string } | null };
  return {
    id: String(row.id),
    full_name: String(row.full_name),
    role: row.role as Profile["role"],
    department_id: (row.department_id as string | null) ?? null,
    department_name: row.departments?.name ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function resetMemoryDepartmentsForTests(): void {
  globalMemory.__actonDepartmentsMemory = {
    departments: new Map(),
    departmentSlugIndex: new Map(),
  };
}
