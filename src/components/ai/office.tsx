"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  Crosshair,
  Hourglass,
  LayoutList,
  Map as MapIcon,
  Mail,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  computeOfficeLayout,
  type LayoutPreset,
  type OfficeDepartment,
} from "@/lib/agents/office-layout";
import type { AgentCard } from "@/lib/agents/views";
import type { TaskSummary } from "@/lib/agents/task-format";
import { cn } from "@/lib/utils";
import {
  AgentAvatar,
  AgentStatusPill,
  RUNTIME_STATE_LABELS,
  RuntimePill,
  TaskStatusPill,
  aiFetch,
  formatRelative,
} from "./ui";

export type OfficeSettings = {
  layout_preset: LayoutPreset;
  theme: "daylight" | "evening" | "blueprint";
  show_meeting_area: boolean;
  show_future_space: boolean;
  area_labels: Record<string, string>;
};

type StatusRow = {
  agentId: string;
  state: string;
  activeTaskCount: number;
  lastCompletedAt: string | null;
  updatedAt: string;
};

type StatusPayload = { statuses: StatusRow[]; recent: TaskSummary[]; serverTime: string };

const JUST_FINISHED_MS = 45_000;
const MOTION_KEY = "baxter.aiOffice.reducedMotion";

/** Display state: the persisted runtime state, plus "completed" briefly after a real completion. */
export function displayState(status: StatusRow | undefined, now: number): string {
  if (!status) return "idle";
  if (
    status.state === "idle" &&
    status.lastCompletedAt &&
    now - new Date(status.lastCompletedAt).getTime() < JUST_FINISHED_MS
  ) {
    return "completed";
  }
  return status.state;
}

function StateBubble({ state }: { state: string }) {
  if (state === "idle") return null;
  const icon =
    state === "working" ? (
      <span className="ai-office-dots font-mono text-sm leading-none font-bold" aria-hidden />
    ) : state === "receiving" ? (
      <Mail className="h-3.5 w-3.5" aria-hidden />
    ) : state === "awaiting_result" ? (
      <Hourglass className="h-3.5 w-3.5" aria-hidden />
    ) : state === "awaiting_approval" ? (
      <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
    ) : state === "completed" ? (
      <Check className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
    );
  const tone =
    state === "failed" || state === "blocked"
      ? "bg-red-600 text-white"
      : state === "completed"
        ? "bg-emerald-600 text-white"
        : "bg-white text-[#2b2118]";
  return (
    <span
      className={cn(
        "ai-office-bubble absolute -top-9 left-1/2 flex h-7 min-w-7 -translate-x-1/2 items-center justify-center border-2 border-[#2b2118] px-1.5",
        tone,
      )}
      style={{ boxShadow: "2px 2px 0 #2b2118" }}
    >
      {icon}
    </span>
  );
}

function AgentSprite({
  agent,
  state,
  x,
  y,
  selected,
  onSelect,
}: {
  agent: AgentCard;
  state: string;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = RUNTIME_STATE_LABELS[state]?.label ?? state;
  const working = state === "working" || state === "receiving";
  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerDown={(e) => e.stopPropagation()}
      data-anim={working ? "working" : state === "idle" ? undefined : "bubble"}
      aria-pressed={selected}
      aria-label={`${agent.name}, ${agent.title}. ${label}.`}
      className="group absolute flex flex-col items-center focus-visible:outline-none"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      <span className="relative flex flex-col items-center">
        <StateBubble state={state} />
        {/* Character: portrait head + pixel torso */}
        <span className="ai-office-body relative z-10 flex flex-col items-center">
          <span
            className={cn(
              "rounded-full border-[3px] border-[#2b2118] bg-white",
              selected
                ? "ring-4 ring-[var(--acton-yellow)]"
                : "group-focus-visible:ring-4 group-focus-visible:ring-[var(--acton-yellow)]",
            )}
          >
            <AgentAvatar
              name={agent.name}
              url={agent.avatarUrl}
              size={40}
              color={agent.departmentColor}
            />
          </span>
          <span
            className="-mt-1 h-5 w-9 border-[3px] border-t-0 border-[#2b2118]"
            style={{ background: agent.departmentColor ?? "#1e3a5f" }}
            aria-hidden
          />
        </span>
        {/* Desk + monitor */}
        <span className="relative -mt-1 flex h-8 w-24 justify-center" aria-hidden>
          <span
            className="absolute inset-x-0 top-2 h-6 border-[3px] border-[#2b2118]"
            style={{
              background: "var(--office-desk)",
              boxShadow: "inset 0 4px 0 var(--office-desk-top)",
            }}
          />
          <span
            className="ai-office-screen absolute top-0 left-1 h-5 w-7 border-[3px] border-[#2b2118]"
            style={{ background: working ? "var(--office-screen-on)" : "var(--office-screen)" }}
          />
        </span>
      </span>
      <span
        className="mt-1 border-2 border-[#2b2118] px-1.5 py-px text-[11px] leading-tight font-bold text-[#2b2118]"
        style={{ background: "var(--office-label-bg)" }}
      >
        {agent.name}
      </span>
    </button>
  );
}

