/** Published tours. A number is a fixed duration in milliseconds. */
export const PUBLISHED_TRANSITION_MS = 1200;
/** Editor stays above Photo Sphere Viewer's 500ms animation floor, and quicker than playback. */
export const EDITOR_TRANSITION_MS = 550;
const LINK_ZOOM_STEP = 15;

export type SceneTransitionChoice = {
  showLoader: false;
  effect: "fade";
  speed: number;
  rotation: boolean;
  /**
   * Arrival yaw/pitch. Omitted for a link so the plugin keeps the link position,
   * which is the direction of travel on the source scene.
   */
  rotateTo?: { yaw: number; pitch: number };
  zoomTo?: number;
};

/**
 * Photo Sphere Viewer 5.15.1 fades between nodes and, when `rotation` is true,
 * turns toward `rotateTo` during that fade. The plugin fills `rotateTo` from the
 * link you clicked. An explicit opening view replaces that heading.
 */
export function sceneTransitionOptions(input: {
  editMode: boolean;
  fromLink: boolean;
  zoomLevel: number;
  openingView: { yaw: number; pitch: number } | null;
}): SceneTransitionChoice {
  const speed = input.editMode ? EDITOR_TRANSITION_MS : PUBLISHED_TRANSITION_MS;
  const base = {
    showLoader: false as const,
    effect: "fade" as const,
    speed,
    rotation: false,
  };
  if (input.openingView) {
    return { ...base, rotateTo: input.openingView };
  }
  if (input.fromLink) {
    const zoomLevel = Number.isFinite(input.zoomLevel) ? input.zoomLevel : 50;
    return {
      ...base,
      rotation: true,
      zoomTo: Math.min(100, Math.max(0, zoomLevel + LINK_ZOOM_STEP)),
    };
  }
  return base;
}
