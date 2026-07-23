"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ProviderTestResult = {
  address: string;
  attom: {
    status: string;
    responseTimeMs: number | null;
    message: string | null;
    attomId?: string | null;
  };
  rentcast: {
    status: string;
    responseTimeMs: number | null;
    message: string | null;
    rentcastId?: string | null;
  };
  sanJose: { status: string; responseTimeMs: number | null; message: string | null };
  santaClara: { status: string; responseTimeMs: number | null; message: string | null };
  normalized: Record<string, string | number | null>;
  conflicts: Array<{ fieldLabel: string; severity: string; description: string }>;
};

export function ProviderTestClient() {
  const [address, setAddress] = useState("655 13th St, San Jose, CA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProviderTestResult | null>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/provider-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const payload = (await response.json()) as ProviderTestResult & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Provider test failed");
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider test failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Provider test</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Admin-only live provider diagnostics. Manual tests may use paid API credits.
        </p>
      </div>

      <Card>
        <CardTitle>Test address</CardTitle>
        <CardDescription className="mt-2">
          Runs ATTOM, RentCast, San Jose GIS, and Santa Clara County GIS lookups without creating a
          saved report.
        </CardDescription>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input value={address} onChange={(event) => setAddress(event.target.value)} />
          <Button type="button" variant="accent" onClick={runTest} disabled={loading}>
            {loading ? "Testing..." : "Run provider test"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["ATTOM", result.attom],
              ["RentCast", result.rentcast],
              ["San Jose GIS", result.sanJose],
              ["Santa Clara County GIS", result.santaClara],
            ].map(([label, info]) => {
              const row = info as {
                status: string;
                responseTimeMs: number | null;
                message: string | null;
              };
              return (
                <Card key={String(label)}>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{String(label)}</CardTitle>
                    <Badge tone={row.status === "active" ? "green" : "amber"}>{row.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-[var(--acton-muted)]">
                    {row.responseTimeMs != null ? `${row.responseTimeMs} ms` : "—"}
                  </p>
                  {row.message ? (
                    <p className="mt-2 text-xs text-[var(--acton-muted)]">{row.message}</p>
                  ) : null}
                </Card>
              );
            })}
          </div>

          <Card>
            <CardTitle>Normalized fields</CardTitle>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(result.normalized).map(([key, value]) => (
                <div key={key} className="border-t border-[var(--acton-border)] pt-2">
                  <dt className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                    {key}
                  </dt>
                  <dd className="text-sm font-semibold text-[var(--acton-navy)]">
                    {value === null || value === undefined || value === ""
                      ? "Not available"
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {result.conflicts.length > 0 ? (
            <Card>
              <CardTitle>Conflicts</CardTitle>
              <ul className="mt-3 space-y-2 text-sm text-[var(--acton-muted)]">
                {result.conflicts.map((conflict) => (
                  <li key={`${conflict.fieldLabel}-${conflict.description}`}>
                    <span className="font-semibold text-[var(--acton-navy)]">
                      {conflict.fieldLabel} ({conflict.severity}):
                    </span>{" "}
                    {conflict.description}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
