"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ActonLogo } from "@/components/layout/acton-logo";
import { cn } from "@/lib/utils";

export function CompanyLogo({
  logoUrl,
  alt = "Acton ADU",
  companyName = "Acton ADU",
  productLabel = "Baxter",
  reportTitle,
  href = "/",
  className,
  compact = false,
}: {
  logoUrl?: string | null;
  alt?: string;
  companyName?: string;
  /** Shown as "Company - Product" next to the logo (e.g. Acton ADU - Baxter). */
  productLabel?: string;
  /** @deprecated Prefer productLabel; kept for call-site compatibility. */
  reportTitle?: string;
  href?: string;
  className?: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const product = productLabel || reportTitle || "Baxter";
  const displayName = `${companyName} - ${product}`;

  if (!logoUrl || failed) {
    return (
      <ActonLogo
        href={href}
        className={className}
        compact={compact}
        companyName={displayName}
        reportTitle=""
        logoAlt={alt}
      />
    );
  }

  return (
    <Link href={href} className={cn("flex items-center gap-2 text-[var(--acton-navy)]", className)}>
      <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-white">
        <Image
          src={logoUrl}
          alt={alt}
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
          unoptimized
          onError={() => setFailed(true)}
        />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-wide">{displayName}</span>
      </span>
    </Link>
  );
}
