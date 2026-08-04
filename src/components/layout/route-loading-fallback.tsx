/**
 * Shared loading UI for route segments — instant visual feedback on navigation.
 */
export function RouteLoadingFallback({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="mx-auto max-w-7xl animate-pulse space-y-4 px-4 py-8 sm:px-6"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="route-loading"
    >
      <div className="h-8 w-56 rounded bg-[var(--acton-gray-100)]" />
      <div className="h-4 w-96 max-w-full rounded bg-[var(--acton-gray-100)]" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border border-[var(--acton-border)] bg-white p-4">
            <div className="h-3 w-20 rounded bg-[var(--acton-gray-100)]" />
            <div className="mt-4 h-8 w-16 rounded bg-[var(--acton-gray-100)]" />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border border-[var(--acton-border)] bg-white p-4">
            <div className="h-3 w-40 rounded bg-[var(--acton-gray-100)]" />
            <div className="mt-3 h-3 w-full rounded bg-[var(--acton-gray-100)]" />
            <div className="mt-2 h-3 w-3/4 rounded bg-[var(--acton-gray-100)]" />
          </div>
        ))}
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}
