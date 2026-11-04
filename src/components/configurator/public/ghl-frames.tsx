"use client";

/**
 * The existing GoHighLevel (LeadConnector) forms, embedded exactly as before: same form IDs,
 * same widget URL and GHL's own form_embed.js. Submissions go straight from the iframe to
 * GHL, so workflows, consent and webhooks are unchanged.
 */

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { isGhlOrigin, parseGhlMessage, type GhlSubmission } from "@/lib/configurator/ghl-messages";

export const GHL_FORM_BASE = "https://api.leadconnectorhq.com/widget/form/";
export const GHL_EMBED_SCRIPT = "https://link.msgsndr.com/js/form_embed.js";

export function GhlEmbedScript() {
  return <Script id="ghl-form-embed" src={GHL_EMBED_SCRIPT} strategy="afterInteractive" />;
}

type FrameProps = {
  formId: string;
  title: string;
  query?: string;
  /** Container height before GHL reports its own. */
  initialHeight: number;
  /** Fixed scroll box (modals) vs. grow with the form (quote step). */
  mode: "box" | "grow";
  onSubmitted?: (submission: GhlSubmission) => void;
  loadingText?: string;
  testId?: string;
};

/**
 * One GHL form iframe. Only messages coming from *this* iframe are handled, so a submit in
 * the pricing popup is never mistaken for a quote request (a legacy bug).
 */
export function GhlFormFrame({
  formId,
  title,
  query,
  initialHeight,
  mode,
  onSubmitted,
  loadingText,
  testId,
}: FrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [height, setHeight] = useState(initialHeight);
  const submitted = useRef(onSubmitted);
  useEffect(() => {
    submitted.current = onSubmitted;
  }, [onSubmitted]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isGhlOrigin(event.origin)) return;
      if (ref.current && event.source && event.source !== ref.current.contentWindow) return;
      const message = parseGhlMessage(event.data);
      if (message.type === "resize" && mode === "grow")
        setHeight(Math.max(700, message.height) + 16);
      if (message.type === "submitted") submitted.current?.(message.submission);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode]);

  const src = `${GHL_FORM_BASE}${formId}${query ? `?${query}` : ""}`;
  return (
    <div
      className="relative"
      data-testid={testId}
      style={{
        height: mode === "box" ? 500 : height,
        borderRadius: 12,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {!loaded ? (
        <div className="absolute inset-x-0 top-0 animate-pulse rounded-md bg-gray-200 p-4 text-gray-600">
          {loadingText ?? "Loading…"}
        </div>
      ) : null}
      <iframe
        ref={ref}
        key={src}
        id={`inline-${formId}`}
        title={title}
        src={src}
        loading="eager"
        allow="clipboard-write; geolocation"
        onLoad={() => setLoaded(true)}
        data-layout="{'id':'INLINE'}"
        data-trigger-type="alwaysShow"
        data-activation-type="alwaysActivated"
        data-deactivation-type="neverDeactivate"
        data-form-name={title}
        data-height={mode === "box" ? 1275 : initialHeight}
        data-layout-iframe-id={`inline-${formId}`}
        data-form-id={formId}
        style={{
          width: "100%",
          height: mode === "box" ? 1275 : "100%",
          border: "none",
          display: "block",
          visibility: loaded ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
