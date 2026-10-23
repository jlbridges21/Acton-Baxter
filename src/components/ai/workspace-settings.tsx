"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkspaceSettings } from "@/lib/agents/admin";
import type { DepartmentRow } from "@/lib/agents/types";
import type { OfficeAnimationSettings } from "@/lib/office/animation-settings";
import { SPRITE_PACKS, STATIC_PACK_ID, resolvePackId } from "@/lib/office/sprite-pack";
import { Field, Notice, aiFetch, errorMessage, selectClass } from "./ui";

type AgentOption = { id: string; name: string; title: string; kind: "orchestrator" | "specialist" };

export function WorkspaceSettingsForm({
  initialSettings,
  initialDepartments,
  initialAnimation,
  agents,
}: {
  initialSettings: WorkspaceSettings;
  initialDepartments: DepartmentRow[];
  initialAnimation: OfficeAnimationSettings;
  agents: AgentOption[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [animation, setAnimation] = useState(initialAnimation);
  const [animationBusy, setAnimationBusy] = useState(false);
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

  async function saveAnimation() {
    setAnimationBusy(true);
    setNotice(null);
    try {
      await aiFetch<{ settings: WorkspaceSettings }>("/api/ai/workspace", {
        method: "PATCH",
        body: JSON.stringify({ animation_settings: animation }),
      });
      setNotice({ tone: "success", text: "Office animation settings saved." });
    } catch (e) {
      setNotice({ tone: "error", text: errorMessage(e) });
    } finally {
      setAnimationBusy(false);
    }
  }

  const setAgentAnimation = (agentId: string, patch: OfficeAnimationSettings["agents"][string]) =>
    setAnimation((a) => ({
      ...a,
      agents: { ...a.agents, [agentId]: { ...a.agents[agentId], ...patch } },
    }));

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
        <CardTitle>Office animation</CardTitle>
        <CardDescription>
          How animated characters behave when they have no real work. Task activity (hand-offs,
          working, results) always animates and always reflects real task records. Viewers can still
          turn animation down for themselves.
        </CardDescription>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Idle activity" help="How often Baxter walks around, sits, and looks about.">
            <select
              className={selectClass}
              value={animation.ambient_intensity}
              onChange={(e) =>
                setAnimation({
                  ...animation,
                  ambient_intensity: e.target.value as OfficeAnimationSettings["ambient_intensity"],
                })
              }
            >
              <option value="off">Off — stay put</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Walking speed">
            <select
              className={selectClass}
              value={animation.speed}
              onChange={(e) =>
                setAnimation({
                  ...animation,
                  speed: e.target.value as OfficeAnimationSettings["speed"],
                })
              }
            >
              <option value="relaxed">Relaxed</option>
              <option value="normal">Normal</option>
              <option value="brisk">Brisk</option>
            </select>
          </Field>
          <Field
            label="Resting spot"
            help="Where characters return to when idle activity is off or after a hand-off."
          >
            <select
              className={selectClass}
              value={animation.home_spot}
              onChange={(e) =>
                setAnimation({
                  ...animation,
                  home_spot: e.target.value as OfficeAnimationSettings["home_spot"],
                })
              }
            >
              <option value="desk">At their desk</option>
              <option value="window">By the window</option>
              <option value="center">Middle of the office</option>
            </select>
          </Field>
        </div>
        {agents.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3">Appearance</th>
                  <th className="py-2">Where visitors stand</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-t border-[var(--acton-border)]">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-[var(--acton-navy)]">{agent.name}</span>
                      <span className="block text-xs text-[var(--acton-muted)]">{agent.title}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className={selectClass}
                        aria-label={`Appearance for ${agent.name}`}
                        value={resolvePackId(agent, animation.agents) ?? STATIC_PACK_ID}
                        onChange={(e) =>
                          setAgentAnimation(agent.id, { sprite_pack: e.target.value })
                        }
                      >
                        <option value={STATIC_PACK_ID}>Portrait at a desk (no animation)</option>
                        {Object.values(SPRITE_PACKS).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <select
                        className={selectClass}
                        aria-label={`Hand-off spot for ${agent.name}`}
                        value={animation.agents[agent.id]?.handoff_side ?? "auto"}
                        onChange={(e) =>
                          setAgentAnimation(agent.id, {
                            handoff_side: e.target.value as "auto" | "left" | "right" | "front",
                          })
                        }
                      >
                        <option value="auto">Automatic</option>
                        <option value="right">Right of their desk</option>
                        <option value="left">Left of their desk</option>
                        <option value="front">In front of their desk</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Button type="button" onClick={saveAnimation} disabled={animationBusy}>
          {animationBusy ? "Saving…" : "Save animation settings"}
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
