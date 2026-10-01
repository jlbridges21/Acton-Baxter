"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { embedIframeSnippet, publicTourUrl } from "@/lib/tours/embed-snippet";

export function ShareDialog({
  open,
  onClose,
  slug,
  isPublic,
  busy,
  onMakePublic,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  isPublic: boolean;
  busy: boolean;
  onMakePublic: () => void;
}) {
  const [showTitle, setShowTitle] = useState(true);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showShare, setShowShare] = useState(true);
  const [showFullscreen, setShowFullscreen] = useState(true);
  const [copied, setCopied] = useState<"url" | "iframe" | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pageUrl = publicTourUrl(origin || "http://localhost:3000", slug);
  const iframe = useMemo(
    () =>
      embedIframeSnippet({
        origin: origin || "http://localhost:3000",
        slug,
        showTitle,
        showThumbs,
        showShare,
        showFullscreen,
      }),
    [origin, slug, showTitle, showThumbs, showShare, showFullscreen],
  );

  async function copy(value: string, which: "url" | "iframe") {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader>
        <DialogTitle>Share tour</DialogTitle>
        <DialogDescription>
          {isPublic
            ? "Anyone with the link can open this tour."
            : "This tour is private. The public link and embed stay hidden until you publish it."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {isPublic ? (
          <>
            <label className="block text-sm">
              <span className="font-medium text-[var(--acton-navy)]">Public link</span>
              <input
                readOnly
                value={pageUrl}
                className="mt-1 w-full rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2 text-sm text-[var(--acton-navy)]"
              />
            </label>
            <Button type="button" variant="secondary" onClick={() => void copy(pageUrl, "url")}>
              {copied === "url" ? "Copied" : "Copy link"}
            </Button>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-[var(--acton-navy)]">Embed</legend>
              <div className="flex flex-wrap gap-3 text-sm text-[var(--acton-navy)]">
                <Toggle label="Title" checked={showTitle} onChange={setShowTitle} />
                <Toggle label="Thumbnails" checked={showThumbs} onChange={setShowThumbs} />
                <Toggle label="Share" checked={showShare} onChange={setShowShare} />
                <Toggle label="Fullscreen" checked={showFullscreen} onChange={setShowFullscreen} />
              </div>
              <textarea
                readOnly
                rows={4}
                value={iframe}
                className="w-full rounded-md border border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-3 py-2 font-mono text-xs text-[var(--acton-navy)]"
              />
              <Button type="button" variant="secondary" onClick={() => void copy(iframe, "iframe")}>
                {copied === "iframe" ? "Copied" : "Copy embed"}
              </Button>
            </fieldset>
          </>
        ) : (
          <p className="text-sm text-[var(--acton-navy)]">
            Visitors who are not signed in will not be able to open a private tour. Make it public
            when you are ready to share the link or embed it.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {isPublic ? null : (
          <Button type="button" disabled={busy} onClick={onMakePublic}>
            Make public
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
