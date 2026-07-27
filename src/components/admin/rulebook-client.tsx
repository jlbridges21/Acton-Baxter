"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Upload, Eye, Users } from "lucide-react";

type Tab = "overview" | "import" | "view" | "roles";

type ValidationError = {
  type: string;
  message: string;
  location?: string;
};

type ValidationWarning = {
  type: string;
  message: string;
  location?: string;
};

type ValidationReport = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

type ActiveVersion = {
  id: string;
  versionNumber: number;
  activatedAt: string;
  activatedBy: string | null;
  sourceDescription: string | null;
  validation: ValidationReport;
};

type VersionSummary = {
  id: string;
  versionNumber: number;
  status: string;
  createdAt: string;
  activatedAt: string | null;
  validation: ValidationReport;
};

type RulebookSummary = {
  success: boolean;
  activeVersion: ActiveVersion | null;
  versions: VersionSummary[];
  stagesCount: number;
  stepsCount: number;
  rolesCount: number;
  validation: ValidationReport | null;
};

type DraftImport = {
  versionId: string;
  versionNumber: number;
  validation: ValidationReport;
  diffSummary?: {
    stages_added: number;
    stages_modified: number;
    stages_removed: number;
    steps_added: number;
    steps_modified: number;
    steps_removed: number;
    raci_added: number;
    raci_removed: number;
    data_requirements_added: number;
    data_requirements_removed: number;
  };
};

type RulebookTree = {
  id: string;
  version_number: number;
  status: string;
  stages: Array<{
    id: string;
    stage_key: string;
    display_name: string;
    order_index: number;
    steps: Array<{
      id: string;
      step_key: string;
      display_name: string;
      order_index: number;
      raci: Array<{
        raci: string;
        role_key: string;
        roleName?: string;
      }>;
      data_requirements: Array<{
        field_key: string;
        display_name: string;
        source_system: string;
        required: boolean;
      }>;
    }>;
  }>;
};

