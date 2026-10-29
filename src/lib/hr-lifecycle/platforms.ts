/**
 * Platforms covered by the software access register, from the checklist. Seat prices are never
 * assumed: `seatCost` stays empty until an admin records an actual figure with its source.
 */

import type { PlatformKey } from "./types";

export type PlatformDef = {
  key: PlatformKey;
  label: string;
  /** Paid named-user seats the licensed software gate checks before an offer. */
  licensedSeat: boolean;
  /** Roles in this platform that count as privileged (need a named CEO/COO approval). */
  privilegedRoles: string[];
  adminNote: string;
};

export const PLATFORMS: PlatformDef[] = [
  {
    key: "google_workspace",
    label: "Google Workspace",
    licensedSeat: false,
    privilegedRoles: ["Super Admin", "Admin"],
    adminNote: "Suspend (do not delete) for 30 days on departure; transfer Drive ownership first.",
  },
  {
    key: "slack",
    label: "Slack",
    licensedSeat: false,
    privilegedRoles: ["Workspace Owner", "Workspace Admin"],
    adminNote: "Deactivate on departure; channel history stays.",
  },
  {
    key: "jobtread",
    label: "JobTread",
    licensedSeat: true,
    privilegedRoles: ["Admin"],
    adminNote: "Confirm a seat is free before the offer.",
  },
  {
    key: "autodesk_revit",
    label: "Autodesk Revit",
    licensedSeat: true,
    privilegedRoles: ["Primary Admin", "Secondary Admin"],
    adminNote: "Named-user seat in the Autodesk admin console.",
  },
  {
    key: "bluebeam_revu",
    label: "Bluebeam Revu",
    licensedSeat: true,
    privilegedRoles: ["Org Admin"],
    adminNote: "Named-user license in Bluebeam Cloud admin.",
  },
  {
    key: "gohighlevel",
    label: "GoHighLevel",
    licensedSeat: false,
    privilegedRoles: ["Admin", "Agency Admin"],
    adminNote: "Admin rights limited to one or two people.",
  },
  {
    key: "webflow",
    label: "Webflow",
    licensedSeat: true,
    privilegedRoles: ["Site Manager", "Workspace Admin"],
    adminNote: "Confirm a seat is free; roles: Designer, Content Editor, or Site Manager.",
  },
  {
    key: "meta_business_suite",
    label: "Meta Business Suite",
    licensedSeat: false,
    privilegedRoles: ["Admin", "Full control", "Primary Owner"],
    adminNote: "Primary Owner must stay a company-controlled account.",
  },
  {
    key: "x_twitter",
    label: "X (Twitter)",
    licensedSeat: false,
    privilegedRoles: ["Admin", "Master password"],
    adminNote: "Delegate access only — never share the master password.",
  },
  {
    key: "youtube",
    label: "YouTube",
    licensedSeat: false,
    privilegedRoles: ["Owner", "Manager"],
    adminNote: "Brand account owned by the company Google Workspace account.",
  },
  {
    key: "linkedin_page",
    label: "LinkedIn Company Page",
    licensedSeat: false,
    privilegedRoles: ["Super admin"],
    adminNote: "Admin role matched to need.",
  },
  {
    key: "google_business_profile",
    label: "Google Business Profile",
    licensedSeat: false,
    privilegedRoles: ["Owner", "Primary Owner"],
    adminNote: "Primary Owner stays on a company-controlled account.",
  },
  {
    key: "google_ads",
    label: "Google Ads",
    licensedSeat: false,
    privilegedRoles: ["Admin"],
    adminNote: "Link through the agency MCC if one exists rather than duplicating.",
  },
  {
    key: "google_analytics",
    label: "Google Analytics (GA4)",
    licensedSeat: false,
    privilegedRoles: ["Administrator"],
    adminNote: "Editor or Analyst at property level.",
  },
  {
    key: "baxter",
    label: "Baxter",
    licensedSeat: false,
    privilegedRoles: ["admin"],
    adminNote: "Deactivate the user, API keys, and automations under their identity.",
  },
  {
    key: "bamboohr",
    label: "BambooHR",
    licensedSeat: false,
    privilegedRoles: ["Full Admin"],
    adminNote: "Sam's BambooHR connection is read-only.",
  },
  {
    key: "payroll_benefits",
    label: "Payroll and benefits",
    licensedSeat: false,
    privilegedRoles: ["Admin"],
    adminNote: "Finance-owned. Sam never changes payroll.",
  },
  {
    key: "shared_credentials",
    label: "Shared credentials (Wi-Fi, vendors, scheduling, stock photo, podcast)",
    licensedSeat: false,
    privilegedRoles: [],
    adminNote: "Rotate on every departure.",
  },
];

export const PLATFORM_BY_KEY = new Map(PLATFORMS.map((p) => [p.key, p]));

export function platformLabel(key: string): string {
  return PLATFORM_BY_KEY.get(key as PlatformKey)?.label ?? key;
}

/** True when the role name is one of the platform's privileged roles (case-insensitive). */
export function isPrivilegedRole(platform: string, role: string): boolean {
  const def = PLATFORM_BY_KEY.get(platform as PlatformKey);
  const r = role.trim().toLowerCase();
  if (/\b(owner|admin|administrator|super)\b/.test(r)) return true;
  return Boolean(def?.privilegedRoles.some((p) => p.toLowerCase() === r));
}
