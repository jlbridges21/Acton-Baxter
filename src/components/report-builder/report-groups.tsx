"use client";

/**
 * Report groups (folders) on /reports: the group bar under the library tabs, the create/edit
 * dialog, the manage dialog, and the "move to group" dialog. Server-side checks in
 * /api/reports/groups decide what's allowed; these controls only reflect them.
 */

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Briefcase,
  Building2,
  ClipboardList,
  DollarSign,
  Folder,
  FolderPlus,
  Hammer,
  Package,
  PencilRuler,
  Settings2,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, Notice, aiFetch, errorMessage, selectClass } from "@/components/ai/ui";
import { cn } from "@/lib/utils";
import type { ReportSummary } from "./types";

export type ReportGroup = {
  id: string;
  name: string;
  description: string;
  color: GroupColor;
  icon: GroupIcon;
  scope: "personal" | "company";
  isMine: boolean;
  canManage: boolean;
  reportCount: number;
  sortOrder: number;
  archived: boolean;
};
export type GroupColor =
  "slate" | "navy" | "teal" | "green" | "amber" | "orange" | "red" | "violet" | "pink" | "sky";
export type GroupIcon =
  | "folder"
  | "chart"
  | "dollar"
  | "package"
  | "pencil"
  | "hammer"
  | "clipboard"
  | "briefcase"
  | "building"
  | "star";

export const COLOR_DOT: Record<GroupColor, string> = {
  slate: "bg-slate-400",
  navy: "bg-[var(--acton-navy)]",
  teal: "bg-teal-600",
  green: "bg-emerald-600",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-600",
  violet: "bg-violet-600",
  pink: "bg-pink-500",
  sky: "bg-sky-500",
};
export const ICONS: Record<GroupIcon, typeof Folder> = {
  folder: Folder,
  chart: BarChart3,
  dollar: DollarSign,
  package: Package,
  pencil: PencilRuler,
  hammer: Hammer,
  clipboard: ClipboardList,
  briefcase: Briefcase,
  building: Building2,
  star: Star,
};

/** "all" = every group; "ungrouped" = reports in none of your groups; otherwise a group id. */
export type GroupFilter = "all" | "ungrouped" | string;

export async function groupCommand<T = unknown>(cmd: Record<string, unknown>): Promise<T> {
  return (
    await aiFetch<{ result: T }>("/api/reports/groups", {
      method: "POST",
      body: JSON.stringify(cmd),
    })
  ).result;
}

export function GroupBar({
  groups,
  selected,
  onSelect,
  counts,
  onNew,
  onManage,
}: {
  groups: ReportGroup[];
  selected: GroupFilter;
  onSelect: (g: GroupFilter) => void;
  counts: { all: number; ungrouped: number; byGroup: Map<string, number> };
  onNew: () => void;
  onManage: () => void;
}) {
  const chip = (key: GroupFilter, label: React.ReactNode, count: number, extra?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => onSelect(key)}
      aria-pressed={selected === key}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
        selected === key
          ? "border-[var(--acton-navy)] bg-[var(--acton-navy)]/5 text-[var(--acton-navy)]"
          : "border-[var(--acton-border)] bg-white text-[var(--acton-navy)] hover:border-[var(--acton-navy)]/40",
        extra,
      )}
    >
      {label}
      <span
        className={cn(
          "rounded px-1 text-xs tabular-nums",
          selected === key
            ? "bg-[var(--acton-navy)] text-white"
            : "bg-[var(--acton-gray-100)] text-[var(--acton-muted)]",
        )}
      >
        {count}
      </span>
    </button>
  );
  return (
    <nav aria-label="Report groups" className="flex items-center gap-1.5 overflow-x-auto pb-1">
      <span className="mr-1 shrink-0 text-[11px] font-bold tracking-wider text-[var(--acton-muted)] uppercase">
        Groups
      </span>
      {chip("all", "All groups", counts.all)}
      {groups.map((g) => {
        const Icon = ICONS[g.icon] ?? Folder;
        return chip(
          g.id,
          <>
            <span className={cn("h-2 w-2 rounded-full", COLOR_DOT[g.color])} aria-hidden />
            <Icon className="h-3.5 w-3.5 text-[var(--acton-muted)]" aria-hidden />
            <span className="max-w-[12rem] truncate" title={g.description || g.name}>
              {g.name}
            </span>
            {g.scope === "company" ? <span className="sr-only">(company group)</span> : null}
          </>,
          counts.byGroup.get(g.id) ?? 0,
        );
      })}
      {chip("ungrouped", "Ungrouped", counts.ungrouped, "border-dashed")}
      <button
        type="button"
        onClick={onNew}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-semibold text-[var(--acton-navy)] hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
      >
        <FolderPlus className="h-4 w-4" aria-hidden /> New group
      </button>
      {groups.some((g) => g.canManage) ? (
        <button
          type="button"
          onClick={onManage}
          aria-label="Manage groups"
          title="Manage groups"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--acton-muted)] hover:bg-white hover:text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </nav>
  );
}

