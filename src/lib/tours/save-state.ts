export type TourSaveState = "saved" | "saving" | "pending" | "error";

export function tourSaveState(input: {
  inFlight: number;
  failed: boolean;
  dirty: boolean;
}): TourSaveState {
  if (input.inFlight > 0) return "saving";
  if (input.failed) return "error";
  if (input.dirty) return "pending";
  return "saved";
}

export function tourSaveLabel(state: TourSaveState): string {
  switch (state) {
    case "saving":
      return "Saving…";
    case "pending":
      return "Pending sync";
    case "error":
      return "Save error";
    default:
      return "All changes saved";
  }
}
