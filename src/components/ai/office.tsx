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
  MessageCircle,
  Minus,
  Pause,
  Play,
  Plus,
  X,
} from "lucide-react";
import {
  BaxterChatPanel,
  type BaxterRequestLifecycle,
} from "@/components/baxter-chat/baxter-chat-panel";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  computeOfficeLayout,
  type LayoutPreset,
  type OfficeDepartment,
} from "@/lib/agents/office-layout";
import type { AgentCard } from "@/lib/agents/views";
import type { TaskSummary } from "@/lib/agents/task-format";
import type { AmbientIntensity } from "@/lib/office/ambient";
import type { OfficeAnimationSettings } from "@/lib/office/animation-settings";
import { centerOn as centerCamera, clientToWorld, zoomAround } from "@/lib/office/camera";
import { roomTheme, type RoomTheme } from "@/lib/office/decor";
import { DEPTH_RANK, depthZ } from "@/lib/office/depth";
import { roomDoor, roomHasDoor } from "@/lib/office/navigation";
import { activeDelegations, type DelegationSnapshot } from "@/lib/office/task-coordinator";
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
import { AnimatedAgent } from "./office/animated-agent";
import { OfficeDecor } from "./office/office-decor";
import type { OfficeDirector } from "./office/director";
import { useOfficeAnimation } from "./office/use-office-animation";

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

type StatusPayload = {
  statuses: StatusRow[];
  recent: TaskSummary[];
  /** Delegation pairs (ids/status/timestamps only) that drive the hand-off animation. */
  delegations?: DelegationSnapshot[];
  serverTime: string;
};

const JUST_FINISHED_MS = 45_000;
const MOTION_KEY = "baxter.aiOffice.reducedMotion";
const ACTIVITY_KEY = "baxter.aiOffice.activity";
const PAUSE_KEY = "baxter.aiOffice.ambientPaused";

/** Pointer travel (px) below which a press counts as a click rather than a pan. */
const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 600;
const CLICK_MARK_MS = 650;
let clickSeq = 0;

const DELEGATION_STATUS: Record<string, string> = {
  queued: "Assigned",
  running: "Working on it",
  awaiting_approval: "Needs approval",
};

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
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        // Portrait-at-a-desk agents sort on their desk's front edge like any floor object.
        zIndex: depthZ("world", y + 36, DEPTH_RANK.desk),
      }}
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

/** Dashed line from the delegating agent to the specialist while a real task is in flight. */
function CollabLink({
  director,
  from,
  to,
  fromPoint,
  toPoint,
}: {
  director: OfficeDirector | null;
  from: string;
  to: string;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
}) {
  const ref = useRef<SVGLineElement>(null);
  useEffect(() => {
    if (!director || !ref.current || !director.has(from)) return;
    return director.registerLink(ref.current, from, to);
  }, [director, from, to]);
  return (
    <line
      ref={ref}
      x1={fromPoint.x}
      y1={fromPoint.y - 30}
      x2={toPoint.x}
      y2={toPoint.y - 30}
      className="ai-office-link"
      stroke="#2b2118"
      strokeWidth={3}
      strokeDasharray="6 6"
      strokeLinecap="round"
      opacity={0.55}
    />
  );
}

