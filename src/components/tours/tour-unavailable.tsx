export function TourUnavailable() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-[var(--acton-gray-50)] px-6 text-center">
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        Acton ADU
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--acton-navy)]">
        This tour is not available
      </h1>
      <p className="mt-2 max-w-sm text-sm text-[var(--acton-muted)]">
        The link may be private, or the tour may have been removed.
      </p>
    </div>
  );
}