function RoomDecor({ kind, w, h }: { kind: string; w: number; h: number }) {
  if (kind === "meeting") {
    return (
      <span aria-hidden>
        <span
          className="absolute border-[3px] border-[#2b2118]"
          style={{
            left: w * 0.25,
            top: h * 0.4,
            width: w * 0.5,
            height: h * 0.3,
            background: "var(--office-desk)",
            boxShadow: "inset 0 5px 0 var(--office-desk-top)",
          }}
        />
        {[0.3, 0.45, 0.6].map((f) => (
          <span
            key={f}
            className="absolute h-4 w-4 border-[3px] border-[#2b2118] bg-[#7a8b99]"
            style={{ left: w * f, top: h * 0.3 }}
          />
        ))}
      </span>
    );
  }
  return (
    <span aria-hidden>
      {/* Plant + bookshelf */}
      <span
        className="absolute h-6 w-6 rounded-full border-[3px] border-[#2b2118] bg-[#3f8f4f]"
        style={{ right: 14, top: 40 }}
      />
      <span
        className="absolute h-4 w-4 border-[3px] border-[#2b2118] bg-[#a0522d]"
        style={{ right: 18, top: 58 }}
      />
      <span
        className="absolute border-[3px] border-[#2b2118]"
        style={{
          left: 14,
          top: 40,
          width: 44,
          height: 26,
          background:
            "repeating-linear-gradient(90deg,#b5523b 0 6px,#3c6e9f 6px 12px,#d9a441 12px 18px)",
        }}
      />
    </span>
  );
}

