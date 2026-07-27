"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  CheckCircle,
  XCircle,
  Upload,
  Eye,
  Users,
  Edit,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  History,
  MapPin,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

type Tab = "overview" | "import" | "view" | "roles" | "editor" | "versions" | "mappings";

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
  draftCount: number;
  mappingCount: number;
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
  validation_report_json?: ValidationReport;
  stages: Array<{
    id: string;
    stage_key: string;
    display_name: string;
    description?: string;
    order_index: number;
    duration_days_budget?: number;
    steps: Array<{
      id: string;
      step_key: string;
      display_name: string;
      description?: string;
      order_index: number;
      duration_days_budget?: number;
      raci: Array<{
        raci: string;
        role_key: string;
        roleName?: string;
      }>;
      data_requirements: Array<{
        id: string;
        field_key: string;
        display_name: string;
        source_system: string;
        source_field_path?: string;
        required: boolean;
        description?: string;
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

type Role = {
  id: string;
  role_key: string;
  display_name: string;
  description: string | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
};

type GHLCustomField = {
  id: string;
  name: string;
  fieldKey: string;
};

type GHLPipeline = {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
  }>;
};

type Mapping = {
  id: string;
  ghl_pipeline_id: string;
  ghl_pipeline_name: string | null;
  ghl_stage_id: string;
  ghl_stage_name: string | null;
  rulebook_stage_key: string;
  rulebook_step_key: string | null;
  enabled: boolean;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "import", label: "Import" },
  { id: "view", label: "View Rulebook" },
  { id: "roles", label: "Role Assignments" },
  { id: "versions", label: "Version History" },
  { id: "mappings", label: "GHL Mappings" },
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

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      className={`fixed right-4 bottom-4 rounded-lg px-4 py-3 shadow-lg ${
        type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
      }`}
    >
      {message}
    </div>
  );
}