export function GroupDialog({
  group,
  canCreateCompany,
  onClose,
  onSaved,
}: {
  group: ReportGroup | null;
  canCreateCompany: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [color, setColor] = useState<GroupColor>(group?.color ?? "navy");
  const [icon, setIcon] = useState<GroupIcon>(group?.icon ?? "folder");
  const [scope, setScope] = useState<"personal" | "company">(group?.scope ?? "personal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = group
        ? await groupCommand<{ id: string }>({
            op: "update",
            groupId: group.id,
            name,
            description,
            color,
            icon,
            ...(scope !== group.scope ? { scope } : {}),
          })
        : await groupCommand<{ id: string }>({
            op: "create",
            name,
            description,
            color,
            icon,
            scope,
          });
      onSaved(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{group ? "Edit group" : "New report group"}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Name" htmlFor="grp-name">
          <Input
            id="grp-name"
            value={name}
            maxLength={60}
            autoFocus
            placeholder="e.g. Sales"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && void save()}
          />
        </Field>
        <Field label="Description (optional)" htmlFor="grp-desc">
          <Input
            id="grp-desc"
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="text-sm font-semibold text-[var(--acton-navy)]">Color</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(COLOR_DOT) as GroupColor[]).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  "h-7 w-7 rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
                  COLOR_DOT[c],
                  color === c && "ring-2 ring-[var(--acton-navy)]",
                )}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-[var(--acton-navy)]">Icon</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(ICONS) as GroupIcon[]).map((i) => {
              const Icon = ICONS[i];
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={i}
                  aria-pressed={icon === i}
                  onClick={() => setIcon(i)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
                    icon === i
                      ? "border-[var(--acton-navy)] bg-[var(--acton-navy)]/5"
                      : "border-[var(--acton-border)]",
                  )}
                >
                  <Icon className="h-4 w-4 text-[var(--acton-navy)]" aria-hidden />
                </button>
              );
            })}
          </div>
        </fieldset>
        {canCreateCompany || group?.scope === "company" ? (
          <Field
            label="Who sees this group"
            htmlFor="grp-scope"
            help="Company groups show their name to everyone with Reports access. People still only see reports they're allowed to open."
          >
            <select
              id="grp-scope"
              className={selectClass}
              value={scope}
              onChange={(e) => setScope(e.target.value as "personal" | "company")}
            >
              <option value="personal" disabled={group?.scope === "company" && !group.isMine}>
                Only me (personal)
              </option>
              <option value="company" disabled={!canCreateCompany}>
                Everyone with Reports (company)
              </option>
            </select>
          </Field>
        ) : null}
        {group && group.scope === "company" && !group.isMine ? (
          <p className="text-xs text-[var(--acton-muted)]">
            Only the person who created this group can make it personal.
          </p>
        ) : null}
        {group && scope !== group.scope ? (
          <Notice tone="warning">
            {scope === "personal"
              ? "Other people will no longer see this group. Reports in it that only others can open will be taken out of it. No one loses access to any report."
              : "Everyone with Reports access will see this group's name. Its reports stay as private as they are now — only people already allowed to open a report will see it here."}
          </Notice>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !name.trim()} onClick={save}>
          {group ? "Save" : "Create group"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function ManageGroupsDialog({
  groups,
  onClose,
  onChanged,
  onEdit,
}: {
  groups: ReportGroup[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onEdit: (g: ReportGroup) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manageable = groups.filter((g) => g.canManage);
  async function act(cmd: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await groupCommand(cmd);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const active = manageable.filter((g) => !g.archived);
  const move = (i: number, d: -1 | 1) => {
    const ids = active.map((g) => g.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void act({ op: "reorder", groupIds: ids });
  };
  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Manage groups</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <p className="text-sm text-[var(--acton-muted)]">
          Groups only organize reports — they never change who can open a report. A group can be
          archived or deleted once it&apos;s empty.
        </p>
        <ul className="divide-y divide-[var(--acton-border)] rounded-md border border-[var(--acton-border)]">
          {manageable.map((g, i) => (
            <li
              key={g.id}
              className={cn(
                "flex flex-wrap items-center gap-2 px-3 py-2 text-sm",
                g.archived && "opacity-60",
              )}
            >
              <span className={cn("h-2.5 w-2.5 rounded-full", COLOR_DOT[g.color])} aria-hidden />
              <span className="min-w-0 flex-1 font-medium text-[var(--acton-navy)]">
                {g.name}{" "}
                <span className="text-xs font-normal text-[var(--acton-muted)]">
                  {g.scope === "company" ? "· company" : "· personal"} · {g.reportCount} report
                  {g.reportCount === 1 ? "" : "s"}
                  {g.archived ? " · archived" : ""}
                </span>
              </span>
              {!g.archived ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${g.name} up`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${g.name} down`}
                    disabled={busy || i === active.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onEdit(g)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || g.reportCount > 0}
                    title={g.reportCount ? "Move its reports out first" : undefined}
                    onClick={() => act({ op: "archive", groupId: g.id })}
                  >
                    Archive
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act({ op: "restore", groupId: g.id })}
                >
                  Restore
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                disabled={busy || g.reportCount > 0}
                title={g.reportCount ? "Move its reports out first" : undefined}
                onClick={() => {
                  if (window.confirm(`Delete the empty group "${g.name}"?`))
                    void act({ op: "delete", groupId: g.id });
                }}
              >
                Delete
              </Button>
            </li>
          ))}
          {manageable.length === 0 ? (
            <li className="px-3 py-4 text-sm text-[var(--acton-muted)]">
              You don&apos;t manage any groups yet.
            </li>
          ) : null}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Move one report (or pick reports to move into a group). */
export function MoveDialog({
  report,
  groups,
  onClose,
  onMoved,
}: {
  report: ReportSummary;
  groups: ReportGroup[];
  onClose: () => void;
  onMoved: () => Promise<void>;
}) {
  const current = groups.filter((g) => report.groupIds.includes(g.id));
  const [target, setTarget] = useState<string>(current[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = groups.filter(
    (g) => !g.archived && (g.scope === "personal" ? g.canManage : report.permission.canEdit),
  );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!target) await groupCommand({ op: "ungroup", reportId: report.id });
      else await groupCommand({ op: "assign", reportId: report.id, groupId: target });
      await onMoved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Move “{report.title}”</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field
          label="Group"
          htmlFor="move-group"
          help={
            report.permission.canEdit
              ? "Moving a report never changes who can open it."
              : "You can view but not edit this report, so it can only go in your personal groups."
          }
        >
          <select
            id="move-group"
            className={selectClass}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Ungrouped</option>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.scope === "company" ? " (company)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={save}>
          Move
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Pick existing reports to file into a group (used from the empty-group state). */
export function AddReportsDialog({
  group,
  reports,
  onClose,
  onDone,
}: {
  group: ReportGroup;
  reports: ReportSummary[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const eligible = reports.filter(
    (r) =>
      r.status === "active" &&
      !r.isTemplate &&
      !r.groupIds.includes(group.id) &&
      (group.scope === "personal" || r.permission.canEdit),
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      for (const id of picked)
        await groupCommand({ op: "assign", reportId: id, groupId: group.id });
      await onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add reports to {group.name}</DialogTitle>
      </DialogHeader>
      <DialogBody className="max-h-[60vh] space-y-2 overflow-y-auto">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {eligible.length === 0 ? (
          <p className="text-sm text-[var(--acton-muted)]">No other reports can be added here.</p>
        ) : null}
        {eligible.map((r) => (
          <label
            key={r.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--acton-gray-50)]"
          >
            <input
              type="checkbox"
              checked={picked.includes(r.id)}
              onChange={(e) =>
                setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))
              }
            />
            <span className="min-w-0 flex-1 truncate text-[var(--acton-navy)]">{r.title}</span>
            {r.groupIds.length ? (
              <span className="text-xs text-[var(--acton-muted)]">moves from another group</span>
            ) : null}
          </label>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || picked.length === 0} onClick={save}>
          Add {picked.length || ""}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
