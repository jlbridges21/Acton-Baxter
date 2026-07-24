import { Building2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function ActonLogo({
  href = "/",
  className,
  compact = false,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Baxter",
  logoAlt = "Baxter by Acton ADU",
}: {
  href?: string;
  className?: string;
  compact?: boolean;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 text-[var(--acton-navy)]", className)}>
      {logoUrl ? (
        <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-white">
          <Image
            src={logoUrl}
            alt={logoAlt}
            width={36}
            height={36}
            className="h-9 w-9 object-contain"
            unoptimized
          />
        </span>
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--acton-navy)] text-[var(--acton-yellow)]">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
      )}
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide">{companyName.toUpperCase()}</span>
        {!compact ? (
          <span className="block text-xs font-medium text-[var(--acton-muted)]">{reportTitle}</span>
        ) : null}
      </span>
    </Link>
  );
}