export function AiOffice(props: {
  initialAgents: AgentCard[];
  departments: OfficeDepartment[];
  settings: OfficeSettings;
  animation: OfficeAnimationSettings;
  chatEnabled: boolean;
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
  /** Per-viewer override of the admin's ambient activity level ("default" = admin's). */
  const [activity, setActivity] = useState<AmbientIntensity | "default">("default");
  const [ambientPaused, setAmbientPaused] = useState(false);
  const [following, setFollowing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    at: number;
    moved: boolean;
  } | null>(null);
  const [clickMarks, setClickMarks] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const markTimers = useRef(new Set<number>());

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
  const baxter = useMemo(() => agents.find((a) => a.kind === "orchestrator") ?? null, [agents]);

  const animatedAgents = useMemo(
    () =>
      agents
        .filter((a) => a.status !== "archived")
        .map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          kind: a.kind,
          department: a.department,
        })),
    [agents],
  );
  const intensity: AmbientIntensity =
    activity === "default" ? props.animation.ambient_intensity : activity;
  const themes = useMemo(
    () => new Map<string, RoomTheme>(props.departments.map((d) => [d.id, roomTheme(d)])),
    [props.departments],
  );
  const animation = useOfficeAnimation({
    layout,
    themes,
    agents: animatedAgents,
    settings: props.animation,
    status,
    initialStatus: props.initialStatus,
    reducedMotion,
    intensity,
    ambientPaused,
  });
  const director = animation.director;
  const links = useMemo(() => activeDelegations(status.delegations ?? []), [status.delegations]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MOTION_KEY);
      const prefers = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a per-viewer preference
      setReducedMotion(stored ? stored === "true" : Boolean(prefers));
      const storedActivity = window.localStorage.getItem(ACTIVITY_KEY);
      if (storedActivity && ["default", "off", "low", "normal", "high"].includes(storedActivity)) {
        setActivity(storedActivity as AmbientIntensity | "default");
      }
      setAmbientPaused(window.localStorage.getItem(PAUSE_KEY) === "true");
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

  function remember(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function setMotion(value: boolean) {
    setReducedMotion(value);
    remember(MOTION_KEY, String(value));
  }

  function chooseActivity(value: AmbientIntensity | "default") {
    setActivity(value);
    remember(ACTIVITY_KEY, value);
  }

  function togglePause() {
    setAmbientPaused((p) => {
      remember(PAUSE_KEY, String(!p));
      return !p;
    });
  }

  /**
   * Click/tap on the office floor with an animated agent selected: show an expanding ring at
   * the clicked world point right away, then walk the agent there (or to the nearest
   * reachable spot if the point is inside furniture, a wall, or outside the rooms).
   */
  function onWorldClick(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as Element;
    if (target.closest("button, a, input, select, textarea, [role='dialog']")) return;
    const vp = viewportRef.current;
    if (!vp || !director || !selectedId || !director.has(selectedId)) return;
    const world = clientToWorld(
      { x: e.clientX, y: e.clientY },
      vp.getBoundingClientRect(),
      { left: vp.clientLeft, top: vp.clientTop },
      { x: pan.x, y: pan.y, zoom },
    );
    const id = ++clickSeq;
    setClickMarks((marks) => [...marks.slice(-4), { id, x: world.x, y: world.y }]);
    const timer = window.setTimeout(() => {
      markTimers.current.delete(timer);
      setClickMarks((marks) => marks.filter((m) => m.id !== id));
    }, CLICK_MARK_MS);
    markTimers.current.add(timer);
    director.moveTo(selectedId, world);
  }

  useEffect(() => {
    const timers = markTimers.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const onChatRequest = useCallback(
    (event: BaxterRequestLifecycle) => {
      if (!baxter || !director) return;
      if (event.phase === "start") director.chatRequest(baxter.id, "start");
      else director.chatRequest(baxter.id, "end", { ok: event.ok, delegated: event.delegated });
      // The chat answer may have created or finished delegated tasks; pick them up now.
      if (event.phase === "end") void refresh();
    },
    [baxter, director, refresh],
  );

  const centerOn = useCallback(
    (x: number, y: number, z = zoom) => {
      const vp = viewportRef.current;
      if (!vp) return;
      setPan(centerCamera({ x, y }, z, { width: vp.clientWidth, height: vp.clientHeight }));
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

  /** Baxter's live position when animated, else his seat. */
  const baxterPoint = useCallback(() => {
    if (!baxter) return null;
    const p = director?.positionOf(baxter.id);
    if (p) return { x: p.x, y: p.y - 30 };
    const seat = layout.seats.find((s) => s.agentId === baxter.id);
    return seat ? { x: seat.x, y: seat.y } : null;
  }, [baxter, director, layout.seats]);

  function goToBaxter() {
    const p = baxterPoint();
    if (!baxter || !p) return;
    const z = Math.max(zoom, 1);
    setZoom(z);
    centerOn(p.x, p.y, z);
    setSelectedId(baxter.id);
  }

  // Follow Baxter: re-centre a few times a second (with a matching CSS transition) rather
  // than every frame, so following doesn't re-render the office 60 times a second.
  useEffect(() => {
    if (!following || view !== "office") return;
    const step = () => {
      const p = baxterPoint();
      if (p) centerOn(p.x, p.y);
    };
    step();
    const id = window.setInterval(step, 250);
    return () => window.clearInterval(id);
  }, [following, view, baxterPoint, centerOn]);

  function zoomBy(factor: number) {
    const vp = viewportRef.current;
    const next = Math.max(0.4, Math.min(2, zoom * factor));
    if (vp) {
      const focus = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 };
      setPan((p) => zoomAround({ ...p, zoom }, next, focus));
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
            Office life
            <select
              className="rounded border border-[var(--acton-border)] bg-white px-1.5 py-1 text-xs"
              value={activity}
              onChange={(e) => chooseActivity(e.target.value as AmbientIntensity | "default")}
              title="How much Baxter moves around when he has no real work. Only affects your view."
            >
              <option value="default">Default ({props.animation.ambient_intensity})</option>
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <button
            type="button"
            onClick={togglePause}
            aria-pressed={ambientPaused}
            className="inline-flex items-center gap-1 rounded border border-[var(--acton-border)] bg-white px-2 py-1 font-medium text-[var(--acton-navy)]"
            title="Pause idle wandering. Real task activity still animates."
          >
            {ambientPaused ? (
              <Play className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden />
            )}
            {ambientPaused ? "Resume idle animation" : "Pause idle animation"}
          </button>
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
                if (e.button !== 0) return;
                setFollowing(false);
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {
                  /* pointer already released (or synthetic); dragging still works */
                }
                dragRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  panX: pan.x,
                  panY: pan.y,
                  at: performance.now(),
                  moved: false,
                };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) d.moved = true;
                if (d.moved) setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
              }}
              onPointerUp={(e) => {
                const d = dragRef.current;
                dragRef.current = null;
                // A tap/click (not a drag) on the floor: walk the selected agent there.
                if (d && !d.moved && performance.now() - d.at < CLICK_MAX_MS) onWorldClick(e);
              }}
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
                  transition: following ? "transform 250ms linear" : undefined,
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
                      style={{ background: room.color, zIndex: depthZ("wall") + 2 }}
                    >
                      {room.label}
                    </span>
                    {roomHasDoor(room) ? (
                      <span
                        aria-hidden
                        className="ai-office-floor absolute"
                        style={{
                          left: roomDoor(room).x - room.x - 6,
                          bottom: -6,
                          width: roomDoor(room).w,
                          height: 6,
                        }}
                      />
                    ) : null}
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
                    ) : null}
                  </div>
                ))}
                <OfficeDecor items={animation.nav.decor} />
                {clickMarks.map((m) => (
                  <span
                    key={m.id}
                    aria-hidden
                    className="ai-office-click pointer-events-none absolute block rounded-full border-[3px] border-[var(--acton-yellow)]"
                    style={{ left: m.x, top: m.y, zIndex: depthZ("ui") + 1 }}
                  />
                ))}
                <svg
                  aria-hidden
                  className="pointer-events-none absolute top-0 left-0"
                  width={layout.width}
                  height={layout.height}
                  style={{ zIndex: depthZ("wall") + 1 }}
                >
                  {links.map((d) => {
                    const fromSeat = layout.seats.find((s) => s.agentId === d.fromAgentId);
                    const toSeat = layout.seats.find((s) => s.agentId === d.toAgentId);
                    if (!fromSeat || !toSeat) return null;
                    return (
                      <CollabLink
                        key={d.id}
                        director={director}
                        from={d.fromAgentId}
                        to={d.toAgentId}
                        fromPoint={fromSeat}
                        toPoint={toSeat}
                      />
                    );
                  })}
                </svg>
                {links.map((d) => {
                  const toSeat = layout.seats.find((s) => s.agentId === d.toAgentId);
                  const from = agentById.get(d.fromAgentId);
                  if (!toSeat || !from) return null;
                  return (
                    <span
                      key={`chip-${d.id}`}
                      className="pointer-events-none absolute -translate-x-1/2 border-2 border-[#2b2118] bg-[#fff6d6] px-1.5 py-px text-[10px] font-bold whitespace-nowrap text-[#2b2118]"
                      style={{ left: toSeat.x, top: toSeat.y - 104, zIndex: depthZ("ui") }}
                    >
                      From {from.name} · {DELEGATION_STATUS[d.status] ?? d.status}
                    </span>
                  );
                })}
                {layout.seats.map((seat) => {
                  const agent = agentById.get(seat.agentId);
                  if (!agent) return null;
                  const spec = animation.specs.get(agent.id);
                  const state = displayState(statusById.get(agent.id), now);
                  if (spec && director) {
                    return (
                      <AnimatedAgent
                        key={seat.agentId}
                        spec={spec}
                        director={director}
                        name={agent.name}
                        ariaLabel={`${agent.name}, ${agent.title}. ${RUNTIME_STATE_LABELS[state]?.label ?? state}.`}
                        selected={selectedId === agent.id}
                        onSelect={() => {
                          setSelectedId(agent.id);
                          // Clicking an animated agent stops its routine and hands control
                          // to the user (it resumes on its own after 10s of inactivity).
                          director.interrupt(agent.id);
                        }}
                        bubble={<StateBubble state={state} />}
                        cue={animation.cues[agent.id]}
                      />
                    );
                  }
                  return (
                    <AgentSprite
                      key={seat.agentId}
                      agent={agent}
                      state={state}
                      x={seat.x}
                      y={seat.y}
                      selected={selectedId === agent.id}
                      onSelect={() => setSelectedId(agent.id)}
                    />
                  );
                })}
              </div>
            </div>
            <p className="sr-only" aria-live="polite">
              {Object.entries(animation.cues)
                .filter(([, c]) => c.caption)
                .map(([id, c]) => `${agentById.get(id)?.name ?? "Agent"}: ${c.caption}`)
                .join(". ")}
            </p>
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
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFollowing(false);
                  fit();
                }}
                title="Reset camera"
              >
                Fit
              </Button>
              {baxter ? (
                <Button
                  size="sm"
                  variant={following ? "primary" : "secondary"}
                  onClick={() => setFollowing((f) => !f)}
                  aria-pressed={following}
                  title="Keep the camera on Baxter"
                >
                  Follow
                </Button>
              ) : null}
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
              {view === "office" && animation.specs.has(selected.id) ? (
                <p className="mt-2 rounded bg-[var(--acton-gray-50)] px-2 py-1 text-xs text-[var(--acton-muted)]">
                  {animation.control[selected.id] === "manual"
                    ? `You're directing ${selected.name}. Click the floor to move them; they return to their routine after 10 seconds without input.`
                    : `Click ${selected.name} to take control, then click the floor to move them.`}
                </p>
              ) : null}
              {selected.kind === "orchestrator" ? (
                <BaxterActivity
                  baxterId={selected.id}
                  delegations={status.delegations ?? []}
                  recent={status.recent}
                  agentById={agentById}
                  cue={animation.cues[selected.id]?.caption ?? null}
                />
              ) : null}
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
                {selected.kind === "orchestrator" && props.chatEnabled ? (
                  <button
                    type="button"
                    onClick={() => setChatOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--acton-yellow)] px-3 text-xs font-semibold text-[var(--acton-navy)]"
                  >
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Ask Baxter
                  </button>
                ) : null}
                {selected.kind === "orchestrator" && view === "office" ? (
                  <button
                    type="button"
                    onClick={goToBaxter}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--acton-border)] px-3 text-xs font-semibold text-[var(--acton-navy)]"
                  >
                    <Crosshair className="h-3.5 w-3.5" aria-hidden /> Locate
                  </button>
                ) : null}
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
              Select an agent to see who they are and what they&apos;re doing. Baxter strolls around
              his office while he&apos;s free; status badges, hand-off lines, and captions only
              appear for real tasks.
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
      {props.chatEnabled && chatOpen ? (
        <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
          <BaxterChatPanel onClose={() => setChatOpen(false)} onRequestLifecycle={onChatRequest} />
        </div>
      ) : null}
    </div>
  );
}

