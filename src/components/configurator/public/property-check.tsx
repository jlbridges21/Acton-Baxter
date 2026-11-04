"use client";

/**
 * "Check to see if this plan works on your property." — the existing Property Check popup
 * with Can I Build's search widget.
 *
 * Integration surface (the widget's public embed contract, not its internals):
 *   <script type="module" src="https://search-widget.canibuild.com/embed.js">
 *   <div id="canibuild-widget-search-root" data-token="…" data-design-name="…">
 * The widget forwards this page's query string (series, model, exterior, …) to Can I Build's
 * Lead Converter, and `data-design-name` names the selected plan. Whether Can I Build then
 * restricts results to that design is configured on Can I Build's side and must be confirmed
 * with them. The token is the same publishable widget token the live site uses.
 *
 * The widget node is created once and kept mounted (the modal only hides), because the
 * embed script attaches to the root element a single time.
 */

import { useEffect, useRef, useState } from "react";
import type { GhlSubmission } from "@/lib/configurator/ghl-messages";
import type { PublicModel } from "@/lib/configurator/public-catalog";
import { Modal } from "./parts";

const WIDGET_SRC = "https://search-widget.canibuild.com/embed.js";
let widgetScript: Promise<void> | null = null;

function loadWidgetScript(): Promise<void> {
  if (widgetScript) return widgetScript;
  widgetScript = new Promise((resolve, reject) => {
    const existing = document.getElementById("canibuild-widget-script");
    if (existing) return resolve();
    const script = document.createElement("script");
    script.type = "module";
    script.id = "canibuild-widget-script";
    script.src = WIDGET_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Can I Build widget failed to load"));
    document.body.appendChild(script);
  });
  return widgetScript;
}

export function PropertyCheckModal({
  open,
  onClose,
  model,
  canibuildEnabled,
  canibuildToken,
  prefill,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  model: PublicModel;
  canibuildEnabled: boolean;
  canibuildToken: string;
  prefill: Partial<GhlSubmission>;
  onContinue: (details: Partial<GhlSubmission>) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [widgetError, setWidgetError] = useState(false);
  const [form, setForm] = useState({
    city: prefill.city ?? "",
    postalCode: prefill.postalCode ?? "",
    firstName: prefill.firstName ?? "",
    lastName: prefill.lastName ?? "",
    email: prefill.email ?? "",
    phone: prefill.phone ?? "",
  });

  useEffect(() => {
    if (!open || !canibuildEnabled) return;
    loadWidgetScript().catch(() => setWidgetError(true));
  }, [open, canibuildEnabled]);

  // The widget watches data-design-name, so model changes reach it without remounting.
  useEffect(() => {
    rootRef.current?.setAttribute("data-design-name", model.canibuildDesignName || model.name);
  }, [model.canibuildDesignName, model.name]);

  const field = (key: keyof typeof form, placeholder: string, type = "text") => (
    <input
      type={type}
      value={form[key]}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      className="w-full rounded border px-3 py-2"
    />
  );

  return (
    <Modal open={open} onClose={onClose} labelledBy="property-check-title">
      <h2 id="property-check-title" className="mb-2 text-2xl font-semibold">
        Property Check
      </h2>
      <p className="mb-4 text-sm text-gray-600">Enter your address and contact info</p>
      {canibuildEnabled ? (
        <div className="mb-4 w-full" data-testid="canibuild-mount">
          <div
            ref={rootRef}
            id="canibuild-widget-search-root"
            data-token={canibuildToken}
            data-design-name={model.canibuildDesignName || model.name}
            className="w-full"
          />
          {widgetError ? (
            <p className="mt-2 text-sm text-gray-500">
              The property search is unavailable right now. Please try again later.
            </p>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onContinue(form);
        }}
      >
        <div className="mb-3 grid grid-cols-2 gap-3">
          {field("city", "City")}
          {field("postalCode", "Zip Code")}
        </div>
        <h3 className="mb-2 font-medium">Contact Info</h3>
        <div className="mb-3 grid grid-cols-2 gap-3">
          {field("firstName", "First Name")}
          {field("lastName", "Last Name")}
        </div>
        <div className="mb-3">{field("email", "Email", "email")}</div>
        <div className="mb-4">{field("phone", "Phone", "tel")}</div>
        <button
          type="submit"
          className="w-full rounded bg-gray-200 py-3 text-lg font-semibold text-gray-700 hover:bg-gray-300"
        >
          Continue
        </button>
      </form>
    </Modal>
  );
}
