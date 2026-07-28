"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { Profile } from "@/lib/research/db-types";
import type { UserRole } from "@/lib/research/types";
import type { Department } from "@/lib/org/department-types";

type ProfileWithEmail = Profile & { email?: string | null };

const ASSIGNABLE_ROLES: UserRole[] = ["new_user", "user", "admin", "super_admin"];

export function AdminUsersClient({
  initialProfiles,
  initialDepartments,
  viewerEmail,
  viewerIsSuperAdmin,
}: {
  initialProfiles: ProfileWithEmail[];
  initialDepartments: Department[];
  viewerEmail: string;
  viewerIsSuperAdmin: boolean;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [departments] = useState(initialDepartments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  function departmentLabel(profile: ProfileWithEmail): string {
    if (profile.department_name) return profile.department_name;
    if (profile.department_id) {
      return departmentNameById.get(profile.department_id) ?? "Unknown";
    }
    return "—";
  }

  async function updateUser(
    userId: string,
    patch: { role?: UserRole; departmentId?: string | null },
  ) {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as {
        profile?: Profile;
        error?: { message?: string };
      };
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error?.message ?? "Unable to update user");
      }
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === userId
            ? {
                ...payload.profile!,
                email: profile.email ?? null,
                department_name:
                  payload.profile!.department_name ??
                  (payload.profile!.department_id
                    ? (departmentNameById.get(payload.profile!.department_id) ?? null)
                    : null),
              }
            : profile,
        ),
      );
      if (patch.role) {
        setMessage(`Role updated to ${ROLE_LABELS[patch.role]}.`);
      } else if (patch.departmentId !== undefined) {
        setMessage("Department updated.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user");
    } finally {
      setBusyId(null);
    }
  }

  const pending = profiles.filter((profile) => profile.role === "new_user");
  const active = profiles.filter((profile) => profile.role !== "new_user");

  function roleOptionsForProfile(profile: ProfileWithEmail): UserRole[] {
    const isBootstrapAccount =
      profile.email?.trim().toLowerCase() === "baxter@actonadu.com";
    return ASSIGNABLE_ROLES.filter((role) => {
      if (role === "super_admin" && !viewerIsSuperAdmin) return false;
      if (isBootstrapAccount && role === "new_user") return false;
      if (isBootstrapAccount && role === "user") return false;
      return true;
    });
  }

  function renderRoleSelect(profile: ProfileWithEmail) {
    const options = roleOptionsForProfile(profile);
    return (
      <select
        className="rounded-md border border-[var(--acton-border)] bg-white px-2 py-1 text-sm"
        value={profile.role}
        disabled={busyId === profile.id}
        onChange={(event) => {
          const nextRole = event.target.value as UserRole;
          if (nextRole !== profile.role) {
            void updateUser(profile.id, { role: nextRole });
          }
        }}
      >
        {options.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
    );
  }

  function renderDepartmentSelect(profile: ProfileWithEmail) {
    return (
      <select
        className="rounded-md border border-[var(--acton-border)] bg-white px-2 py-1 text-sm"
        value={profile.department_id ?? ""}
        disabled={busyId === profile.id}
        onChange={(event) => {
          const departmentId = event.target.value || null;
          if (departmentId !== (profile.department_id ?? "")) {
            void updateUser(profile.id, { departmentId });
          }
        }}
      >
        <option value="">No department</option>
        {departments
          .filter((d) => d.is_active)
          .map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
      </select>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Users</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Grant access for pending signups and manage roles. Signed in as{" "}
          <strong>{viewerEmail}</strong>
          {viewerIsSuperAdmin ? " (super-admin)" : " (admin)"}.
        </p>
        {!viewerIsSuperAdmin ? (
          <p className="mt-2 text-sm text-amber-800">
            Admins can grant <strong>user</strong> access and assign departments. Only a{" "}
            <strong>super-admin</strong> can promote users to super admin.
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <Card>
        <CardTitle>Pending access</CardTitle>
        <CardDescription className="mt-2">
          Self-registered accounts start as <strong>new_user</strong> and cannot use Baxter until
          you grant user access.
        </CardDescription>
        <div className="mt-4 divide-y divide-[var(--acton-border)]">
          {pending.length === 0 ? (
            <p className="py-3 text-sm text-[var(--acton-muted)]">No pending users.</p>
          ) : (
            pending.map((profile) => (
              <div
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--acton-navy)]">
                    {profile.full_name || "Unnamed user"}
                  </p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {profile.email || profile.id} · Department: {departmentLabel(profile)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {renderDepartmentSelect(profile)}
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === profile.id}
                    onClick={() => void updateUser(profile.id, { role: "user" })}
                  >
                    Grant user access
                  </Button>
                  {viewerIsSuperAdmin ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === profile.id}
                        onClick={() => void updateUser(profile.id, { role: "admin" })}
                      >
                        Grant admin
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Active users</CardTitle>
        <CardDescription className="mt-2">Users who already have app access.</CardDescription>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--acton-border)] text-left text-xs uppercase tracking-wide text-[var(--acton-muted)]">
                <th className="px-2 py-2 font-medium">User</th>
                <th className="px-2 py-2 font-medium">Department</th>
                <th className="px-2 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--acton-border)]">
              {active.map((profile) => (
                <tr key={profile.id}>
                  <td className="px-2 py-3 align-top">
                    <p className="font-semibold text-[var(--acton-navy)]">
                      {profile.full_name || "Unnamed user"}
                      {profile.email?.toLowerCase() === "baxter@actonadu.com" ? (
                        <span className="ml-2 text-xs font-semibold text-emerald-800">
                          super-admin
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--acton-muted)]">
                      {profile.email || profile.id}
                    </p>
                  </td>
                  <td className="px-2 py-3 align-top">{renderDepartmentSelect(profile)}</td>
                  <td className="px-2 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderRoleSelect(profile)}
                      {profile.email?.toLowerCase() !== "baxter@actonadu.com" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busyId === profile.id}
                          onClick={() => void updateUser(profile.id, { role: "new_user" })}
                        >
                          Revoke access
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
