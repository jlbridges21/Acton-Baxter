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

const LINK_ZOOM_STEP = 15;

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
 * `none` cuts immediately. `rotation: true` turns toward the clicked link during
 * that change; the plugin supplies that link's yaw and pitch as the arrival.
 * An explicit opening view replaces that heading in every mode.
 * The editor always uses Fast so authoring stays snappy.
 */
export function sceneTransitionOptions(input: {
  editMode: boolean;
  fromLink: boolean;
  zoomLevel: number;
  openingView: { yaw: number; pitch: number } | null;
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
  };
  if (input.openingView) {
    return { ...base, rotateTo: input.openingView };
  }
  if (input.directional && input.fromLink) {
    const zoomLevel = Number.isFinite(input.zoomLevel) ? input.zoomLevel : 50;
    return {
      ...base,
      rotation: true,
      zoomTo: Math.min(100, Math.max(0, zoomLevel + LINK_ZOOM_STEP)),
    };
  }
  return { ...base, rotateTo: undefined };
}
