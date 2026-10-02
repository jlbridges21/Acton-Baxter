import type { ViewerHotspot } from "@/lib/tours/viewer-model";

export type HotspotDrafts = Record<string, ViewerHotspot[]>;
export type SavedHotspotJson = Record<string, string>;

type ServerScene = { id: string; hotspots: ViewerHotspot[] };

/**
 * One scene's list, replaced by a function of the latest list.
 * Other scenes' arrays are left in place.
 */
export function applySceneHotspots(
  drafts: HotspotDrafts | null,
  sceneId: string,
  server: ViewerHotspot[],
  update: (hotspots: ViewerHotspot[]) => ViewerHotspot[],
): HotspotDrafts {
  const current = drafts?.[sceneId] ?? server;
  return { ...(drafts ?? {}), [sceneId]: update(current) };
}

export function createHotspotWriteQueue() {
  const tails = new Map<string, Promise<void>>();
  return {
    /**
     * Same hotspot id runs one write after another so an older request cannot
     * be the last database write. Different ids are not queued.
     */
    enqueue(id: string, task: () => Promise<void>): Promise<void> {
      const previous = tails.get(id) ?? Promise.resolve();
      const run = previous.then(task, task);
      tails.set(id, run);
      return run;
    },
  };
}

/**
 * Hotspot lists and per-id saved snapshots. Mutations change one id.
 * A write that observed an older revision cannot replace a newer hotspot.
 */
export class HotspotDraftController {
  drafts: HotspotDrafts | null = null;
  saved: SavedHotspotJson = {};
  private revisions: Record<string, number> = {};
  private server = new Map<string, ViewerHotspot[]>();

  syncServer(scenes: ServerScene[]) {
    this.server = new Map(scenes.map((scene) => [scene.id, scene.hotspots]));
    for (const scene of scenes) {
      if (this.drafts?.[scene.id]) continue;
      for (const hotspot of scene.hotspots) {
        this.saved[hotspot.id] = JSON.stringify(hotspot);
      }
    }
  }

  revision(id: string): number {
    return this.revisions[id] ?? 0;
  }

  list(sceneId: string): ViewerHotspot[] {
    return this.drafts?.[sceneId] ?? this.server.get(sceneId) ?? [];
  }

  find(sceneId: string, hotspotId: string): ViewerHotspot | null {
    return this.list(sceneId).find((hotspot) => hotspot.id === hotspotId) ?? null;
  }

  place(sceneId: string, hotspot: ViewerHotspot): number {
    const revision = this.bump(hotspot.id);
    this.drafts = applySceneHotspots(this.drafts, sceneId, this.serverOf(sceneId), (list) =>
      list.some((item) => item.id === hotspot.id)
        ? list.map((item) => (item.id === hotspot.id ? hotspot : item))
        : [...list, hotspot],
    );
    return revision;
  }

  patch(sceneId: string, hotspot: ViewerHotspot): number {
    const revision = this.bump(hotspot.id);
    this.drafts = applySceneHotspots(this.drafts, sceneId, this.serverOf(sceneId), (list) =>
      list.map((item) => (item.id === hotspot.id ? hotspot : item)),
    );
    return revision;
  }

  remove(sceneId: string, hotspotId: string): number {
    const revision = this.bump(hotspotId);
    this.drafts = applySceneHotspots(this.drafts, sceneId, this.serverOf(sceneId), (list) =>
      list.filter((item) => item.id !== hotspotId),
    );
    return revision;
  }

  /**
   * Apply one write's result. `revision` is the revision observed when that
   * write read the hotspot. A newer edit wins: this call does not roll the
   * list back, and a successful stale write asks the caller to persist again.
   */
  complete(input: {
    sceneId: string;
    hotspotId: string;
    revision: number;
    error: boolean;
    kind: "insert" | "update" | "delete";
    sent: ViewerHotspot | null;
  }): { resave: boolean } {
    const latest = this.find(input.sceneId, input.hotspotId);
    if (this.revision(input.hotspotId) !== input.revision) {
      const sentJson = input.sent ? JSON.stringify(input.sent) : null;
      const latestJson = latest ? JSON.stringify(latest) : null;
      return { resave: !input.error && latestJson !== null && latestJson !== sentJson };
    }
    if (input.error) {
      this.restoreOne(input.sceneId, input.hotspotId);
      return { resave: false };
    }
    if (input.kind === "delete" || !latest) {
      if (input.hotspotId in this.saved) {
        const next = { ...this.saved };
        delete next[input.hotspotId];
        this.saved = next;
      }
      return { resave: false };
    }
    this.saved = { ...this.saved, [input.hotspotId]: JSON.stringify(latest) };
    return { resave: false };
  }

  isDirty(scenes: ServerScene[]): boolean {
    for (const scene of scenes) {
      const list = this.list(scene.id);
      const seen = new Set(list.map((hotspot) => hotspot.id));
      for (const hotspot of list) {
        if (this.saved[hotspot.id] !== JSON.stringify(hotspot)) return true;
      }
      for (const hotspot of scene.hotspots) {
        if (!seen.has(hotspot.id) && this.saved[hotspot.id]) return true;
      }
    }
    return false;
  }

  private serverOf(sceneId: string): ViewerHotspot[] {
    return this.server.get(sceneId) ?? [];
  }

  private bump(id: string): number {
    const next = (this.revisions[id] ?? 0) + 1;
    this.revisions[id] = next;
    return next;
  }

  /** Put one hotspot back to its last saved fields, or drop an insert that never landed. */
  private restoreOne(sceneId: string, hotspotId: string) {
    const saved = this.saved[hotspotId];
    this.drafts = applySceneHotspots(this.drafts, sceneId, this.serverOf(sceneId), (list) => {
      if (!saved) return list.filter((item) => item.id !== hotspotId);
      const previous = JSON.parse(saved) as ViewerHotspot;
      if (!list.some((item) => item.id === hotspotId)) return [...list, previous];
      return list.map((item) => (item.id === hotspotId ? previous : item));
    });
  }
}
