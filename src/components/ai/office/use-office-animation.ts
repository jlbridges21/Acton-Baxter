"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeLayout } from "@/lib/agents/office-layout";
import type { AmbientIntensity } from "@/lib/office/ambient";
import { SPEED_MULTIPLIER, type OfficeAnimationSettings } from "@/lib/office/animation-settings";
import { buildOfficeNav, type NavAgent, type OfficeNav } from "@/lib/office/navigation";
import { SPRITE_PACKS, resolvePackId, type SpritePackManifest } from "@/lib/office/sprite-pack";
import {
  modeFromRuntime,
  reconcile,
  seedCoordinator,
  type DelegationSnapshot,
  type OfficeEvent,
} from "@/lib/office/task-coordinator";
import { OfficeDirector, type AnimatedAgentSpec, type AgentNames, type Cue } from "./director";
import { loadSpritePack } from "./sprite-loader";

type AgentLite = {
  id: string;
  name: string;
  kind: "orchestrator" | "specialist";
  department: string | null;
};

export type OfficeStatusSnapshot = {
  statuses: Array<{ agentId: string; state: string }>;
  delegations?: DelegationSnapshot[];
  serverTime: string;
};

/**
 * Connects the office page to the animation engine: loads sprite packs, builds navigation
 * for the current layout, runs the director, and feeds it real status snapshots.
 */
export function useOfficeAnimation(input: {
  layout: OfficeLayout;
  agents: AgentLite[];
  settings: OfficeAnimationSettings;
  status: OfficeStatusSnapshot;
  initialStatus: OfficeStatusSnapshot;
  reducedMotion: boolean;
  intensity: AmbientIntensity;
  ambientPaused: boolean;
}) {
  const { layout, agents, settings } = input;
  const [packs, setPacks] = useState<Record<string, SpritePackManifest>>({});
  const [cues, setCues] = useState<Record<string, Cue>>({});
  const [director, setDirector] = useState<OfficeDirector | null>(null);

  const packOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      const id = resolvePackId(a, settings.agents);
      if (id) m.set(a.id, id);
    }
    return m;
  }, [agents, settings.agents]);

  useEffect(() => {
    let cancelled = false;
    for (const packId of new Set(packOf.values())) {
      const def = SPRITE_PACKS[packId];
      if (!def) continue;
      loadSpritePack(def).then(
        (manifest) => {
          if (!cancelled) setPacks((p) => (p[packId] ? p : { ...p, [packId]: manifest }));
        },
        (error: unknown) => console.warn("[ai-office] keeping static portrait", packId, error),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [packOf]);

  const { nav, specs } = useMemo(() => {
    const navAgents: NavAgent[] = [];
    const ready = new Map<string, { packId: string; manifest: SpritePackManifest }>();
    for (const seat of layout.seats) {
      const packId = packOf.get(seat.agentId);
      const manifest = packId ? packs[packId] : undefined;
      const def = packId ? SPRITE_PACKS[packId] : undefined;
      const standPoint = manifest?.canvases.desk.standPoint;
      if (def && manifest && standPoint && manifest.animations.working) {
        ready.set(seat.agentId, { packId: def.id, manifest });
        navAgents.push({
          id: seat.agentId,
          seat,
          pack: { ...def, standPoint, deskAnchor: manifest.canvases.desk.anchor },
          handoffSide: settings.agents[seat.agentId]?.handoff_side,
        });
      } else {
        navAgents.push({
          id: seat.agentId,
          seat,
          pack: null,
          handoffSide: settings.agents[seat.agentId]?.handoff_side,
        });
      }
    }
    const built: OfficeNav = buildOfficeNav(layout, navAgents);
    const out = new Map<string, AnimatedAgentSpec>();
    for (const [agentId, { packId, manifest }] of ready) {
      const desk = built.desks.get(agentId);
      const roomKey = built.roomOfAgent.get(agentId);
      const agent = agents.find((a) => a.id === agentId);
      if (!desk || !roomKey || !agent) continue;
      out.set(agentId, {
        id: agentId,
        name: agent.name,
        roomKey,
        pack: SPRITE_PACKS[packId]!,
        manifest,
        desk,
      });
    }
    return { nav: built, specs: out };
  }, [layout, packOf, packs, agents, settings.agents]);

  const names: AgentNames = useMemo(
    () => new Map(agents.map((a) => [a.id, { name: a.name, department: a.department }])),
    [agents],
  );

  // Live settings, read when the director is (re)created without recreating it on change.
  const live = useRef({
    reducedMotion: input.reducedMotion,
    intensity: input.intensity,
    ambientPaused: input.ambientPaused,
  });
  useEffect(() => {
    live.current = {
      reducedMotion: input.reducedMotion,
      intensity: input.intensity,
      ambientPaused: input.ambientPaused,
    };
  }, [input.reducedMotion, input.intensity, input.ambientPaused]);

  useEffect(() => {
    if (!specs.size) return;
    const d = new OfficeDirector({
      nav,
      agents: [...specs.values()],
      names,
      intensity: live.current.intensity,
      speed: SPEED_MULTIPLIER[settings.speed],
      homeSpot: settings.home_spot,
      reducedMotion: live.current.reducedMotion,
      ambientPaused: live.current.ambientPaused,
      onCue: (agentId, cue) => setCues((c) => ({ ...c, [agentId]: cue })),
    });
    d.start();
    setDirector(d);
    return () => {
      d.destroy();
      setDirector((cur) => (cur === d ? null : cur));
    };
  }, [nav, specs, names, settings.speed, settings.home_spot]);

  useEffect(() => {
    director?.setReducedMotion(input.reducedMotion);
  }, [director, input.reducedMotion]);

  useEffect(() => {
    director?.setAmbient(input.intensity, input.ambientPaused);
  }, [director, input.intensity, input.ambientPaused]);

  // Real task state → coordinator (seeded at load, so a refresh never replays history).
  const coordinator = useRef(
    seedCoordinator(input.initialStatus.delegations ?? [], input.initialStatus.serverTime),
  );
  const pendingEvents = useRef<OfficeEvent[]>([]);

  useEffect(() => {
    const { state, events } = reconcile(coordinator.current, {
      delegations: input.status.delegations ?? [],
      serverTime: input.status.serverTime,
    });
    coordinator.current = state;
    pendingEvents.current.push(...events);
  }, [input.status]);

  useEffect(() => {
    if (!director) return;
    for (const s of input.status.statuses) director.setMode(s.agentId, modeFromRuntime(s.state));
    if (pendingEvents.current.length) {
      director.handleEvents(pendingEvents.current);
      pendingEvents.current = [];
    }
  }, [director, input.status]);

  return { nav, specs, director, cues };
}
