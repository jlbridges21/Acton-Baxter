import "server-only";

/**
 * Role and role assignment management for Process Rulebook.
 */

import { createServiceClient } from "@/lib/supabase/admin";
import type { ProcessRole, ProcessRoleAssignment, RoleAssignmentWithProfile } from "./types";

/**
 * List all process roles.
 */
export async function listProcessRoles(): Promise<ProcessRole[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("process_roles")
    .select("*")
    .order("role_key", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * List all role assignments (optionally filtered by role).
 */
export async function listRoleAssignments(roleKey?: string): Promise<ProcessRoleAssignment[]> {
  const supabase = createServiceClient();

  let query = supabase.from("process_role_assignments").select("*");

  if (roleKey) {
    query = query.eq("role_key", roleKey);
  }

  const { data, error } = await query.order("effective_from", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Upsert a role assignment.
 */
export async function upsertRoleAssignment(
  assignment: Omit<ProcessRoleAssignment, "id" | "created_at" | "updated_at">,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const supabase = createServiceClient();

  try {
    const { data, error } = await supabase
      .from("process_role_assignments")
      .insert({
        role_key: assignment.role_key,
        profile_id: assignment.profile_id,
        slack_user_id: assignment.slack_user_id,
        effective_from: assignment.effective_from,
        effective_to: assignment.effective_to,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return {
      success: true,
      id: data?.id,
    };
  } catch (error) {
    console.error("Error upserting role assignment:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get the current assignee for a role (with profile name resolved).
 */
export async function getCurrentAssignee(
  roleKey: string,
): Promise<RoleAssignmentWithProfile | null> {
  const supabase = createServiceClient();

  const now = new Date().toISOString();

  // Get current assignment
  const { data: assignment, error: assignmentError } = await supabase
    .from("process_role_assignments")
    .select("*")
    .eq("role_key", roleKey)
    .lte("effective_from", now)
    .or(`effective_to.is.null,effective_to.gt.${now}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .single();

  if (assignmentError) {
    if (assignmentError.code === "PGRST116") {
      return null; // No current assignment
    }
    throw assignmentError;
  }

  // Resolve profile name if profile_id is set
  let profile_name: string | null = null;

  if (assignment.profile_id) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", assignment.profile_id)
      .single();

    if (!profileError && profile) {
      profile_name = profile.full_name || profile.email || null;
    }
  }

  return {
    ...assignment,
    profile_name,
  };
}
