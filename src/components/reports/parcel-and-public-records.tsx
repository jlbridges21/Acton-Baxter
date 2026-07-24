"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Map } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { FullReport } from "@/lib/research/db-types";
import type { NormalizedMaps } from "@/lib/research/schemas";
import { formatNumber } from "@/lib/utils";
import { JurisdictionReportCard } from "./jurisdiction-report-card";

const ASSESSOR_PROPERTY_SEARCH_URL =
  "https://asr.santaclaracounty.gov/online-services/property-search/real-property";
const SAN_JOSE_PERMIT_SEARCH_URL = "https://permits.sanjoseca.gov/search/";

function LinkRow({ label, href }: { label: string; href: string | null | undefined }) {
  if (!href) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-[var(--acton-border)] py-2 text-sm">
        <span className="text-[var(--acton-muted)]">{label}</span>
        <span className="text-[var(--acton-muted)]">Not available</span>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--acton-border)] py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--acton-navy)]">{label}</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[var(--acton-navy)] underline print:hidden"
        >
          Open
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <p className="mt-1 hidden text-xs break-all text-[var(--acton-muted)] print:block">{href}</p>
    </div>
  );
}

function CopyableApn({ apn }: { apn: string }) {
  const [copied, setCopied] = useState(false);

  async function copyApn() {
    try {
      await navigator.clipboard.writeText(apn);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="border-t border-[var(--acton-border)] py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--acton-navy)]">APN</p>
          <p className="mt-1 font-mono text-base tracking-wide text-[var(--acton-navy)]">{apn}</p>
          <p className="mt-1 text-xs text-[var(--acton-muted)]">
            Copy this APN, then open Tract / assessor search and paste it into the county search.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyApn()}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)] print:hidden"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy APN"}
        </button>
      </div>
      <p className="mt-2 hidden text-xs text-[var(--acton-muted)] print:block">APN: {apn}</p>
    </div>
  );
}

function ParcelOutline({ geometry }: { geometry: unknown }) {
  const geo = geometry as {
    type?: string;
    coordinates?: unknown;
  } | null;

  if (!geo?.coordinates) {
    return null;
  }

  let rings: number[][][] = [];
  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    rings = geo.coordinates as number[][][];
  } else if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    rings = (geo.coordinates as number[][][][])[0] ?? [];
  }

  const outer = rings[0];
  if (!outer || outer.length < 3) return null;

  const lons = outer.map((c) => c[0]!).filter((n) => Number.isFinite(n));
  const lats = outer.map((c) => c[1]!).filter((n) => Number.isFinite(n));
  if (!lons.length || !lats.length) return null;

  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = maxLon - minLon || 1;
  const height = maxLat - minLat || 1;
  const pad = 8;
  const vb = 200;

  const points = outer
    .map(([lon, lat]) => {
      const x = pad + ((lon! - minLon) / width) * (vb - pad * 2);
      const y = pad + ((maxLat - lat!) / height) * (vb - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${vb} ${vb}`} className="h-40 w-full" role="img" aria-label="Parcel outline">
      <rect width={vb} height={vb} fill="#f4f6f8" />
      <polygon
        points={points}
        fill="rgba(11, 37, 69, 0.12)"
        stroke="#0b2545"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ParcelAndPublicRecords({ report }: { report: FullReport }) {
  const maps = (report.maps_json ?? null) as NormalizedMaps | null;
  const profileUrl = report.property_profile_url ?? maps?.countyPropertyProfileReportUrl ?? null;
  const accessType = report.property_profile_access_type ?? null;
  const tractUrl = ASSESSOR_PROPERTY_SEARCH_URL;
  const isSanJose = report.jurisdiction_name?.toLowerCase().includes("san jose");
  const permitUrl = isSanJose
    ? SAN_JOSE_PERMIT_SEARCH_URL
    : (maps?.permitSearchUrl ?? SAN_JOSE_PERMIT_SEARCH_URL);
  const googleMapsUrl =
    maps?.googleMapsUrl ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      report.standardized_address ?? report.input_address,
    )}`;

  const openLabel =
    accessType === "direct_report"
      ? "Open County Property Profile"
      : accessType === "recreated_from_layers"
        ? "Open County Mapping Source"
        : "Search County Property Profile";

  const notes =
    report.property_profile_status_message ??
    "County Property Profile access depends on public ArcGIS Experience capabilities.";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle>Parcel and public records</CardTitle>
        <CardDescription>
          Parcel boundary and official record links for salesperson follow-up.
        </CardDescription>
        <div className="mt-4 overflow-hidden rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
          {report.parcelGeometry?.geometry_geojson ? (
            <ParcelOutline geometry={report.parcelGeometry.geometry_geojson} />
          ) : (
            <div className="flex min-h-40 items-center justify-center px-4 text-center">
              <div>
                <Map className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
                <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                  Parcel map preview
                </p>
                <p className="mt-1 text-xs text-[var(--acton-muted)]">
                  Parcel geometry unavailable
                </p>
              </div>
            </div>
          )}
          {report.parcelGeometry ? (
            <p className="border-t border-[var(--acton-border)] px-3 py-2 text-xs text-[var(--acton-muted)]">
              Parcel polygon · ~{formatNumber(report.parcelGeometry.calculated_area_sq_ft)} sq ft
              calculated
            </p>
          ) : null}
        </div>
        <div className="mt-4">
          {report.apn ? <CopyableApn apn={report.apn} /> : null}
          <LinkRow label="Google Maps" href={googleMapsUrl} />
          <LinkRow label="County Property Profile Report" href={profileUrl} />
          <LinkRow label="Tract / assessor search" href={tractUrl} />
          <LinkRow label="Permit search" href={permitUrl} />
        </div>
      </Card>

      <JurisdictionReportCard
        title="Santa Clara County Property Profile Report"
        jurisdictionName="Santa Clara County"
        available={Boolean(profileUrl)}
        reportUrl={profileUrl}
        openLabel={openLabel}
        thumbnailLabel="Property profile preview"
        notes={notes}
        accessType={accessType}
        searchHint={
          accessType === "generic_search" && report.apn ? `Search using APN ${report.apn}` : null
        }
      />
    </div>
  );
}