export function AiOffice(props: {
  initialAgents: AgentCard[];
  departments: OfficeDepartment[];
  settings: OfficeSettings;
  initialStatus: StatusPayload;
  canAdminister: boolean;
}) {
  const [agents] = useState(props.initialAgents);
  const [status, setStatus] = useState(props.initialStatus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"office" | "list">("office");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<"realtime" | "polling">("polling");
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layout = useMemo(
    () =>
      computeOfficeLayout({
        preset: props.settings.layout_preset,
        departments: props.departments,
        agents: agents
          .filter((a) => a.status !== "archived")
          .map((a) => ({ id: a.id, kind: a.kind, departmentId: a.departmentId, desk: a.desk })),
        showMeetingArea: props.settings.show_meeting_area,
        showFutureSpace: props.settings.show_future_space,
        labels: props.settings.area_labels,
      }),
    [agents, props.departments, props.settings],
  );

  const statusById = useMemo(() => new Map(status.statuses.map((s) => [s.agentId, s])), [status]);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MOTION_KEY);
      const prefers = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a per-viewer preference
      setReducedMotion(stored ? stored === "true" : Boolean(prefers));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await aiFetch<StatusPayload>("/api/ai/status"));
      setNow(Date.now());
    } catch {
      /* keep last known state */
    }
  }, []);

  // Live updates: Realtime on the non-sensitive runtime table...
  useEffect(() => {
    let disposed = false;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      channel = createClient()
        .channel("ai-office-runtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "ai_agent_runtime_status" },
          () => {
            void refresh();
          },
        )
        .subscribe((s: string) => {
          if (!disposed) setLive(s === "SUBSCRIBED" ? "realtime" : "polling");
        });
    } catch {
      /* Realtime unavailable; polling below covers it. */
    }
    return () => {
      disposed = true;
      if (channel) void channel.unsubscribe();
    };
  }, [refresh]);

  // ...with a slow, visibility-aware fallback poll (no model calls — reads persisted state only).
  useEffect(() => {
    const interval = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      live === "realtime" ? 60_000 : 15_000,
    );
    const tick = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(tick);
    };
  }, [refresh, live]);

  function setMotion(value: boolean) {
    setReducedMotion(value);
    try {
      window.localStorage.setItem(MOTION_KEY, String(value));
    } catch {
      /* ignore */
    }
  }

  const centerOn = useCallback(
    (x: number, y: number, z = zoom) => {
      const vp = viewportRef.current;
      if (!vp) return;
      setPan({ x: vp.clientWidth / 2 - x * z, y: vp.clientHeight / 2 - y * z });
    },
    [zoom],
  );

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const z = Math.max(
      0.4,
      Math.min(1.2, Math.min(vp.clientWidth / layout.width, vp.clientHeight / layout.height)),
    );
    setZoom(z);
    setPan({
      x: (vp.clientWidth - layout.width * z) / 2,
      y: Math.max(8, (vp.clientHeight - layout.height * z) / 2),
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    if (view === "office") fit();
  }, [fit, view]);

  function goToBaxter() {
    const baxter = agents.find((a) => a.kind === "orchestrator");
    const seat = layout.seats.find((s) => s.agentId === baxter?.id);
    if (!baxter || !seat) return;
    const z = Math.max(zoom, 1);
    setZoom(z);
    centerOn(seat.x, seat.y, z);
    setSelectedId(baxter.id);
  }

  function zoomBy(factor: number) {
    const vp = viewportRef.current;
    const next = Math.max(0.4, Math.min(2, zoom * factor));
    if (vp) {
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      setPan((p) => ({ x: cx - ((cx - p.x) / zoom) * next, y: cy - ((cy - p.y) / zoom) * next }));
    }
    setZoom(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = 60;
    if (e.key === "ArrowLeft") setPan((p) => ({ ...p, x: p.x + step }));
    else if (e.key === "ArrowRight") setPan((p) => ({ ...p, x: p.x - step }));
    else if (e.key === "ArrowUp") setPan((p) => ({ ...p, y: p.y + step }));
    else if (e.key === "ArrowDown") setPan((p) => ({ ...p, y: p.y - step }));
    else if (e.key === "+" || e.key === "=") zoomBy(1.2);
    else if (e.key === "-") zoomBy(1 / 1.2);
    else return;
    e.preventDefault();
  }

  const selected = selectedId ? (agentById.get(selectedId) ?? null) : null;
  const selectedState = selected ? displayState(statusById.get(selected.id), now) : "idle";
  const selectedTasks = selected
    ? status.recent.filter((t) => t.assignedAgentId === selected.id).slice(0, 5)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-md border border-[var(--acton-border)] bg-white p-0.5"
          role="group"
          aria-label="View"
        >
          <button
            type="button"
            onClick={() => setView("office")}
            aria-pressed={view === "office"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
              view === "office" ? "bg-[var(--acton-navy)] text-white" : "text-[var(--acton-navy)]",
            )}
          >
            <MapIcon className="h-4 w-4" aria-hidden /> Office
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
              view === "list" ? "bg-[var(--acton-navy)] text-white" : "text-[var(--acton-navy)]",
            )}
          >
            <LayoutList className="h-4 w-4" aria-hidden /> List
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--acton-muted)]">
          <span title="How this page gets status updates">
            {live === "realtime" ? "Live updates on" : "Updating every 15 seconds"}
          </span>
          <label className="inline-flex items-center gap-1.5 font-medium text-[var(--acton-navy)]">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setMotion(e.target.checked)}
            />
            Reduce motion
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {view === "office" ? (
          <div className="relative">
            <div
              ref={viewportRef}
              role="application"
              aria-roledescription="Interactive office map"
              aria-label="AI Office. Drag or use arrow keys to move, plus and minus to zoom. Select an agent to see details."
              tabIndex={0}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (d) setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
              }}
              onPointerUp={() => (dragRef.current = null)}
              onPointerCancel={() => (dragRef.current = null)}
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
              }}
              data-theme={props.settings.theme}
              data-reduced-motion={reducedMotion ? "true" : "false"}
              className="ai-office relative h-[62vh] min-h-[420px] cursor-grab touch-none overflow-hidden rounded-lg border-4 border-[#2b2118] select-none focus-visible:ring-4 focus-visible:ring-[var(--acton-yellow)] focus-visible:outline-none active:cursor-grabbing"
              style={{ background: "var(--office-bg)" }}
            >
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
              >
                {layout.rooms.map((room) => (
                  <div
                    key={room.key}
                    className={cn(
                      "absolute",
                      room.kind === "future"
                        ? "border-4 border-dashed"
                        : "ai-office-floor border-[6px]",
                    )}
                    style={{
                      left: room.x,
                      top: room.y,
                      width: room.w,
                      height: room.h,
                      borderColor: room.kind === "future" ? "#8a8f98" : "var(--office-room-border)",
                      boxShadow:
                        room.kind === "future"
                          ? undefined
                          : `inset 0 18px 0 var(--office-wall), 4px 4px 0 #2b2118`,
                    }}
                  >
                    <span
                      className="absolute -top-4 left-3 border-2 border-[#2b2118] px-2 py-0.5 text-xs font-bold text-white"
                      style={{ background: room.color }}
                    >
                      {room.label}
                    </span>
                    {room.kind === "future" ? (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm font-semibold text-[#4b5058]">
                        Room for new departments
                        {props.canAdminister ? (
                          <Link
                            href="/ai/agents/new"
                            onPointerDown={(e) => e.stopPropagation()}
                            className="rounded border-2 border-[#2b2118] bg-white px-2 py-1 text-xs text-[#2b2118]"
                          >
                            Add an agent
                          </Link>
                        ) : null}
                      </span>
                    ) : (
                      <RoomDecor kind={room.kind} w={room.w} h={room.h} />
                    )}
                  </div>
                ))}
                {layout.seats.map((seat) => {
                  const agent = agentById.get(seat.agentId);
                  if (!agent) return null;
                  return (
                    <AgentSprite
                      key={seat.agentId}
                      agent={agent}
                      state={displayState(statusById.get(agent.id), now)}
                      x={seat.x}
                      y={seat.y}
                      selected={selectedId === agent.id}
                      onSelect={() => setSelectedId(agent.id)}
                    />
                  );
                })}
              </div>
            </div>
            <div className="absolute right-3 bottom-3 flex gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => zoomBy(1.2)}
                aria-label="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => zoomBy(1 / 1.2)}
                aria-label="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="secondary" onClick={fit}>
                Fit
              </Button>
              <Button size="sm" variant="accent" onClick={goToBaxter}>
                <Crosshair className="h-4 w-4" /> Baxter
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--acton-border)] bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Agents and their current status</caption>
              <thead className="bg-[var(--acton-gray-50)] text-xs text-[var(--acton-muted)] uppercase">
                <tr>
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">Department</th>
                  <th className="px-4 py-2">Right now</th>
                  <th className="px-4 py-2">Open tasks</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const s = statusById.get(agent.id);
                  return (
                    <tr key={agent.id} className="border-t border-[var(--acton-border)]">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(agent.id)}
                          className="flex items-center gap-3 text-left font-semibold text-[var(--acton-navy)] hover:underline"
                        >
                          <AgentAvatar
                            name={agent.name}
                            url={agent.avatarUrl}
                            size={32}
                            color={agent.departmentColor}
                          />
                          <span>
                            {agent.name}
                            <span className="block text-xs font-normal text-[var(--acton-muted)]">
                              {agent.title}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[var(--acton-muted)]">
                        {agent.department ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RuntimePill state={displayState(s, now)} />
                      </td>
                      <td className="px-4 py-3">{s?.activeTaskCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <aside className="space-y-4" aria-label="Details">
          {selected ? (
            <section
              className="rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm"
              aria-live="polite"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <AgentAvatar
                    name={selected.name}
                    url={selected.avatarUrl}
                    size={56}
                    color={selected.departmentColor}
                  />
                  <div>
                    <h2 className="text-lg font-bold text-[var(--acton-navy)]">{selected.name}</h2>
                    <p className="text-sm text-[var(--acton-muted)]">{selected.title}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close details"
                  className="rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--acton-muted)]">Right now</dt>
                  <dd>
                    <RuntimePill state={selectedState} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--acton-muted)]">Availability</dt>
                  <dd>
                    <AgentStatusPill status={selected.status} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--acton-muted)]">Department</dt>
                  <dd className="text-right font-medium text-[var(--acton-navy)]">
                    {selected.department ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--acton-muted)]">Reports to</dt>
                  <dd className="font-medium text-[var(--acton-navy)]">
                    {selected.managerName ?? "Acton ADU leadership"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--acton-muted)]">Last finished</dt>
                  <dd className="font-medium text-[var(--acton-navy)]">
                    {formatRelative(statusById.get(selected.id)?.lastCompletedAt)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-[var(--acton-navy)]">{selected.description}</p>
              {selectedTasks.length ? (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                    Recent tasks you can see
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {selectedTasks.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/ai/tasks/${t.id}`}
                          className="flex items-center justify-between gap-2 text-sm hover:underline"
                        >
                          <span className="truncate">{t.title || "Task"}</span>
                          <TaskStatusPill status={t.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/ai/agents/${selected.slug}`}
                  className="inline-flex h-8 items-center rounded-md bg-[var(--acton-navy)] px-3 text-xs font-semibold text-white"
                >
                  Open profile
                </Link>
                {selected.kind === "specialist" && selected.access.includes("direct_chat") ? (
                  <Link
                    href={`/ai/agents/${selected.slug}?tab=chat`}
                    className="inline-flex h-8 items-center rounded-md border border-[var(--acton-border)] px-3 text-xs font-semibold text-[var(--acton-navy)]"
                  >
                    Chat with {selected.name}
                  </Link>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-[var(--acton-border)] bg-white p-4 text-sm text-[var(--acton-muted)] shadow-sm">
              Select an agent to see who they are and what they&apos;re doing. Agents only animate
              when they have real work — an agent at rest is available, not busy.
            </section>
          )}

          <section className="rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--acton-navy)]">Recent activity</h2>
            {status.recent.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--acton-muted)]">
                No tasks you can see yet. Ask Baxter an HR question to see delegation here.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {status.recent.slice(0, 8).map((t) => {
                  const agent = agentById.get(t.assignedAgentId);
                  return (
                    <li key={t.id}>
                      <Link
                        href={`/ai/tasks/${t.id}`}
                        className="flex items-start gap-2 rounded p-1 hover:bg-[var(--acton-gray-50)]"
                      >
                        <AgentAvatar
                          name={agent?.name ?? "?"}
                          url={agent?.avatarUrl}
                          size={24}
                          color={agent?.departmentColor}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--acton-navy)]">
                            {t.title || "Task"}
                          </span>
                          <span className="text-xs text-[var(--acton-muted)]">
                            {agent?.name ?? "Agent"} · {formatRelative(t.createdAt)}
                          </span>
                        </span>
                        <TaskStatusPill status={t.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