/** What Baxter is coordinating right now, from real delegation records. */
function BaxterActivity({
  baxterId,
  delegations,
  recent,
  agentById,
  cue,
}: {
  baxterId: string;
  delegations: DelegationSnapshot[];
  recent: TaskSummary[];
  agentById: Map<string, AgentCard>;
  cue: string | null;
}) {
  const active = activeDelegations(delegations).filter((d) => d.fromAgentId === baxterId);
  const visible = new Map(recent.map((t) => [t.id, t]));
  const history = recent.filter((t) => t.assigningAgentId === baxterId).slice(0, 4);
  return (
    <div className="mt-4 space-y-3">
      {cue ? (
        <p className="rounded bg-[var(--acton-gray-50)] px-2 py-1 text-xs text-[var(--acton-navy)]">
          {cue}
        </p>
      ) : null}
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          Current assignments
        </h3>
        {active.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--acton-muted)]">Nothing handed off right now.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {active.map((d) => {
              const to = agentById.get(d.toAgentId);
              const task = visible.get(d.id);
              const label = `${to?.name ?? "Specialist"} · ${DELEGATION_STATUS[d.status] ?? d.status}`;
              return (
                <li key={d.id} className="text-sm text-[var(--acton-navy)]">
                  {task ? (
                    <Link href={`/ai/tasks/${d.id}`} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {history.length ? (
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Recent delegations
          </h3>
          <ul className="mt-1 space-y-1.5">
            {history.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/ai/tasks/${t.id}`}
                  className="flex items-center justify-between gap-2 text-sm hover:underline"
                >
                  <span className="truncate">
                    {agentById.get(t.assignedAgentId)?.name ?? "Agent"}: {t.title || "Task"}
                  </span>
                  <TaskStatusPill status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
