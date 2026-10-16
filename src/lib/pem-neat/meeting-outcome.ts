/**
 * Meeting-outcome decision date helpers shared by the generation stages.
 */
import { z } from "zod";
import type { MeetingOutcome } from "./constants";

/** Model-written display string ("Fri, Oct 16, 12:00 PM"); blanks/non-strings become null. */
export const nullableDecisionDate = z.preprocess((value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}, z.string().nullable());

/** A decision date only belongs on outcomes that can carry one. */
export function outcomeDecisionDate(
  classification: MeetingOutcome | string,
  decisionDate: string | null | undefined,
): string | null {
  if (classification !== "DECISION_DATE" && classification !== "YES") return null;
  return decisionDate?.trim() || null;
}
