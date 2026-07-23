import type { SelectedAddress } from "@/lib/address/types";
import { cn } from "@/lib/utils";

export function SelectedAddressCard({
  address,
  className,
  onClear,
}: {
  address: SelectedAddress;
  className?: string;
  onClear?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
            Confirmed address
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--acton-navy)]">
            {address.formattedAddress}
          </p>
        </div>
        {onClear ? (
          <button
            type="button"
            className="text-xs font-semibold text-[var(--acton-navy)] underline"
            onClick={onClear}
          >
            Change
          </button>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--acton-muted)] uppercase">Street</dt>
          <dd className="font-medium text-[var(--acton-navy)]">{address.addressLine1}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--acton-muted)] uppercase">City</dt>
          <dd className="font-medium text-[var(--acton-navy)]">{address.city}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--acton-muted)] uppercase">State</dt>
          <dd className="font-medium text-[var(--acton-navy)]">{address.state}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--acton-muted)] uppercase">ZIP</dt>
          <dd className="font-medium text-[var(--acton-navy)]">{address.zipCode}</dd>
        </div>
        {address.county ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--acton-muted)] uppercase">County</dt>
            <dd className="font-medium text-[var(--acton-navy)]">{address.county}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
