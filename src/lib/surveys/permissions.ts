import { isAdminRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/errors";

export type SurveyActor = {
  id: string;
  profile: { role: string | null | undefined };
};

/** Creator or admin may edit, delete the survey, and delete responses. */
export function canEditSurvey(user: SurveyActor, survey: { createdBy: string }): boolean {
  return user.id === survey.createdBy || isAdminRole(user.profile.role);
}

export function assertCanEditSurvey(user: SurveyActor, survey: { createdBy: string }): void {
  if (!canEditSurvey(user, survey)) {
    throw new AuthorizationError("Only the survey's creator or an admin can do that.");
  }
}
