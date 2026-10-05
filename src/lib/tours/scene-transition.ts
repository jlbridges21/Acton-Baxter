import type { ArrivalHeading } from "@/lib/tours/arrival-heading";

export const TOUR_TRANSITION_EFFECTS = ["none", "fade", "black", "white"] as const;
export type TourTransitionEffect = (typeof TOUR_TRANSITION_EFFECTS)[number];

export const TOUR_TRANSITION_SPEEDS = ["fast", "normal", "slow"] as const;
export type TourTransitionSpeed = (typeof TOUR_TRANSITION_SPEEDS)[number];

/**
 * Fast is 500 because Photo Sphere Viewer 5.15.1 raises any shorter
 * duration to its 500ms animation floor.
 */
export const TRANSITION_SPEED_MS: Record<TourTransitionSpeed, number> = {
  fast: 500,
  normal: 1000,
  slow: 1500,
};

/** Zoom level 0 is Photo Sphere Viewer's widest field of view. */
export const WIDEST_ZOOM_LEVEL = 0;

export const DEFAULT_TOUR_PLAYBACK = {
  transitionEffect: "fade" as const,
  transitionSpeed: "fast" as const,
  transitionDirectional: false,
  autorotate: false,
};

export function tourTransitionEffect(value: unknown): TourTransitionEffect {
  return value === "none" || value === "fade" || value === "black" || value === "white"
    ? value
    : DEFAULT_TOUR_PLAYBACK.transitionEffect;
}

export function tourTransitionSpeed(value: unknown): TourTransitionSpeed {
  return value === "fast" || value === "normal" || value === "slow"
    ? value
    : DEFAULT_TOUR_PLAYBACK.transitionSpeed;
}

export function tourTransitionDirectional(value: unknown): boolean {
  return value === true;
}

export function tourAutorotate(value: unknown): boolean {
  return value === true;
}

export type SceneTransitionChoice = {
  showLoader: false;
  effect: TourTransitionEffect;
  speed: number;
  rotation: boolean;
  /**
   * Arrival yaw/pitch. Omitted for a directional link so the plugin keeps the
   * link position. Set to undefined to drop a link heading the plugin already filled in.
   */
  rotateTo?: { yaw: number; pitch: number };
  zoomTo?: number;
};

/**
 * Photo Sphere Viewer 5.15.1 crossfades when effect is fade, black, or white.
 * `none` cuts immediately. `rotation: true` still turns during that change.
 * An opening view, or a return hotspot turned 180°, is passed as `rotateTo`.
 * With neither, a directional link leaves `rotateTo` unset so the plugin keeps
 * the clicked link's heading. Every load starts at the widest zoom.
 * The editor always uses Fast so authoring stays snappy.
 */
export function sceneTransitionOptions(input: {
  editMode: boolean;
  fromLink: boolean;
  arrival: ArrivalHeading;
  effect: TourTransitionEffect;
  speed: TourTransitionSpeed;
  directional: boolean;
}): SceneTransitionChoice {
  const speedName = input.editMode ? "fast" : tourTransitionSpeed(input.speed);
  const base = {
    showLoader: false as const,
    effect: tourTransitionEffect(input.effect),
    speed: TRANSITION_SPEED_MS[speedName],
    rotation: false,
    zoomTo: WIDEST_ZOOM_LEVEL,
  };
  if (input.arrival.kind === "opening") {
    return { ...base, rotateTo: { yaw: input.arrival.yaw, pitch: input.arrival.pitch } };
  }
  if (input.arrival.kind === "return") {
    return {
      ...base,
      rotation: Boolean(input.directional && input.fromLink),
      rotateTo: { yaw: input.arrival.yaw, pitch: 0 },
    };
  }
  if (input.directional && input.fromLink) {
    return { ...base, rotation: true };
  }
  return { ...base, rotateTo: undefined };
}
