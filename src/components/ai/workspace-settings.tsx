"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkspaceSettings } from "@/lib/agents/admin";
import type { DepartmentRow } from "@/lib/agents/types";
import { Field, Notice, aiFetch, errorMessage, selectClass } from "./ui";

export function WorkspaceSettingsForm({
  initialSettings,
  initialDepartments,
}: {
  initialSettings: WorkspaceSettings;
  initialDepartments: DepartmentRow[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [departments, setDepartments] = useState(initialDepartments);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDept, setNewDept] = useState({ name: "", color: "#2f6f5e" });

  async function saveSettings() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await aiFetch<{ settings: WorkspaceSettings }>("/api/ai/workspace", {
        method: "PATCH",
        body: JSON.stringify({
          layout_preset: settings.layout_preset,
          theme: settings.theme,
          show_meeting_area: settings.show_meeting_area,
          show_future_space: settings.show_future_space,
          area_labels: Object.fromEntries(
            Object.entries(settings.area_labels).filter(([, v]) => v.trim()),
          ),
        }),
      });
      setSettings(res.settings);
      setNotice({ tone: "success", text: "Office settings saved." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function saveDepartment(d: Partial<DepartmentRow> & { name: string }) {
    setNotice(null);
    try {
      const res = await aiFetch<{ department: DepartmentRow }>("/api/ai/departments", {
        method: "POST",
        body: JSON.stringify({
          id: d.id,
          name: d.name,
          description: d.description ?? null,
          color: d.color ?? "#1e3a5f",
          is_visible: d.is_visible ?? true,
        }),
      });
      setDepartments((prev) =>
        d.id ? prev.map((x) => (x.id === d.id ? res.department : x)) : [...prev, res.department],
      );
      setNotice({ tone: "success", text: `Saved ${res.department.name}.` });
      if (!d.id) setNewDept({ name: "", color: "#2f6f5e" });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    }
  }

  const label = (key: string) => settings.area_labels[key] ?? "";
  const setLabel = (key: string, value: string) =>
    setSettings({ ...settings, area_labels: { ...settings.area_labels, [key]: value } });

  return (
    <div className="space-y-6">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <Card className="space-y-4">
        <CardTitle>Office appearance</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Layout"
            help="Curated layouts — rooms appear automatically for departments with agents."
          >
            <select
              className={selectClass}
              value={settings.layout_preset}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  layout_preset: e.target.value as WorkspaceSettings["layout_preset"],
                })
              }
            >
              <option value="studio">Studio — two columns</option>
              <option value="campus">Campus — three columns, roomy</option>
              <option value="compact">Compact — one row</option>
            </select>
          </Field>
          <Field label="Theme">
            <select
              className={selectClass}
              value={settings.theme}
              onChange={(e) =>
                setSettings({ ...settings, theme: e.target.value as WorkspaceSettings["theme"] })
              }
            >
              <option value="daylight">Daylight</option>
              <option value="evening">Evening</option>
              <option value="blueprint">Blueprint</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.show_meeting_area}
            onChange={(e) => setSettings({ ...settings, show_meeting_area: e.target.checked })}
          />{" "}
          Show the shared meeting room
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.show_future_space}
            onChange={(e) => setSettings({ ...settings, show_future_space: e.target.checked })}
          />{" "}
          Show space for future departments
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meeting room name">
            <Input
              value={label("meeting")}
              placeholder="Meeting room"
              onChange={(e) => setLabel("meeting", e.target.value)}
            />
          </Field>
          <Field label="Future space name">
            <Input
              value={label("future")}
              placeholder="Space for future departments"
              onChange={(e) => setLabel("future", e.target.value)}
            />
          </Field>
          {departments.map((d) => (
            <Field key={d.id} label={`Room name for ${d.name}`}>
              <Input
                value={label(d.id)}
                placeholder={d.name}
                onChange={(e) => setLabel(d.id, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <Button type="button" onClick={saveSettings} disabled={busy}>
          {busy ? "Saving…" : "Save office settings"}
        </Button>
      </Card>

      <Card className="space-y-4">
        <CardTitle>AI departments</CardTitle>
        <CardDescription>
          Departments group agents in the office and directory. They are separate from employee
          departments.
        </CardDescription>
        <ul className="space-y-3">
          {departments.map((d) => (
            <li
              key={d.id}
              className="grid gap-3 rounded-md border border-[var(--acton-border)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_80px_auto_auto] sm:items-end"
            >
              <Field label="Name">
                <Input
                  defaultValue={d.name}
                  onBlur={(e) =>
                    e.target.value !== d.name && saveDepartment({ ...d, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Description">
                <Input
                  defaultValue={d.description ?? ""}
                  onBlur={(e) =>
                    e.target.value !== (d.description ?? "") &&
                    saveDepartment({ ...d, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Color">
                <input
                  type="color"
                  defaultValue={d.color}
                  onBlur={(e) =>
                    e.target.value !== d.color && saveDepartment({ ...d, color: e.target.value })
                  }
                  className="h-11 w-full rounded-md border border-[var(--acton-border)]"
                />
              </Field>
              <label className="flex h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={d.is_visible}
                  onChange={(e) => saveDepartment({ ...d, is_visible: e.target.checked })}
                />{" "}
                Visible
              </label>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 border-t border-[var(--acton-border)] pt-4 sm:grid-cols-[minmax(0,1fr)_80px_auto] sm:items-end">
          <Field label="New department">
            <Input
              value={newDept.name}
              onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
              placeholder="e.g. Finance"
            />
          </Field>
          <Field label="Color">
            <input
              type="color"
              value={newDept.color}
              onChange={(e) => setNewDept({ ...newDept, color: e.target.value })}
              className="h-11 w-full rounded-md border border-[var(--acton-border)]"
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={!newDept.name.trim()}
            onClick={() =>
              saveDepartment({ name: newDept.name, color: newDept.color, is_visible: true })
            }
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
