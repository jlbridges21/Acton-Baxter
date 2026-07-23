"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { BrandingWithLogo } from "@/lib/branding/types";

export function BrandingForm({ initial }: { initial: BrandingWithLogo }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [reportTitle, setReportTitle] = useState(initial.reportTitle);
  const [logoAltText, setLogoAltText] = useState(initial.logoAltText);
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logoUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveSettings() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, reportTitle, logoAltText }),
      });
      const payload = (await response.json()) as {
        branding?: BrandingWithLogo;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to save branding");
      }
      if (payload.branding) {
        setCompanyName(payload.branding.companyName);
        setReportTitle(payload.branding.reportTitle);
        setLogoAltText(payload.branding.logoAltText);
        setLogoUrl(payload.branding.logoUrl);
      }
      setMessage("Branding settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save branding");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/branding/logo", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        branding?: BrandingWithLogo;
        logoUrl?: string | null;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to upload logo");
      }
      const nextUrl = payload.branding?.logoUrl ?? payload.logoUrl ?? null;
      setLogoUrl(nextUrl);
      if (payload.branding?.logoAltText) {
        setLogoAltText(payload.branding.logoAltText);
      }
      setMessage("Logo uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload logo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function removeLogo() {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/branding/logo", { method: "DELETE" });
      const payload = (await response.json()) as {
        branding?: BrandingWithLogo;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to remove logo");
      }
      setLogoUrl(payload.branding?.logoUrl ?? null);
      setMessage("Custom logo removed. Default Acton mark restored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove logo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Branding</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Configure company name, report title, and logo used in navigation and reports.
        </p>
      </div>

      <Card>
        <CardTitle>Company logo</CardTitle>
        <CardDescription className="mt-2">
          PNG, JPG, or WEBP up to 2 MB. The logo uses object-fit contain and is not stretched.
        </CardDescription>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)]">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin preview of signed URL
              <img src={logoUrl} alt={logoAltText} className="h-16 w-16 object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-[var(--acton-muted)]">
                Default mark
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading..." : logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                disabled={uploading}
                onClick={() => void removeLogo()}
              >
                Remove logo
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Display settings</CardTitle>
        <CardDescription className="mt-2">
          Defaults are Acton ADU and Acton Property Research.
        </CardDescription>
        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="company-name"
              className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            >
              Company name
            </label>
            <Input
              id="company-name"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="report-title"
              className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            >
              Report title
            </label>
            <Input
              id="report-title"
              value={reportTitle}
              onChange={(event) => setReportTitle(event.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="logo-alt"
              className="mb-2 block text-sm font-semibold text-[var(--acton-navy)]"
            >
              Logo alt text
            </label>
            <Input
              id="logo-alt"
              value={logoAltText}
              onChange={(event) => setLogoAltText(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-green-700">{message}</p> : null}
          <Button
            type="button"
            variant="accent"
            disabled={saving}
            onClick={() => void saveSettings()}
          >
            {saving ? "Saving..." : "Save branding"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
