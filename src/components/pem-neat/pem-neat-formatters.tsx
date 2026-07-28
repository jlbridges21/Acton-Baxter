import type { MeetingOutcome, QualificationLevel } from "@/lib/pem-neat/constants";
import { Badge } from "@/components/ui/badge";

export function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

export function formatMeetingOutcomeLabel(outcome: MeetingOutcome | string): string {
  switch (outcome) {
    case "YES":
      return "YES";
    case "NO":
      return "NO";
    case "DECISION_DATE":
      return "DECISION DATE";
    case "DECISION_DATE_NOT_SECURED":
      return "DECISION DATE — NOT SECURED";
    default:
      return formatEnumLabel(outcome);
  }
}

export function meetingOutcomeTone(
  outcome: MeetingOutcome | string | null,
): "green" | "red" | "amber" | "blue" | "gray" {
  switch (outcome) {
    case "YES":
      return "green";
    case "NO":
      return "red";
    case "DECISION_DATE":
      return "blue";
    case "DECISION_DATE_NOT_SECURED":
      return "amber";
    default:
      return "gray";
  }
}

export function qualificationTone(
  level: QualificationLevel | string | null,
): "green" | "amber" | "blue" | "red" | "gray" {
  switch (level) {
    case "STRONGLY_QUALIFIED":
      return "green";
    case "QUALIFIED_WITH_RISKS":
      return "amber";
    case "EARLY_EXPLORATORY":
      return "blue";
    case "WEAKLY_QUALIFIED":
      return "amber";
    case "DISQUALIFIED":
      return "red";
    default:
      return "gray";
  }
}

export function formatMeetingDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) {
    const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(date);
    }
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatGeneratedAt(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/** Format a string that may contain a numeric amount as currency. */
export function formatMoneyLike(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return value;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || cleaned.length < 3) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function OutcomeBadge({ outcome }: { outcome: MeetingOutcome | string | null }) {
  if (!outcome) return null;
  return <Badge tone={meetingOutcomeTone(outcome)}>{formatMeetingOutcomeLabel(outcome)}</Badge>;
}

export function QualificationBadge({ level }: { level: QualificationLevel | string | null }) {
  if (!level) return null;
  return <Badge tone={qualificationTone(level)}>{formatEnumLabel(level)}</Badge>;
}

export function AssessmentStatusBadge({ status }: { status: string }) {
  const tone =
    status === "COMPLETED"
      ? "green"
      : status === "PARTIAL"
        ? "amber"
        : status === "MISSED"
          ? "red"
          : status === "N_A"
            ? "gray"
            : "gray";
  return <Badge tone={tone}>{formatEnumLabel(status)}</Badge>;
}

export function ProjectFactStatusBadge({ status }: { status: string }) {
  const tone =
    status === "CONFIRMED"
      ? "green"
      : status === "HOMEOWNER_REPORTED"
        ? "blue"
        : status === "ADVISOR_ESTIMATE"
          ? "amber"
          : "gray";
  return <Badge tone={tone}>{formatEnumLabel(status)}</Badge>;
}
