import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--acton-gray-50)] px-4 text-center">
      <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--acton-muted)]">
        The page or report you requested does not exist.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-10 items-center rounded-md bg-[var(--acton-navy)] px-4 text-sm font-semibold text-white"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
