"use client";

import { ExternalLink, MapPinned } from "lucide-react";
import { ReportNotice, ReportSection } from "./report-section";
import type { FullReport } from "@/lib/research/db-types";
import type { NormalizedMaps } from "@/lib/research/schemas";

function MapsImage({
  src,
  alt,
  fallbackLabel,
}: {
  src: string;
  alt: string;
  fallbackLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied Google Static Maps bytes */}
      <img
        src={src}
        alt={alt}
        className="aspect-[8/5] w-full object-cover sm:aspect-auto sm:h-52 print:h-40"
        loading="lazy"
        onError={(event) => {
          const target = event.currentTarget;
          target.style.display = "none";
          const sibling = target.nextElementSibling;
          if (sibling instanceof HTMLElement) sibling.hidden = false;
        }}
      />
      <div
        hidden
        className="flex aspect-[8/5] items-center justify-center px-4 text-center text-sm text-[var(--acton-muted)] sm:aspect-auto sm:h-52"
      >
        {fallbackLabel}
      </div>
    </div>
  );
}

export function PropertyImagerySection({ report }: { report: FullReport }) {
  const maps = (report.maps_json ?? null) as NormalizedMaps | null;
  const hasCoords = report.latitude != null && report.longitude != null;
  const googleMapsUrl =
    maps?.googleMapsUrl ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      report.standardized_address ?? report.input_address,
    )}`;
  const streetViewLink =
    maps?.streetViewUrl ??
    (hasCoords
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${report.latitude},${report.longitude}`
      : googleMapsUrl);

  return (
    <ReportSection
      id="imagery"
      title="Imagery & maps"
      description="What the lot and street frontage look like today — the first read on access, existing structures, and yard space."
      sourceNote="Source: Google Maps satellite and Street View imagery. Verify on site before relying on setbacks or accessory structures."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {hasCoords ? (
          <>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Satellite
              </p>
              <MapsImage
                src={`/api/reports/${report.id}/imagery?view=satellite`}
                alt={`Satellite view of ${report.standardized_address ?? report.input_address}`}
                fallbackLabel="Satellite imagery unavailable (enable Maps Static API or check coordinates)."
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
                Street View
              </p>
              <MapsImage
                src={`/api/reports/${report.id}/imagery?view=street`}
                alt={`Street view of ${report.standardized_address ?? report.input_address}`}
                fallbackLabel="Street View unavailable for this location."
              />
            </div>
          </>
        ) : (
          <ReportNotice className="col-span-full">
            <span className="flex items-start gap-2">
              <MapPinned className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Coordinates were not available to load Google imagery for this report.
            </span>
          </ReportNotice>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 print:hidden">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
        >
          Open in Google Maps
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href={streetViewLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
        >
          Open Street View
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </ReportSection>
  );
}
