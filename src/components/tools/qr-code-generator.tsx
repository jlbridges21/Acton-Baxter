"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  generateQrAssets,
  normalizeQrInput,
  QR_PNG_FILENAME,
  QR_PNG_SIZES,
  QR_SVG_FILENAME,
  type QrPngSizeId,
} from "@/lib/tools/qr";

type QrResult = {
  text: string;
  pngDataUrl: string;
  svg: string;
};

function downloadFile(filename: string, href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function QrCodeGenerator() {
  const [draft, setDraft] = useState("");
  const [sizeId, setSizeId] = useState<QrPngSizeId>("medium");
  const [result, setResult] = useState<QrResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(text: string, pixels: number) {
    const normalized = normalizeQrInput(text);
    if (!normalized) {
      setResult(null);
      setError("Enter a link or some text first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const assets = await generateQrAssets(normalized, pixels);
      setResult({ text: normalized, ...assets });
    } catch {
      setResult(null);
      setError("Couldn't create a QR code from that. Try a shorter message.");
    } finally {
      setBusy(false);
    }
  }

  const pngPixels = QR_PNG_SIZES.find((entry) => entry.id === sizeId)?.pixels ?? 512;

  return (
    <div data-testid="qr-generator" className="w-full space-y-4">
      <Card>
        <CardTitle>Link or text</CardTitle>
        <CardDescription className="mt-2">
          A web address without https:// is filled in for you. A phone number or short message is
          encoded as written.
        </CardDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void generate(draft, pngPixels);
          }}
        >
          <label className="block text-sm font-medium text-[var(--acton-navy)]" htmlFor="qr-input">
            URL or text
          </label>
          <Input
            id="qr-input"
            name="qr"
            value={draft}
            autoComplete="off"
            placeholder="actonadu.com or a short message"
            onChange={(event) => setDraft(event.target.value)}
          />
          <fieldset>
            <legend className="text-sm font-medium text-[var(--acton-navy)]">PNG size</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {QR_PNG_SIZES.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant={preset.id === sizeId ? "primary" : "secondary"}
                  className="min-h-11 flex-1"
                  aria-pressed={preset.id === sizeId}
                  onClick={() => {
                    setSizeId(preset.id);
                    if (result) void generate(result.text, preset.pixels);
                  }}
                >
                  {preset.label}
                  <span className="font-normal opacity-80">{preset.pixels}px</span>
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--acton-muted)]">
              SVG stays sharp at any print size. PNG size is for screen and email.
            </p>
          </fieldset>
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Preview</CardTitle>
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="mt-4 space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL, not a remote image */}
            <img
              src={result.pngDataUrl}
              alt={`QR code for ${result.text}`}
              className="h-auto w-full max-w-[280px]"
            />
            <p className="text-sm break-all text-[var(--acton-muted)]">Encoded: {result.text}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="min-h-11 w-full sm:flex-1"
                onClick={() => downloadFile(QR_PNG_FILENAME, result.pngDataUrl)}
              >
                Download PNG
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 w-full sm:flex-1"
                onClick={() => {
                  const blob = new Blob([result.svg], { type: "image/svg+xml" });
                  const url = URL.createObjectURL(blob);
                  downloadFile(QR_SVG_FILENAME, url);
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download SVG
              </Button>
            </div>
          </div>
        ) : !error ? (
          <CardDescription className="mt-2">
            Paste a link or a short message, then generate a code. Nothing is saved.
          </CardDescription>
        ) : null}
      </Card>
    </div>
  );
}
