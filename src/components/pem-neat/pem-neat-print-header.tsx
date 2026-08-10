import Image from "next/image";
import {
  formatGeneratedAt,
  formatMeetingDate,
  formatMeetingOutcomeLabel,
  formatEnumLabel,
} from "@/components/pem-neat/pem-neat-formatters";
import { formatHumanDisplayName } from "@/lib/pem-neat/display-name";
import { formatDate } from "@/lib/utils";

/**
 * Print-only document header for PEM NEAT PDF export.
 * Uses a <section> (not <header>) because globals.css hides all <header> in print.
 */
export function PemNeatPrintHeader({
  prospectName,
  prospectNames,
  salespersonDisplayName,
  meetingDate,
  meetingOutcome,
  qualification,
  generatedAt,
  logoUrl = null,
  companyName = "Acton ADU",
  logoAlt = "Acton ADU logo",
}: {
  prospectName: string;
  prospectNames?: string[];
  salespersonDisplayName: string | null;
  meetingDate: string | null;
  meetingOutcome: string | null;
  qualification: string | null;
  generatedAt: string | null;
  logoUrl?: string | null;
  companyName?: string;
  logoAlt?: string;
}) {
  const exportedOn = formatDate(new Date().toISOString());
  const homeowners =
    (prospectNames?.length ?? 0) > 1 ? prospectNames!.filter((n) => n.trim()) : null;

  return (
    <section
      data-testid="pem-neat-print-header"
      className="pem-neat-print-header mb-5 hidden border-b border-[var(--acton-border)] pb-4 print:block print:break-inside-avoid"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {logoUrl ? (
            <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
              <Image
                src={logoUrl}
                alt={logoAlt}
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
                unoptimized
              />
            </span>
          ) : null}
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-[var(--acton-muted)] uppercase">
              Partnership Evaluation Meeting NEAT
            </p>
            <p className="mt-0.5 text-xs text-[var(--acton-muted)]">{companyName}</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--acton-navy)]">{prospectName}</h1>
            {homeowners ? (
              <p className="mt-1 text-sm text-[var(--acton-muted)]">
                Homeowners: {homeowners.join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
        <p className="rounded border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-2 py-1 text-[11px] font-semibold tracking-wide text-[var(--acton-navy)] uppercase">
          Internal — Acton ADU
        </p>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">Salesperson</dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {formatHumanDisplayName(salespersonDisplayName)}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Meeting date
          </dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {formatMeetingDate(meetingDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">Outcome</dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {meetingOutcome ? formatMeetingOutcomeLabel(meetingOutcome) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Qualification
          </dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {qualification ? formatEnumLabel(qualification) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            NEAT generated
          </dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {formatGeneratedAt(generatedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">Exported on</dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">{exportedOn}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] text-[var(--acton-muted)]">
        Internal coaching document — contains salesperson performance assessment. Not for customer
        distribution.
      </p>
    </section>
  );
}
