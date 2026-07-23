"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/research/db-types";

export function AdminUsersClient({ initialProfiles }: { initialProfiles: Profile[] }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function grantAccess(userId: string, role: "salesperson" | "admin") {
    setBusyId(userId);
    setError(null);
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
        current.map((profile) => (profile.id === userId ? payload.profile! : profile)),
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
      <Card>
        <CardTitle>Pending access</CardTitle>
        <CardDescription className="mt-2">
          Self-registered accounts receive the <strong>new_user</strong> role and cannot use the app
          until you grant salesperson or admin access.
        </CardDescription>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
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
                    {profile.id} · role: {profile.role}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === profile.id}
                    onClick={() => void grantAccess(profile.id, "salesperson")}
                  >
                    Grant salesperson
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyId === profile.id}
                    onClick={() => void grantAccess(profile.id, "admin")}
                  >
                    Grant admin
                  </Button>
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
                </p>
                <p className="text-xs text-[var(--acton-muted)]">role: {profile.role}</p>
              </div>
              {profile.role === "salesperson" ? (
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
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
