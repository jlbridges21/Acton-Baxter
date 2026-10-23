import Link from "next/link";

export default function ReportNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Report not found</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--acton-muted)]">
        This report doesn&apos;t exist, was deleted, or hasn&apos;t been shared with you.
      </p>
      <Link
        href="/reports"
        className="mt-6 inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
      >
        Back to Reports
      </Link>
    </div>
  );
}
