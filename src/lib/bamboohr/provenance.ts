/**
 * Structured provenance for externally sourced data. Every value Baxter shows from BambooHR
 * carries this metadata so the UI (not the model) decides how to attribute it.
 * Shared by the server and the browser.
 */

export type SourceProvider = "bamboohr" | "jobtread" | "google_drive" | "baxter";

export const PROVIDER_LABELS: Record<SourceProvider, string> = {
  bamboohr: "BambooHR",
  jobtread: "JobTread",
  google_drive: "Google Drive",
  baxter: "Baxter",
};

export type Freshness = "live" | "cached" | "unavailable";

export type Provenance = {
  provider: SourceProvider;
  /** e.g. "Employee profile", "Employee directory", "Onboarding experience". */
  entityType: string;
  /** Provider record id (BambooHR employee id). Omitted in views where it must not leak. */
  recordId: string | null;
  /** Provider field ids the values came from. */
  fieldIds: string[];
  retrievedAt: string;
  /** Last time the connection was confirmed working. */
  lastConfirmedAt: string | null;
  freshness: Freshness;
  /** Only a documented, reliable link — never a guessed URL. */
  sourceUrl: string | null;
  classification:
    | "employee_basic"
    | "employee_job"
    | "employee_contact"
    | "employee_custom"
    | "employee_files"
    | "onboarding"
    | "company";
};

export type Sourced<T> = { data: T; source: Provenance };

export function provenance(
  input: Omit<Provenance, "retrievedAt" | "lastConfirmedAt" | "sourceUrl" | "freshness"> &
    Partial<Pick<Provenance, "retrievedAt" | "lastConfirmedAt" | "sourceUrl" | "freshness">>,
): Provenance {
  return {
    retrievedAt: new Date().toISOString(),
    lastConfirmedAt: null,
    sourceUrl: null,
    freshness: "live",
    ...input,
  };
}

/** "BambooHR · Employee profile · retrieved live just now" */
export function describeSource(
  p: Pick<Provenance, "provider" | "entityType" | "freshness" | "retrievedAt">,
  now = Date.now(),
): string {
  const mins = Math.round((now - Date.parse(p.retrievedAt)) / 60_000);
  const when =
    p.freshness === "unavailable"
      ? "currently unavailable"
      : mins < 1
        ? "just now"
        : mins < 60
          ? `${mins} min ago`
          : mins < 1440
            ? `${Math.round(mins / 60)} h ago`
            : `${Math.round(mins / 1440)} d ago`;
  const how = p.freshness === "live" ? "retrieved live" : p.freshness === "cached" ? "cached" : "";
  return [PROVIDER_LABELS[p.provider], p.entityType, [how, when].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}