type RoleWithAssignment = {
  id: string;
  role_key: string;
  display_name: string;
  description: string | null;
  currentAssignment: {
    id: string;
    profile_id: string | null;
    assigneeName: string | null;
    effective_from: string;
  } | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "import", label: "Import" },
  { id: "view", label: "View Rulebook" },
  { id: "roles", label: "Role Assignments" },
];

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function RulebookClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<RulebookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [importMethod, setImportMethod] = useState<"google" | "json">("google");
  const [googleSheetId, setGoogleSheetId] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [draftImport, setDraftImport] = useState<DraftImport | null>(null);

  const [rulebookTree, setRulebookTree] = useState<RulebookTree | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [roles, setRoles] = useState<RoleWithAssignment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/baxter/rulebook");
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to load rulebook summary");
      }
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadSummary();
    });
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  const handleImport = async () => {
    if (importMethod === "google" && !googleSheetId.trim()) {
      setError("Please enter a Google Sheet ID");
      return;
    }
    if (importMethod === "json" && !jsonInput.trim()) {
      setError("Please enter JSON data");
      return;
    }

    setImportLoading(true);
    setError(null);
    setDraftImport(null);

    try {
      let res: Response;

      if (importMethod === "google") {
        res = await fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import_from_google_sheet",
            fileId: googleSheetId.trim(),
          }),
        });
      } else {
        const parsed = JSON.parse(jsonInput);
        res = await fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import_sheets",
            sheets: parsed,
          }),
        });
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Import failed");
      }

      if (data.versionId && summary?.activeVersion) {
        const diffRes = await fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get_diff",
            draftVersionId: data.versionId,
          }),
        });
        const diffData = await diffRes.json();

        setDraftImport({
          versionId: data.versionId,
          versionNumber: data.versionNumber,
          validation: data.validationReport,
          diffSummary: diffData.success ? diffData.diff : undefined,
        });
      } else {
        setDraftImport({
          versionId: data.versionId,
          versionNumber: data.versionNumber,
          validation: data.validationReport,
        });
      }

      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setImportLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!draftImport || !draftImport.validation.valid) {
      return;
    }

    if (!confirm(`Activate version ${draftImport.versionNumber}?`)) {
      return;
    }

    setImportLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          versionId: draftImport.versionId,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Activation failed");
      }

      setDraftImport(null);
      setGoogleSheetId("");
      setJsonInput("");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setImportLoading(false);
    }
  };

  const handleViewRulebook = async () => {
    if (!summary?.activeVersion) return;

    setViewLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_version",
          versionId: summary.activeVersion.id,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to load rulebook");
      }

      setRulebookTree(data.tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setViewLoading(false);
    }
  };

  const loadRoleAssignments = async () => {
    setRolesLoading(true);
    setError(null);

    try {
      const [rolesRes, profilesRes] = await Promise.all([
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_role_assignments" }),
        }),
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_profiles" }),
        }),
      ]);

      const rolesData = await rolesRes.json();
      const profilesData = await profilesRes.json();

      if (!rolesData.success || !profilesData.success) {
        throw new Error("Failed to load role assignments");
      }

      setRoles(rolesData.roles);
      setProfiles(profilesData.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRolesLoading(false);
    }
  };

  const handleAssignRole = async (roleKey: string, profileId: string | null) => {
    setAssignmentLoading(roleKey);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_role_assignment",
          roleKey,
          profileId,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to assign role");
      }

      await loadRoleAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAssignmentLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Process Rulebook</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Process Rulebook</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Manage versioned RACI matrix and required data definitions
        </p>
      </div>

      {error && (
        <Card className="border-red-500 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </Card>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === "view") void handleViewRulebook();
              if (t.id === "roles") void loadRoleAssignments();
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-[var(--acton-navy)] text-[var(--acton-navy)]"
                : "text-[var(--acton-muted)] hover:text-[var(--acton-navy)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          {!summary?.activeVersion ? (
            <Card className="p-6">
              <CardTitle className="mb-2">No Active Rulebook</CardTitle>
              <CardDescription>
                Import a rulebook from the Import tab to get started.
              </CardDescription>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="p-4">
                  <CardTitle className="text-sm">Active Version</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    v{summary.activeVersion.versionNumber}
                  </CardDescription>
                </Card>
                <Card className="p-4">
                  <CardTitle className="text-sm">Activated</CardTitle>
                  <CardDescription className="mt-2 text-sm text-[var(--acton-navy)]">
                    {formatDate(summary.activeVersion.activatedAt)}
                  </CardDescription>
                </Card>
                <Card className="p-4">
                  <CardTitle className="text-sm">Stages</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    {summary.stagesCount}
                  </CardDescription>
                </Card>
                <Card className="p-4">
                  <CardTitle className="text-sm">Steps</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    {summary.stepsCount}
                  </CardDescription>
                </Card>
              </div>

              <Card className="p-4">
                <CardTitle className="mb-3 flex items-center gap-2">
                  Validation
                  {summary.activeVersion.validation.valid ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                </CardTitle>
                {summary.activeVersion.validation.errors.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-sm font-semibold text-red-800">Errors:</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                      {summary.activeVersion.validation.errors.map((err, i) => (
                        <li key={i}>{err.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.activeVersion.validation.warnings.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-semibold text-yellow-800">Warnings:</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-yellow-700">
                      {summary.activeVersion.validation.warnings.map((warn, i) => (
                        <li key={i}>{warn.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              <div className="flex gap-3">
                <Button onClick={() => setTab("import")} variant="secondary">
                  <Upload className="mr-2 h-4 w-4" />
                  Import New Version
                </Button>
                <Button
                  onClick={() => {
                    setTab("view");
                    void handleViewRulebook();
                  }}
                  variant="secondary"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View Rulebook
                </Button>
                <Button
                  onClick={() => {
                    setTab("roles");
                    void loadRoleAssignments();
                  }}
                  variant="secondary"
                >
                  <Users className="mr-2 h-4 w-4" />
                  Role Assignments
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "import" && (
        <div className="space-y-6">
          <Card className="p-4">
            <CardTitle className="mb-4">Import Rulebook</CardTitle>

            <div className="mb-4 flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={importMethod === "google"}
                  onChange={() => setImportMethod("google")}
                />
                <span className="text-sm">Google Sheet</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={importMethod === "json"}
                  onChange={() => setImportMethod("json")}
                />
                <span className="text-sm">JSON</span>
              </label>
            </div>

            {importMethod === "google" ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                    Google Sheet ID
                  </label>
                  <input
                    type="text"
                    value={googleSheetId}
                    onChange={(e) => setGoogleSheetId(e.target.value)}
                    placeholder="1abc..."
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-[var(--acton-muted)]">
                    From the Google Sheet URL: docs.google.com/spreadsheets/d/[ID]
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--acton-navy)]">
                  JSON Data
                </label>
                <textarea
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder='{"Roles": [...], "Stages": [...], ...}'
                  rows={12}
                  className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
                />
              </div>
            )}

            <div className="mt-4">
              <Button onClick={handleImport} disabled={importLoading}>
                {importLoading ? "Importing..." : "Import"}
              </Button>
            </div>
          </Card>

          {draftImport && (
            <Card className="p-4">
              <CardTitle className="mb-3 flex items-center gap-2">
                Draft Version {draftImport.versionNumber}
                {draftImport.validation.valid ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
              </CardTitle>

              {draftImport.validation.errors.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 text-sm font-semibold text-red-800">Errors:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                    {draftImport.validation.errors.map((err, i) => (
                      <li key={i}>{err.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draftImport.validation.warnings.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 text-sm font-semibold text-yellow-800">Warnings:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-yellow-700">
                    {draftImport.validation.warnings.map((warn, i) => (
                      <li key={i}>{warn.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draftImport.diffSummary && (
                <div className="mb-3">
                  <p className="mb-1 text-sm font-semibold text-[var(--acton-navy)]">
                    Changes vs. Active:
                  </p>
                  <ul className="space-y-1 text-sm text-[var(--acton-muted)]">
                    <li>
                      Stages: +{draftImport.diffSummary.stages_added} ~
                      {draftImport.diffSummary.stages_modified} -
                      {draftImport.diffSummary.stages_removed}
                    </li>
                    <li>
                      Steps: +{draftImport.diffSummary.steps_added} ~
                      {draftImport.diffSummary.steps_modified} -
                      {draftImport.diffSummary.steps_removed}
                    </li>
                    <li>
                      RACI: +{draftImport.diffSummary.raci_added} -
                      {draftImport.diffSummary.raci_removed}
                    </li>
                    <li>
                      Data Requirements: +{draftImport.diffSummary.data_requirements_added} -
                      {draftImport.diffSummary.data_requirements_removed}
                    </li>
                  </ul>
                </div>
              )}

              <Button
                onClick={handleActivate}
                disabled={!draftImport.validation.valid || importLoading}
                className="mt-3"
              >
                {importLoading ? "Activating..." : "Activate"}
              </Button>
            </Card>
          )}
        </div>
      )}

      {tab === "view" && (
        <div className="space-y-6">
          {viewLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading rulebook...</p>
          ) : !rulebookTree ? (
            <Card className="p-4">
              <CardDescription>No active rulebook to view</CardDescription>
            </Card>
          ) : (
            rulebookTree.stages.map((stage) => (
              <Card key={stage.id} className="p-4">
                <CardTitle className="mb-3">
                  {stage.order_index + 1}. {stage.display_name}
                </CardTitle>
                <div className="space-y-4">
                  {stage.steps.map((step) => (
                    <div key={step.id} className="rounded border border-gray-200 bg-gray-50 p-3">
                      <p className="mb-2 font-semibold text-[var(--acton-navy)]">
                        {stage.order_index + 1}.{step.order_index + 1} {step.display_name}
                      </p>

                      {step.raci.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-semibold text-[var(--acton-muted)]">RACI:</p>
                          <div className="flex flex-wrap gap-2">
                            {step.raci.map((r, i) => (
                              <span key={i} className="rounded bg-white px-2 py-1 text-xs">
                                {r.raci}: {r.roleName || r.role_key}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {step.data_requirements.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-[var(--acton-muted)]">
                            Required Data:
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-[var(--acton-navy)]">
                            {step.data_requirements.map((req) => (
                              <li key={req.field_key}>
                                {req.display_name} ({req.source_system})
                                {req.required && <span className="text-red-600"> *</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="space-y-6">
          {rolesLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading role assignments...</p>
          ) : roles.length === 0 ? (
            <Card className="p-4">
              <CardDescription>No roles defined</CardDescription>
            </Card>
          ) : (
            <div className="space-y-3">
              {roles.map((role) => (
                <Card key={role.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base">{role.display_name}</CardTitle>
                      <CardDescription className="text-xs">{role.role_key}</CardDescription>
                      {role.description && (
                        <p className="mt-1 text-sm text-[var(--acton-muted)]">{role.description}</p>
                      )}
                      {role.currentAssignment && (
                        <p className="mt-2 text-sm text-[var(--acton-navy)]">
                          Assigned to: {role.currentAssignment.assigneeName || "Unknown"}
                        </p>
                      )}
                    </div>
                    <div className="ml-4">
                      <select
                        value={role.currentAssignment?.profile_id || ""}
                        onChange={(e) => handleAssignRole(role.role_key, e.target.value || null)}
                        disabled={assignmentLoading === role.role_key}
                        className="rounded border border-gray-300 px-3 py-1 text-sm"
                      >
                        <option value="">Unassigned</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name || p.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-sm">
        <Link
          href="/admin/baxter/governance"
          className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
        >
          ← Back to Governance
        </Link>
      </p>
    </div>
  );
}