export function RulebookClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<RulebookSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Import state
  const [importMethod, setImportMethod] = useState<"google" | "json">("google");
  const [googleSheetId, setGoogleSheetId] = useState("");
  const [jsonInput, setJsonInput] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [draftImport, setDraftImport] = useState<DraftImport | null>(null);

  // View state
  const [rulebookTree, setRulebookTree] = useState<RulebookTree | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Roles state
  const [roles, setRoles] = useState<RoleWithAssignment[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState<string | null>(null);

  // Editor state
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingTree, setEditingTree] = useState<RulebookTree | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [, setEditorLoading] = useState(false);
  const [ghlFields, setGhlFields] = useState<GHLCustomField[]>([]);
  const [, setGhlPipelines] = useState<GHLPipeline[]>([]);

  // Versions state
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Mappings state
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

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
      showToast("Import successful", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Import failed", "error");
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
      showToast("Version activated successfully", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Activation failed", "error");
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
      showToast(err instanceof Error ? err.message : "Failed to load", "error");
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
      showToast(err instanceof Error ? err.message : "Failed to load", "error");
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
      showToast("Role assignment updated", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Assignment failed", "error");
    } finally {
      setAssignmentLoading(null);
    }
  };

  const startEditingFromActive = async () => {
    if (!summary?.activeVersion) return;

    setEditorLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_draft_from_active" }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to create draft");
      }

      await openEditor(data.versionId);
      await loadSummary();
      showToast("Draft created from active version", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to create draft", "error");
      setEditorLoading(false);
    }
  };

  const openEditor = async (versionId: string) => {
    setEditorLoading(true);
    setError(null);

    try {
      const [versionRes, rolesRes, ghlFieldsRes, ghlPipelinesRes] = await Promise.all([
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_version", versionId }),
        }),
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_role_assignments" }),
        }),
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_ghl_custom_fields" }),
        }),
        fetch("/api/admin/baxter/rulebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_ghl_pipelines" }),
        }),
      ]);

      const versionData = await versionRes.json();
      const rolesData = await rolesRes.json();
      const ghlFieldsData = await ghlFieldsRes.json();
      const ghlPipelinesData = await ghlPipelinesRes.json();

      if (!versionData.success) {
        throw new Error("Failed to load version");
      }

      setEditingTree(versionData.tree);
      setEditingVersionId(versionId);
      setTab("editor");
      setSelectedStageId(versionData.tree.stages[0]?.id || null);
      setSelectedStepId(null);

      if (rolesData.success) {
        setAllRoles(
          rolesData.roles.map((r: RoleWithAssignment) => ({
            id: r.id,
            role_key: r.role_key,
            display_name: r.display_name,
            description: r.description,
          })),
        );
      }

      if (ghlFieldsData.success) {
        setGhlFields(ghlFieldsData.fields || []);
      }

      if (ghlPipelinesData.success) {
        setGhlPipelines(ghlPipelinesData.pipelines || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load editor", "error");
    } finally {
      setEditorLoading(false);
    }
  };

  const reloadEditingTree = async () => {
    if (!editingVersionId) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_version", versionId: editingVersionId }),
      });

      const data = await res.json();
      if (data.success) {
        setEditingTree(data.tree);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reload", "error");
    }
  };

  const handleAddStage = async () => {
    if (!editingVersionId) return;

    const displayName = prompt("Stage name:");
    if (!displayName) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_stage",
          versionId: editingVersionId,
          displayName,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to add stage");

      await reloadEditingTree();
      showToast("Stage added", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add stage", "error");
    }
  };

  const handleUpdateStage = async (stageId: string) => {
    const stage = editingTree?.stages.find((s) => s.id === stageId);
    if (!stage || !editingVersionId) return;

    const displayName = prompt("Stage name:", stage.display_name);
    if (!displayName) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_stage",
          versionId: editingVersionId,
          stageId,
          displayName,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to update stage");

      await reloadEditingTree();
      showToast("Stage updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update stage", "error");
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    if (!editingVersionId) return;
    if (!confirm("Delete this stage and all its steps?")) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_stage",
          versionId: editingVersionId,
          stageId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete stage");

      await reloadEditingTree();
      setSelectedStageId(editingTree?.stages[0]?.id || null);
      showToast("Stage deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete stage", "error");
    }
  };

  const handleMoveStage = async (stageId: string, direction: "up" | "down") => {
    if (!editingVersionId || !editingTree) return;

    const stageIndex = editingTree.stages.findIndex((s) => s.id === stageId);
    if (stageIndex === -1) return;
    if (direction === "up" && stageIndex === 0) return;
    if (direction === "down" && stageIndex === editingTree.stages.length - 1) return;

    const newOrder = [...editingTree.stages];
    const targetIndex = direction === "up" ? stageIndex - 1 : stageIndex + 1;
    const tempStage = newOrder[stageIndex];
    const tempTarget = newOrder[targetIndex];
    if (!tempStage || !tempTarget) return;
    [newOrder[stageIndex], newOrder[targetIndex]] = [tempTarget, tempStage];

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder_stages",
          versionId: editingVersionId,
          orderedStageIds: newOrder.map((s) => s.id),
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to reorder stages");

      await reloadEditingTree();
      showToast("Stage moved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to move stage", "error");
    }
  };

  const handleAddStep = async (stageId: string) => {
    if (!editingVersionId) return;

    const displayName = prompt("Step name:");
    if (!displayName) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_step",
          versionId: editingVersionId,
          stageId,
          displayName,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to add step");

      await reloadEditingTree();
      showToast("Step added", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add step", "error");
    }
  };

  const handleUpdateStep = async (stepId: string) => {
    const step = editingTree?.stages.flatMap((s) => s.steps).find((st) => st.id === stepId);
    if (!step || !editingVersionId) return;

    const displayName = prompt("Step name:", step.display_name);
    if (!displayName) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_step",
          versionId: editingVersionId,
          stepId,
          displayName,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to update step");

      await reloadEditingTree();
      showToast("Step updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update step", "error");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!editingVersionId) return;
    if (!confirm("Delete this step?")) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_step",
          versionId: editingVersionId,
          stepId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete step");

      await reloadEditingTree();
      setSelectedStepId(null);
      showToast("Step deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete step", "error");
    }
  };

  const handleMoveStep = async (stepId: string, stageId: string, direction: "up" | "down") => {
    if (!editingVersionId || !editingTree) return;

    const stage = editingTree.stages.find((s) => s.id === stageId);
    if (!stage) return;

    const stepIndex = stage.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return;
    if (direction === "up" && stepIndex === 0) return;
    if (direction === "down" && stepIndex === stage.steps.length - 1) return;

    const newOrder = [...stage.steps];
    const targetIndex = direction === "up" ? stepIndex - 1 : stepIndex + 1;
    const tempStep = newOrder[stepIndex];
    const tempTarget = newOrder[targetIndex];
    if (!tempStep || !tempTarget) return;
    [newOrder[stepIndex], newOrder[targetIndex]] = [tempTarget, tempStep];

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder_steps",
          versionId: editingVersionId,
          stageId,
          orderedStepIds: newOrder.map((s) => s.id),
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to reorder steps");

      await reloadEditingTree();
      showToast("Step moved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to move step", "error");
    }
  };

  const handleUpdateStepRaci = async (
    stepId: string,
    raciType: "R" | "A" | "C" | "I",
    roleKey: string | null,
  ) => {
    if (!editingVersionId || !editingTree) return;

    const step = editingTree.stages.flatMap((s) => s.steps).find((st) => st.id === stepId);
    if (!step) return;

    const currentR = step.raci.find((r) => r.raci === "R")?.role_key || null;
    const currentA = step.raci.find((r) => r.raci === "A")?.role_key || null;
    const currentC = step.raci.filter((r) => r.raci === "C").map((r) => r.role_key);
    const currentI = step.raci.filter((r) => r.raci === "I").map((r) => r.role_key);

    let responsibleRoleKey = currentR;
    let accountableRoleKey = currentA;
    let consultedRoleKeys = currentC;
    let informedRoleKeys = currentI;

    if (raciType === "R") responsibleRoleKey = roleKey;
    if (raciType === "A") accountableRoleKey = roleKey;
    if (raciType === "C") {
      if (roleKey && !consultedRoleKeys.includes(roleKey)) {
        consultedRoleKeys = [...consultedRoleKeys, roleKey];
      } else if (!roleKey) {
        consultedRoleKeys = [];
      }
    }
    if (raciType === "I") {
      if (roleKey && !informedRoleKeys.includes(roleKey)) {
        informedRoleKeys = [...informedRoleKeys, roleKey];
      } else if (!roleKey) {
        informedRoleKeys = [];
      }
    }

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_step_raci",
          versionId: editingVersionId,
          stepId,
          responsibleRoleKey,
          accountableRoleKey,
          consultedRoleKeys,
          informedRoleKeys,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to update RACI");

      await reloadEditingTree();
      showToast("RACI updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update RACI", "error");
    }
  };

  const handleAddDataRequirement = async (stepId: string) => {
    if (!editingVersionId) return;

    const displayName = prompt("Data requirement name:");
    if (!displayName) return;

    const fieldKey = displayName.toLowerCase().replace(/\s+/g, "_");

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_data_requirement",
          versionId: editingVersionId,
          stepId,
          fieldKey,
          displayName,
          sourceSystem: "manual",
          required: true,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to add data requirement");

      await reloadEditingTree();
      showToast("Data requirement added", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add requirement", "error");
    }
  };

  const handleUpdateDataRequirement = async (
    requirementId: string,
    updates: {
      sourceSystem?: string;
      sourceFieldPath?: string;
    },
  ) => {
    if (!editingVersionId) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_data_requirement",
          versionId: editingVersionId,
          requirementId,
          ...updates,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to update data requirement");

      await reloadEditingTree();
      showToast("Data requirement updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update requirement", "error");
    }
  };

  const handleDeleteDataRequirement = async (requirementId: string) => {
    if (!editingVersionId) return;
    if (!confirm("Delete this data requirement?")) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_data_requirement",
          versionId: editingVersionId,
          requirementId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to delete data requirement");

      await reloadEditingTree();
      showToast("Data requirement deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete requirement", "error");
    }
  };

  const handleValidateDraft = async () => {
    if (!editingVersionId) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate_draft",
          versionId: editingVersionId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to validate");

      if (editingTree) {
        setEditingTree({ ...editingTree, validation_report_json: data.validation });
      }

      showToast(
        data.validation.valid ? "Validation passed" : "Validation has errors",
        data.validation.valid ? "success" : "error",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Validation failed", "error");
    }
  };

  const handleActivateDraft = async () => {
    if (!editingVersionId || !editingTree?.validation_report_json?.valid) return;

    if (!confirm("Activate this draft version?")) return;

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          versionId: editingVersionId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to activate");

      setEditingVersionId(null);
      setEditingTree(null);
      setTab("overview");
      await loadSummary();
      showToast("Version activated successfully", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Activation failed", "error");
    }
  };

  const loadVersions = async () => {
    setVersionsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_versions" }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load versions");

      setVersions(data.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load versions", "error");
    } finally {
      setVersionsLoading(false);
    }
  };

  const loadMappings = async () => {
    setMappingsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/baxter/rulebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_mappings" }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load mappings");

      setMappings(data.mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      showToast(err instanceof Error ? err.message : "Failed to load mappings", "error");
    } finally {
      setMappingsLoading(false);
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

  const selectedStage = editingTree?.stages.find((s) => s.id === selectedStageId);
  const selectedStep = selectedStage?.steps.find((s) => s.id === selectedStepId);

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

      {toast && <Toast message={toast.message} type={toast.type} />}

      {tab !== "editor" && (
        <div className="flex gap-2 border-b border-gray-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "view") void handleViewRulebook();
                if (t.id === "roles") void loadRoleAssignments();
                if (t.id === "versions") void loadVersions();
                if (t.id === "mappings") void loadMappings();
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
      )}

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
                  <CardTitle className="text-sm">Stages / Steps</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    {summary.stagesCount} / {summary.stepsCount}
                  </CardDescription>
                </Card>
                <Card className="p-4">
                  <CardTitle className="text-sm">Roles</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    {summary.rolesCount}
                  </CardDescription>
                </Card>
                <Card className="p-4">
                  <CardTitle className="text-sm">Drafts / Mappings</CardTitle>
                  <CardDescription className="mt-2 text-2xl font-bold text-[var(--acton-navy)]">
                    {summary.draftCount} / {summary.mappingCount}
                  </CardDescription>
                </Card>
              </div>

              {summary.activeVersion.validation && (
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
              )}

              <div className="flex flex-wrap gap-3">
                <Button onClick={startEditingFromActive} variant="primary">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Rulebook
                </Button>
                <Button onClick={() => setTab("import")} variant="secondary">
                  <Upload className="mr-2 h-4 w-4" />
                  Import New
                </Button>
                <Button
                  onClick={() => {
                    setTab("view");
                    void handleViewRulebook();
                  }}
                  variant="secondary"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </Button>
                <Button
                  onClick={() => {
                    setTab("roles");
                    void loadRoleAssignments();
                  }}
                  variant="secondary"
                >
                  <Users className="mr-2 h-4 w-4" />
                  Roles
                </Button>
                <Button
                  onClick={() => {
                    setTab("versions");
                    void loadVersions();
                  }}
                  variant="secondary"
                >
                  <History className="mr-2 h-4 w-4" />
                  History
                </Button>
                <Button
                  onClick={() => {
                    setTab("mappings");
                    void loadMappings();
                  }}
                  variant="secondary"
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  Mappings
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
                        aria-label={`Assign ${role.display_name}`}
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

      {tab === "versions" && (
        <div className="space-y-6">
          {versionsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading versions...</p>
          ) : versions.length === 0 ? (
            <Card className="p-4">
              <CardDescription>No versions found</CardDescription>
            </Card>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => (
                <Card key={version.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base">
                        Version {version.versionNumber}
                        {version.status === "active" && (
                          <span className="ml-2 rounded bg-green-100 px-2 py-1 text-xs font-normal text-green-800">
                            Active
                          </span>
                        )}
                        {version.status === "draft" && (
                          <span className="ml-2 rounded bg-yellow-100 px-2 py-1 text-xs font-normal text-yellow-800">
                            Draft
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Created: {formatDate(version.createdAt)}
                        {version.activatedAt && ` • Activated: ${formatDate(version.activatedAt)}`}
                      </CardDescription>
                      {version.validation && !version.validation.valid && (
                        <p className="mt-2 text-xs text-red-600">
                          Has {version.validation.errors.length} error(s)
                        </p>
                      )}
                    </div>
                    <div className="ml-4 flex gap-2">
                      {version.status === "draft" && (
                        <Button
                          onClick={() => openEditor(version.id)}
                          variant="secondary"
                          size="sm"
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "mappings" && (
        <div className="space-y-6">
          {mappingsLoading ? (
            <p className="text-sm text-[var(--acton-muted)]">Loading mappings...</p>
          ) : mappings.length === 0 ? (
            <Card className="p-4">
              <CardDescription>
                No GHL mappings configured. Mappings connect GoHighLevel pipeline stages to rulebook
                steps for monitoring.
              </CardDescription>
            </Card>
          ) : (
            <div className="space-y-3">
              {mappings.map((mapping) => (
                <Card key={mapping.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base">
                        {mapping.ghl_pipeline_name || mapping.ghl_pipeline_id} →{" "}
                        {mapping.ghl_stage_name || mapping.ghl_stage_id}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Maps to: {mapping.rulebook_stage_key}
                        {mapping.rulebook_step_key && ` / ${mapping.rulebook_step_key}`}
                      </CardDescription>
                      {!mapping.enabled && <p className="mt-1 text-xs text-yellow-600">Disabled</p>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "editor" && editingTree && (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingVersionId(null);
                      setEditingTree(null);
                      setTab("overview");
                    }}
                    className="text-[var(--acton-navy)] hover:text-[var(--acton-navy-dark)]"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  Editing Draft v{editingTree.version_number}
                </CardTitle>
                {editingTree.validation_report_json && (
                  <CardDescription className="mt-1 flex items-center gap-2">
                    {editingTree.validation_report_json.valid ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-green-600">Valid</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <span className="text-red-600">
                          {editingTree.validation_report_json.errors.length} error(s)
                        </span>
                      </>
                    )}
                  </CardDescription>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleValidateDraft} variant="secondary" size="sm">
                  Validate
                </Button>
                <Button
                  onClick={handleActivateDraft}
                  variant="primary"
                  size="sm"
                  disabled={!editingTree.validation_report_json?.valid}
                >
                  Activate
                </Button>
              </div>
            </div>

            {editingTree.validation_report_json &&
              editingTree.validation_report_json.errors.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-sm font-semibold text-red-800">Validation Errors:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                    {editingTree.validation_report_json.errors.map((err, i) => (
                      <li key={i}>{err.message}</li>
                    ))}
                  </ul>
                </div>
              )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <CardTitle className="text-sm">Stages</CardTitle>
                <Button onClick={handleAddStage} size="sm" variant="ghost">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {editingTree.stages.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className={`rounded border p-3 ${
                      selectedStageId === stage.id
                        ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                        : "border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSelectedStageId(stage.id);
                        setSelectedStepId(null);
                      }}
                      className="w-full text-left"
                    >
                      <p className="text-sm font-medium">
                        {idx + 1}. {stage.display_name}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          selectedStageId === stage.id
                            ? "text-white/80"
                            : "text-[var(--acton-muted)]"
                        }`}
                      >
                        {stage.steps.length} step{stage.steps.length !== 1 ? "s" : ""}
                      </p>
                    </button>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => handleMoveStage(stage.id, "up")}
                        disabled={idx === 0}
                        className="rounded p-1 hover:bg-white/20 disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleMoveStage(stage.id, "down")}
                        disabled={idx === editingTree.stages.length - 1}
                        className="rounded p-1 hover:bg-white/20 disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleUpdateStage(stage.id)}
                        className="rounded p-1 hover:bg-white/20"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStage(stage.id)}
                        className="rounded p-1 hover:bg-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {selectedStage && (
              <Card className="p-4 lg:col-span-1">
                <div className="mb-3 flex items-center justify-between">
                  <CardTitle className="text-sm">Steps in {selectedStage.display_name}</CardTitle>
                  <Button onClick={() => handleAddStep(selectedStage.id)} size="sm" variant="ghost">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {selectedStage.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className={`rounded border p-3 ${
                        selectedStepId === step.id
                          ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                          : "border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <button
                        onClick={() => setSelectedStepId(step.id)}
                        className="w-full text-left"
                      >
                        <p className="text-sm font-medium">
                          {idx + 1}. {step.display_name}
                        </p>
                      </button>
                      <div className="mt-2 flex gap-1">
                        <button
                          onClick={() => handleMoveStep(step.id, selectedStage.id, "up")}
                          disabled={idx === 0}
                          className="rounded p-1 hover:bg-white/20 disabled:opacity-30"
                          title="Move up"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleMoveStep(step.id, selectedStage.id, "down")}
                          disabled={idx === selectedStage.steps.length - 1}
                          className="rounded p-1 hover:bg-white/20 disabled:opacity-30"
                          title="Move down"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleUpdateStep(step.id)}
                          className="rounded p-1 hover:bg-white/20"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteStep(step.id)}
                          className="rounded p-1 hover:bg-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {selectedStep && (
              <Card className="p-4 lg:col-span-1">
                <CardTitle className="mb-3 text-sm">
                  Step Details: {selectedStep.display_name}
                </CardTitle>

                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[var(--acton-navy)]">RACI</p>
                    <div className="space-y-2">
                      <div>
                        <label className="mb-1 block text-xs text-[var(--acton-muted)]">
                          Responsible
                        </label>
                        <select
                          value={selectedStep.raci.find((r) => r.raci === "R")?.role_key || ""}
                          onChange={(e) =>
                            handleUpdateStepRaci(selectedStep.id, "R", e.target.value || null)
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">None</option>
                          {allRoles.map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.display_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[var(--acton-muted)]">
                          Accountable
                        </label>
                        <select
                          value={selectedStep.raci.find((r) => r.raci === "A")?.role_key || ""}
                          onChange={(e) =>
                            handleUpdateStepRaci(selectedStep.id, "A", e.target.value || null)
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">None</option>
                          {allRoles.map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.display_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[var(--acton-muted)]">
                          Consulted (multi-select with +)
                        </label>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleUpdateStepRaci(selectedStep.id, "C", e.target.value);
                              e.target.value = "";
                            }
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Add...</option>
                          {allRoles.map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.display_name}
                            </option>
                          ))}
                        </select>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {selectedStep.raci
                            .filter((r) => r.raci === "C")
                            .map((r) => (
                              <span
                                key={r.role_key}
                                className="rounded bg-gray-200 px-2 py-1 text-xs"
                              >
                                {r.roleName || r.role_key}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-[var(--acton-muted)]">
                          Informed (multi-select with +)
                        </label>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleUpdateStepRaci(selectedStep.id, "I", e.target.value);
                              e.target.value = "";
                            }
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Add...</option>
                          {allRoles.map((role) => (
                            <option key={role.role_key} value={role.role_key}>
                              {role.display_name}
                            </option>
                          ))}
                        </select>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {selectedStep.raci
                            .filter((r) => r.raci === "I")
                            .map((r) => (
                              <span
                                key={r.role_key}
                                className="rounded bg-gray-200 px-2 py-1 text-xs"
                              >
                                {r.roleName || r.role_key}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-[var(--acton-navy)]">
                        Required Data
                      </p>
                      <Button
                        onClick={() => handleAddDataRequirement(selectedStep.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {selectedStep.data_requirements.map((req) => (
                        <div key={req.id} className="rounded border border-gray-200 p-2">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-xs font-medium">{req.display_name}</p>
                              <div className="mt-1 space-y-1">
                                <select
                                  value={req.source_system}
                                  onChange={(e) =>
                                    handleUpdateDataRequirement(req.id, {
                                      sourceSystem: e.target.value,
                                    })
                                  }
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                >
                                  <option value="ghl">GoHighLevel</option>
                                  <option value="buildertrend">Buildertrend</option>
                                  <option value="knowledge">Knowledge</option>
                                  <option value="manual">Manual</option>
                                </select>
                                {req.source_system === "buildertrend" && (
                                  <p className="text-xs text-yellow-600">
                                    Buildertrend not connected
                                  </p>
                                )}
                                {req.source_system === "ghl" && (
                                  <select
                                    value={req.source_field_path || ""}
                                    onChange={(e) =>
                                      handleUpdateDataRequirement(req.id, {
                                        sourceFieldPath: e.target.value,
                                      })
                                    }
                                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  >
                                    <option value="">Select field...</option>
                                    {ghlFields.map((field) => (
                                      <option key={field.id} value={field.fieldKey}>
                                        {field.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteDataRequirement(req.id)}
                              className="ml-2 rounded p-1 hover:bg-red-100"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3 text-red-600" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>
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
