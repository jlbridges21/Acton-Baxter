"use client";

export function InfoPopover({
  label,
  content,
  x,
  y,
  onClose,
}: {
  label: string | null;
  content: string | null;
  x: number;
  y: number;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-20 w-60 rounded-md border border-[var(--acton-border)] bg-white p-3 text-[var(--acton-navy)] shadow-lg"
      style={{ left: x, top: y }}
    >
      {label ? <p className="text-sm font-semibold">{label}</p> : null}
      {content ? <p className="mt-1 text-sm text-[var(--acton-muted)]">{content}</p> : null}
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-[var(--acton-navy)] underline"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}
