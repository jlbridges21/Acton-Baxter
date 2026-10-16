export default function Loading() {
  return (
    <main className="min-h-screen bg-[var(--acton-gray-50)] px-4 py-8 sm:py-12">
      <div
        className="mx-auto w-full max-w-xl animate-pulse rounded-xl border border-[var(--acton-border)] bg-white p-8"
        role="status"
        aria-live="polite"
        aria-label="Loading survey"
      >
        <div className="h-6 w-2/3 rounded bg-[var(--acton-gray-100)]" />
        <div className="mt-3 h-4 w-full rounded bg-[var(--acton-gray-100)]" />
        <div className="mt-8 h-24 w-full rounded bg-[var(--acton-gray-100)]" />
      </div>
    </main>
  );
}
