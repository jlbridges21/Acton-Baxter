import { isAnonymousTourPath } from "@/lib/tours/public-paths";

/** `/surveys` stays authenticated. `/s/` (respondent page) and its public API do not. */
export function isAnonymousSurveyPath(pathname: string): boolean {
  return pathname.startsWith("/s/") || pathname.startsWith("/api/public/surveys/");
}

/**
 * Paths anyone can open: signed out, pending approval, or signed in.
 * Route handlers behind these paths must do their own access checks.
 */
export function isAnonymousPublicPath(pathname: string): boolean {
  return isAnonymousTourPath(pathname) || isAnonymousSurveyPath(pathname);
}
