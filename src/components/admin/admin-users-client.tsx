"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/research/db-types";

type ProfileWithEmail = Profile & { email?: string | null };

export function AdminUsersClient({
  initialProfiles,
  viewerEmail,
  viewerIsSuperAdmin,
}: {
  initialProfiles: ProfileWithEmail[];
  viewerEmail: string;
  viewerIsSuperAdmin: boolean;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function grantAccess(userId: string, role: "salesperson" | "admin" | "new_user") {
    setBusyId(userId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = (await response.json()) as {
        profile?: Profile;
        error?: { message?: string };
      };
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error?.message ?? "Unable to update role");
      }
      setProfiles((current) =>
        current.map((profile) =>
          profile.id === userId ? { ...payload.profile!, email: profile.email ?? null } : profile,
        ),
      );
      setMessage(
        role === "admin"
          ? "User promoted to admin."
          : role === "salesperson"
            ? "User granted salesperson access."
            : "User set to pending (new_user).",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update role");
    } finally {
      setBusyId(null);
    }
  }

  const pending = profiles.filter((profile) => profile.role === "new_user");
  const active = profiles.filter((profile) => profile.role !== "new_user");

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
            Admins can grant <strong>salesperson</strong> access. Only{" "}
            <strong>baxter@actonadu.com</strong> can promote users to admin.
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
          you grant salesperson access.
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
                    {profile.email || profile.id} · role: {profile.role}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === profile.id}
                    onClick={() => void grantAccess(profile.id, "salesperson")}
                  >
                    Grant salesperson
                  </Button>
                  {viewerIsSuperAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busyId === profile.id}
                      onClick={() => void grantAccess(profile.id, "admin")}
                    >
                      Grant admin
                    </Button>
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
        <div className="mt-4 divide-y divide-[var(--acton-border)]">
          {active.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--acton-navy)]">
                  {profile.full_name || "Unnamed user"}
                  {profile.email?.toLowerCase() === "baxter@actonadu.com" ? (
                    <span className="ml-2 text-xs font-semibold text-emerald-800">super-admin</span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--acton-muted)]">
                  {profile.email || profile.id} · role: {profile.role}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.role === "salesperson" ? (
                  <>
                    {viewerIsSuperAdmin ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busyId === profile.id}
                        onClick={() => void grantAccess(profile.id, "admin")}
                      >
                        Promote to admin
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {profile.role === "admin" &&
                profile.email?.toLowerCase() !== "baxter@actonadu.com" &&
                viewerIsSuperAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyId === profile.id}
                    onClick={() => void grantAccess(profile.id, "salesperson")}
                  >
                    Set salesperson
                  </Button>
                ) : null}
                {profile.role !== "new_user" &&
                profile.email?.toLowerCase() !== "baxter@actonadu.com" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyId === profile.id}
                    onClick={() => void grantAccess(profile.id, "new_user")}
                  >
                    Revoke access
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
