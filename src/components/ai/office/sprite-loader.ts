"use client";

import {
  allFrameUrls,
  parseSpritePackManifest,
  withoutBrokenFrames,
  type SpritePackDefinition,
  type SpritePackManifest,
} from "@/lib/office/sprite-pack";

const cache = new Map<string, Promise<SpritePackManifest>>();
/** Decoded images stay referenced so the browser keeps them warm for frame swaps. */
const decoded = new Map<string, HTMLImageElement>();

function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      decoded.set(url, img);
      // decode() avoids a jank frame on first display; failures here are non-fatal.
      void img.decode?.().catch(() => undefined);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Fetches, validates, and preloads a sprite pack once per page. Frames that fail to load
 * remove their clip; if a required clip is lost the promise rejects and the agent keeps its
 * static portrait.
 */
export function loadSpritePack(def: SpritePackDefinition): Promise<SpritePackManifest> {
  const existing = cache.get(def.id);
  if (existing) return existing;
  const promise = (async () => {
    const res = await fetch(def.manifestUrl, { cache: "force-cache" });
    if (!res.ok) throw new Error(`sprite manifest ${res.status}`);
    const { manifest, dropped } = parseSpritePackManifest(await res.json());
    if (dropped.length) console.warn("[ai-office] sprite clips ignored", def.id, dropped);
    const urls = allFrameUrls(manifest);
    const results = await Promise.all(urls.map(async (u) => [u, await preload(u)] as const));
    const broken = new Set(results.filter(([, ok]) => !ok).map(([u]) => u));
    if (broken.size) console.warn("[ai-office] sprite frames missing", def.id, [...broken]);
    const usable = withoutBrokenFrames(manifest, broken);
    if (!usable) throw new Error("sprite pack unusable");
    return usable;
  })();
  cache.set(def.id, promise);
  promise.catch(() => cache.delete(def.id));
  return promise;
}
