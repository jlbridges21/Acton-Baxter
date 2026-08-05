"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Map } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { FullReport } from "@/lib/research/db-types";
import type { NormalizedMaps } from "@/lib/research/schemas";
import { formatNumber } from "@/lib/utils";

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
            Copy this APN for county assessor or Property Profile search.
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
    rings = (geo.coordinates as number[][][][]).flatMap((polygon) => polygon);
  }

  rings = rings.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return null;

  const lons = rings.flatMap((ring) => ring.map((c) => c[0]!)).filter((n) => Number.isFinite(n));
  const lats = rings.flatMap((ring) => ring.map((c) => c[1]!)).filter((n) => Number.isFinite(n));
  if (!lons.length || !lats.length) return null;

  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = maxLon - minLon || 1;
  const height = maxLat - minLat || 1;
  const pad = 8;
  const vb = 200;

  return (
    <svg viewBox={`0 0 ${vb} ${vb}`} className="h-40 w-full" role="img" aria-label="Parcel outline">
      <rect width={vb} height={vb} fill="#f4f6f8" />
      {rings.map((ring, ringIndex) => {
        const points = ring
          .map(([lon, lat]) => {
            const x = pad + ((lon! - minLon) / width) * (vb - pad * 2);
            const y = pad + ((maxLat - lat!) / height) * (vb - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        return (
          <polygon
            key={`${ringIndex}-${points.slice(0, 24)}`}
            points={points}
            fill="rgba(11, 37, 69, 0.12)"
            stroke="#0b2545"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

function ParcelMapVisual({
  report,
  geometry,
  googleImageryAvailable,
}: {
  report: FullReport;
  geometry: unknown;
  googleImageryAvailable: boolean;
}) {
  if (!googleImageryAvailable) {
    return <ParcelOutline geometry={geometry} />;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy returns Google Static Maps bytes */}
      <img
        src={`/api/reports/${report.id}/imagery?view=parcel`}
        alt={`Satellite parcel boundary for ${report.standardized_address ?? report.input_address}`}
        className="h-64 w-full object-cover print:h-56"
        loading="eager"
        onError={(event) => {
          const target = event.currentTarget;
          target.style.display = "none";
          const fallback = target.nextElementSibling;
          if (fallback instanceof HTMLElement) fallback.hidden = false;
        }}
      />
      <div hidden>
        <ParcelOutline geometry={geometry} />
      </div>
    </>
  );
}

export function ParcelAndPublicRecords({ report }: { report: FullReport }) {
  const maps = (report.maps_json ?? null) as NormalizedMaps | null;
  const profileUrl = report.property_profile_url ?? maps?.countyPropertyProfileReportUrl ?? null;
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
  const parcelGeometry = report.parcelGeometry?.geometry_geojson ?? null;
  const googleImageryAvailable =
    parcelGeometry != null &&
    report.latitude != null &&
    report.longitude != null &&
    maps?.satelliteImageAvailable !== false;

  const profileOpenLabel =
    report.property_profile_access_type === "direct_report"
      ? "Open County Property Profile"
      : "Search County Property Profile";

  return (
    <Card>
      <CardTitle>Parcel and public records</CardTitle>
      <CardDescription>
        Parcel boundary and official record links for salesperson follow-up.
      </CardDescription>
      <div className="mt-4 break-inside-avoid overflow-hidden rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] sm:max-w-2xl">
        {parcelGeometry ? (
          <ParcelMapVisual
            report={report}
            geometry={parcelGeometry}
            googleImageryAvailable={googleImageryAvailable}
          />
        ) : (
          <div className="flex min-h-40 items-center justify-center px-4 text-center">
            <div>
              <Map className="mx-auto h-8 w-8 text-[var(--acton-navy)]" />
              <p className="mt-2 text-sm font-semibold text-[var(--acton-navy)]">
                Parcel map preview
              </p>
              <p className="mt-1 text-xs text-[var(--acton-muted)]">Parcel geometry unavailable</p>
            </div>
          </div>
        )}
        {report.parcelGeometry ? (
          <p className="border-t border-[var(--acton-border)] px-3 py-2 text-xs text-[var(--acton-muted)]">
            {googleImageryAvailable ? "Parcel boundary over satellite imagery" : "Parcel outline"} ·
            ~{formatNumber(report.parcelGeometry.calculated_area_sq_ft)} sq ft calculated · Verify
            against recorded survey/title documents
          </p>
        ) : null}
      </div>
      <div className="mt-4 max-w-2xl">
        {report.apn ? <CopyableApn apn={report.apn} /> : null}
        <LinkRow label="Google Maps" href={googleMapsUrl} />
        <LinkRow label="Tract / assessor search" href={tractUrl} />
        <LinkRow label="Permit search" href={permitUrl} />
        <LinkRow label={profileOpenLabel} href={profileUrl} />
        {profileUrl && report.apn ? (
          <p className="border-t border-[var(--acton-border)] py-2 text-xs text-[var(--acton-muted)]">
            County Property Profile has no embeddable preview. Open the search link and look up APN{" "}
            <span className="font-mono font-semibold text-[var(--acton-navy)]">{report.apn}</span>.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
