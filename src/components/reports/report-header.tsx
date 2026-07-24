import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { FullReport } from "@/lib/research/db-types";

function statusTone(status: string) {
  switch (status) {
    case "complete":
      return "green" as const;
    case "failed":
      return "red" as const;
    case "researching":
      return "blue" as const;
    default:
      return "amber" as const;
  }
}

export function ReportHeader({
  report,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Property Research",
  logoAlt = "Acton ADU logo",
}: {
  report: FullReport;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const mailingDifferent =
    report.mailing_locality &&
    report.jurisdiction_name &&
    report.mailing_locality.toLowerCase() !== report.jurisdiction_name.toLowerCase();

  return (
    <section className="border-b border-[var(--acton-border)] pb-5 print:break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {logoUrl ? (
            <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white print:h-8 print:w-8">
              <Image
                src={logoUrl}
                alt={logoAlt}
                width={40}
                height={40}
                className="h-10 w-10 object-contain print:h-8 print:w-8"
                unoptimized
              />
            </span>
          ) : null}
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-[var(--acton-muted)] uppercase">
              {reportTitle}
            </p>
            <p className="mt-0.5 text-xs text-[var(--acton-muted)]">{companyName}</p>
            <h1 className="mt-1 text-2xl font-bold text-[var(--acton-navy)] sm:text-3xl">
              {report.standardized_address ?? report.input_address}
            </h1>
            <p className="mt-2 text-sm text-[var(--acton-muted)]">
              Report date {formatDate(report.completed_at ?? report.created_at)}
              {report.creator ? ` · Prepared for ${report.creator.full_name}` : null}
            </p>
          </div>
        </div>
        <Badge tone={statusTone(report.status)}>{report.status}</Badge>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">APN</dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">{report.apn ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
            Governing jurisdiction
          </dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {report.jurisdiction_name ?? "—"}
            {report.county ? `, ${report.county} County` : ""}
          </dd>
        </div>
        {mailingDifferent ? (
          <div>
            <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
              Mailing locality
            </dt>
            <dd className="text-sm font-semibold text-[var(--acton-navy)]">
              {report.mailing_locality}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">Version</dt>
          <dd className="text-sm font-semibold text-[var(--acton-navy)]">
            {report.report_version}
          </dd>
        </div>
      </dl>
    </section>
  );
}
