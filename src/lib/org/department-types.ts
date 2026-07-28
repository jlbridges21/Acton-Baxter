export type Department = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CreateDepartmentInput = {
  name: string;
  slug?: string;
  description?: string | null;
  sort_order?: number;
};

export type UpdateDepartmentInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export const SALES_DEPARTMENT_SLUG = "sales";
