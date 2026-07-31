"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isActonEmail } from "@/lib/project-setup/names";
import type { ProjectSetupRun, ProjectSetupSettings } from "@/lib/project-setup/types";
import type { ProjectSetupSettingsWarnings } from "@/lib/project-setup/validation";

type SettingsForm = {
  memberEmails: string[];
  testMode: boolean;
  testMemberEmails: string[];
  templateFolderId: string;
  projectsParentFolderId: string;
  masterCharterSpreadsheetId: string;
  masterLogTabName: string;
};

function toForm(settings: ProjectSetupSettings): SettingsForm {
  return {
    memberEmails: settings.memberEmails,
    testMode: settings.testMode,
    testMemberEmails: settings.testMemberEmails,
    templateFolderId: settings.templateFolderId,
    projectsParentFolderId: settings.projectsParentFolderId,
    masterCharterSpreadsheetId: settings.masterCharterSpreadsheetId,
    masterLogTabName: settings.masterLogTabName,
  };
}

export function ProjectSetupAdminClient({
  initialSettings,
  initialRuns,
  initialWarnings,
}: {
  initialSettings: ProjectSetupSettings;
  initialRuns: ProjectSetupRun[];
  initialWarnings: ProjectSetupSettingsWarnings;
}) {
  const [settings, setSettings] = useState<SettingsForm>(() => toForm(initialSettings));
  const [runs] = useState(initialRuns);
  const [warnings, setWarnings] = useState(initialWarnings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/project-setup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = (await response.json()) as {
        settings?: ProjectSetupSettings;
        warnings?: ProjectSetupSettingsWarnings;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? "Save failed");
      if (payload.settings) setSettings(toForm(payload.settings));
      if (payload.warnings) setWarnings(payload.warnings);
      setSavedMsg("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <CardTitle>Project setup settings</CardTitle>
          <CardDescription className="mt-2">
            Standing Slack invite list, test mode, and Google IDs for the Master Project Log /
            template folder. Prompt 1 runs dry-run only — leave test mode ON until Prompt 3.
          </CardDescription>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.testMode}
            onChange={(e) => setSettings({ ...settings, testMode: e.target.checked })}
          />
          <span className="font-medium text-[var(--acton-navy)]">Test mode</span>
          <span className="text-[var(--acton-muted)]">
            (invite test members only when Slack provisioning is live)
          </span>
        </label>

        <EmailListEditor
          title="Standing member emails"
          emails={settings.memberEmails}
          onChange={(memberEmails) => setSettings({ ...settings, memberEmails })}
          warnings={warnings.nonActonMemberEmails}
        />

        <EmailListEditor
          title="Test member emails"
          emails={settings.testMemberEmails}
          onChange={(testMemberEmails) => setSettings({ ...settings, testMemberEmails })}
          warnings={warnings.nonActonTestMemberEmails}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Template folder ID</span>
            <Input
              value={settings.templateFolderId}
              onChange={(e) => setSettings({ ...settings, templateFolderId: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Projects parent folder ID</span>
            <Input
              value={settings.projectsParentFolderId}
              onChange={(e) => setSettings({ ...settings, projectsParentFolderId: e.target.value })}
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="mb-1 block font-medium">Master charter spreadsheet ID</span>
            <Input
              value={settings.masterCharterSpreadsheetId}
              onChange={(e) =>
                setSettings({ ...settings, masterCharterSpreadsheetId: e.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Master Project Log tab name</span>
            <Input
              value={settings.masterLogTabName}
              onChange={(e) => setSettings({ ...settings, masterLogTabName: e.target.value })}
            />
          </label>
        </div>

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {savedMsg ? <p className="text-sm text-emerald-800">{savedMsg}</p> : null}

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          Save settings
        </Button>
      </Card>

      <Card>
        <CardTitle>Recent runs</CardTitle>
        <CardDescription className="mt-2">Latest project setup dry-runs.</CardDescription>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--acton-muted)]">No runs yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--acton-border)]">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link
                    href={`/projects/setup/${run.id}`}
                    className="font-semibold text-[var(--acton-navy)] underline-offset-2 hover:underline"
                  >
                    {run.projectNumber ?? "—"} · {run.contactSnapshot?.name ?? run.projectLastName}
                  </Link>
                  <p className="text-xs text-[var(--acton-muted)]">
                    {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {run.dryRun ? <Badge tone="amber">Dry-run</Badge> : null}
                  <Badge
                    tone={
                      run.status === "complete" ? "green" : run.status === "failed" ? "red" : "blue"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EmailListEditor({
  title,
  emails,
  onChange,
  warnings,
}: {
  title: string;
  emails: string[];
  onChange: (next: string[]) => void;
  warnings: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--acton-navy)]">{title}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...emails, ""])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {emails.map((email, index) => {
          const warn = email.trim() && !isActonEmail(email);
          return (
            <div key={`${index}-${email}`} className="flex gap-2">
              <Input
                value={email}
                onChange={(e) => {
                  const next = [...emails];
                  next[index] = e.target.value;
                  onChange(next);
                }}
                className={warn ? "border-amber-500" : undefined}
                placeholder="name@actonadu.com"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Remove email"
                onClick={() => onChange(emails.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      {warnings.length > 0 ? (
        <p className="mt-2 text-xs text-amber-800">
          Warning: not @actonadu.com — {warnings.join(", ")} (allowed, but review carefully)
        </p>
      ) : null}
    </div>
  );
}
