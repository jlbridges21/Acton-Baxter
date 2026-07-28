"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { Department } from "@/lib/org/department-types";

export function DepartmentsSettingsClient({
  initialDepartments,
}: {
  initialDepartments: Department[];
}) {
  const [departments, setDepartments] = useState(initialDepartments);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/departments?includeInactive=1");
    const payload = (await response.json()) as {
      departments?: Department[];
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Unable to load departments");
    }
    setDepartments(payload.departments ?? []);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as {
        department?: Department;
        error?: { message?: string };
      };
      if (!response.ok || !payload.department) {
        throw new Error(payload.error?.message ?? "Unable to create department");
      }
      setName("");
      setMessage(`Added ${payload.department.name}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create department");
    } finally {
      setBusy(false);
    }
  }

  async function onRename(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to rename department");
      }
      setEditingId(null);
      setMessage("Department updated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename department");
    } finally {
      setBusy(false);
    }
  }

  async function onDeactivate(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to deactivate department");
      }
      setMessage("Department deactivated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to deactivate department");
    } finally {
      setBusy(false);
    }
  }

  async function onActivate(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to activate department");
      }
      setMessage("Department activated.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to activate department");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Departments</CardTitle>
      <CardDescription>
        Job functions for Acton employees. Sales department members appear in the PEM NEAT
        salesperson selector.
      </CardDescription>

      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm text-green-800">{message}</p> : null}

      <ul className="mt-4 divide-y divide-[var(--acton-border)]">
        {departments.map((dept) => (
          <li key={dept.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              {editingId === dept.id ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-9 rounded-md border border-[var(--acton-border)] px-2 text-sm"
                  aria-label="Department name"
                />
              ) : (
                <>
                  <p className="font-medium text-[var(--acton-navy)]">{dept.name}</p>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {dept.is_active ? "Active" : "Inactive"} · {dept.slug}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {editingId === dept.id ? (
                <>
                  <Button type="button" size="sm" disabled={busy} onClick={() => onRename(dept.id)}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(dept.id);
                      setEditName(dept.name);
                    }}
                  >
                    Rename
                  </Button>
                  {dept.is_active ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onDeactivate(dept.id)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onActivate(dept.id)}
                    >
                      Activate
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={onCreate}
        className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--acton-border)] pt-4"
      >
        <div className="min-w-[200px] flex-1">
          <label
            htmlFor="new-department"
            className="block text-sm font-medium text-[var(--acton-navy)]"
          >
            Add department
          </label>
          <input
            id="new-department"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Estimating"
            className="mt-1 h-10 w-full rounded-md border border-[var(--acton-border)] px-3 text-sm"
            required
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          Add Department
        </Button>
      </form>
    </Card>
  );
}
