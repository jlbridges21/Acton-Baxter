"use client";

/* eslint-disable @next/next/no-img-element -- renderings come from storage at full size */

/**
 * Customer-facing Acton ADU configurator. Reproduces design.actonadu.com: every step is a
 * full-screen section in one vertical scroll-snap container (rendering left, options right),
 * a fixed price card bottom-right that stays blurred until the customer's location is
 * verified, and the existing GoHighLevel forms for pricing, saving and the free quote.
 *
 * Which image each step shows comes from the shared rendering rules (render.ts), so porch,
 * 9-ft ceiling, lighting and interior choices stay in sync across all steps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ghlPrefillQuery, type GhlSubmission } from "@/lib/configurator/ghl-messages";
import { formatDelta } from "@/lib/configurator/pricing";
import type { PublicCatalog, PublicModel } from "@/lib/configurator/public-catalog";
import { resolveStepImage, selectedCeiling } from "@/lib/configurator/render";
import { sortedEnabled, stepsForModel } from "@/lib/configurator/selection";
import type { StepId } from "@/lib/configurator/types";
import { GhlEmbedScript, GhlFormFrame } from "./ghl-frames";
import {
  FeatureCard,
  Modal,
  OptionCard,
  OptionList,
  PreApprovedPill,
  PriceTag,
  RenderView,
  ScrollHint,
  SiteHeader,
  StepLayout,
  Switch,
  ToggleBar,
} from "./parts";
import { PropertyCheckModal } from "./property-check";
import { useConfigurator, type LocationState } from "./use-configurator";

type Props = { catalog: PublicCatalog; preview: boolean; initialSearch: string };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function ConfiguratorApp({ catalog, preview, initialSearch }: Props) {
  const c = useConfigurator(catalog, { preview, initialSearch });
  const { model, selection } = c;
  const [modal, setModal] = useState<"location" | "save" | "property" | "floorplan" | null>(null);
  const [propertyMounted, setPropertyMounted] = useState(false);
  const [styleDetails, setStyleDetails] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(true);

  const steps = useMemo(() => stepsForModel(model), [model]);
  const styleName = useCallback(
    (id: string | null) => catalog.styles.find((s) => s.id === id)?.name ?? "",
    [catalog.styles],
  );
  const assetUrl = useCallback(
    (id: string | null | undefined) => (id ? (catalog.assets[id]?.display ?? null) : null),
    [catalog.assets],
  );
  const imageFor = useCallback(
    (step: StepId) => assetUrl(resolveStepImage(model, selection, step).assetId),
    [assetUrl, model, selection],
  );
  const priced = Boolean(c.sheet);
  const tag = useCallback(
    (amount: number | null | undefined) =>
      priced && typeof amount === "number" ? formatDelta(amount) : null,
    [priced],
  );

  // Style details only when the chosen interior has a details board.
  const interiorStyle = catalog.styles.find((s) => s.id === selection.interiorId);
  const detailsUrl = assetUrl(interiorStyle?.detailsAssetId);
  const showDetails = styleDetails && Boolean(detailsUrl);

  // Mobile scroll hint: hidden while scrolling, back after 5 s unless on the last step.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      setHint(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const index = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
        setHint(index < steps.length - 1);
      }, 5000);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [steps.length]);

  const header = <SiteHeader homeUrl={catalog.settings.homeUrl} onSave={() => setModal("save")} />;
  const ghlFields = useCallback(
    (section: string, extra: Partial<GhlSubmission> = {}) => {
      const applianceName =
        model.appliances.find((a) => a.id === selection.applianceId)?.name ?? "";
      const upgradeNames = selection.upgradeIds
        .map((id) => model.upgrades.find((u) => u.id === id)?.name)
        .filter(Boolean);
      const bath = model.bathrooms.find((b) => b.id === selection.bathroomId)?.name ?? "";
      const option = model.options.find((o) => o.id === selection.optionId)?.name ?? "";
      return {
        cfg_last_section: section,
        cfg_series: model.seriesSlug,
        cfg_model: model.slug,
        cfg_cb_design: model.canibuildDesignName || model.name,
        cfg_model_option: option,
        cfg_exterior: styleName(selection.exteriorId),
        cfg_interior: styleName(selection.interiorId),
        cfg_appliances: applianceName,
        cfg_upgrades: upgradeNames.join("\n"),
        cfg_bathrooms: bath ? `${styleName(selection.interiorId)} ${bath}` : "",
        cfg_view_mode: c.viewMode,
        cfg_is_mirrored: String(c.mirror),
        ...(extra.address ? { property_address: extra.address } : {}),
        ...(extra.city ? { property_city: extra.city } : {}),
        ...(extra.postalCode ? { property_zip: extra.postalCode } : {}),
      };
    },
    [model, selection, styleName, c.viewMode, c.mirror],
  );

  const syncToGhl = useCallback(
    (section: string, submission: GhlSubmission) => {
      void fetch("/api/public/configurator/ghl-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: submission.contactId ?? undefined,
          email: submission.email || undefined,
          phone: submission.phone || undefined,
          fields: ghlFields(section, submission),
        }),
      }).catch(() => undefined);
    },
    [ghlFields],
  );

  const onLocationSubmitted = useCallback(
    async (submission: GhlSubmission) => {
      syncToGhl("PricingLocation", submission);
      const result = await c.submitLocation(submission);
      if (result === "supported") setModal(null);
    },
    [c, syncToGhl],
  );

  // ------------------------------------------------------------------ model step image
  const floorplanUrl =
    c.viewMode === "floorplan"
      ? assetUrl(
          c.mirror
            ? (model.floorplans.mirror ?? model.floorplans.standard)
            : model.floorplans.standard,
        )
      : null;
  const modelImage = floorplanUrl ?? imageFor("model");

  const sections: Record<StepId, React.ReactNode> = {
    model: (
      <StepLayout
        key="model"
        section="ChooseModel"
        header={header}
        image={
          <RenderView
            src={modelImage}
            alt={`${model.name} ${c.viewMode === "floorplan" ? "floorplan" : "exterior"}`}
            testId="image-model"
            zoomable={Boolean(floorplanUrl)}
            onClick={() =>
              floorplanUrl &&
              window.matchMedia("(max-width: 767px)").matches &&
              setModal("floorplan")
            }
          />
        }
        toggles={
          <ToggleBar>
            <Switch
              label="Floorplan"
              on={c.viewMode === "floorplan"}
              disabled={!model.floorplans.standard}
              onToggle={() => c.setViewMode(c.viewMode === "floorplan" ? "elevation" : "floorplan")}
              testId="toggle-floorplan"
            />
            <Switch
              label="Mirror model"
              on={c.mirror}
              disabled={c.viewMode !== "floorplan" || !model.floorplans.mirror}
              onToggle={() => c.setMirror(!c.mirror)}
              testId="toggle-mirror"
            />
          </ToggleBar>
        }
      >
        <h2 className="mb-2 pt-4 text-[28px] text-[#2E2A22] md:text-2xl">Personalize Your Home</h2>
        <p className="mb-2 text-[16px] leading-[150%] text-[#6A624D] md:mb-4 md:text-[16px]">
          Choose from designer-curated exteriors, interiors, and upgrades to fully personalize your
          backyard home.
        </p>
        <button
          type="button"
          onClick={() => {
            setPropertyMounted(true);
            setModal("property");
          }}
          className="mb-3 cursor-pointer text-left text-[16px] leading-[150%] text-[#2E2A22] underline md:mb-6 md:text-[16px]"
        >
          Check to see if this plan works on your property.
        </button>
        <h3 className="mb-4 text-[18px] leading-[150%] text-[#2E2A22] md:text-[22px]">
          Choose a Model
        </h3>
        <OptionList label="Choose a Model">
          {c.seriesModels.map((m: PublicModel) => (
            <OptionCard
              key={m.id}
              label={m.name}
              selected={m.id === model.id}
              onSelect={() => c.selectModel(m)}
              testId={`model-${m.slug}`}
              right={
                m.preApproved ? (
                  <PreApprovedPill title={m.preApprovedTitle} cities={m.preApprovedCities} />
                ) : null
              }
            />
          ))}
        </OptionList>
      </StepLayout>
    ),
    options: (
      <StepLayout
        key="options"
        section="ModelOptions"
        header={header}
        image={
          <RenderView
            src={imageFor("options")}
            alt={`${model.name} exterior`}
            testId="image-options"
          />
        }
      >
        <ModelHeading name={model.name} sub="Model options" />
        <OptionList label="Model options">
          {sortedEnabled(model.options).map((o) => (
            <OptionCard
              key={o.id}
              label={o.name}
              selected={selection.optionId === o.id}
              onSelect={() => c.update({ optionId: o.id })}
              right={<PriceTag text={tag(c.sheet?.options[o.id])} />}
              testId={`option-${o.id}`}
            />
          ))}
        </OptionList>
      </StepLayout>
    ),
    exterior: (
      <StepLayout
        key="exterior"
        section="ExteriorStyles"
        header={header}
        image={
          <RenderView
            src={imageFor("exterior")}
            alt={`${styleName(selection.exteriorId)} exterior`}
            testId="image-exterior"
          />
        }
      >
        <ModelHeading name={model.name} sub="Exterior Styles" />
        <OptionList label="Exterior Styles">
          {sortedEnabled(model.exteriors).map((u) => (
            <OptionCard
              key={u.styleId}
              label={styleName(u.styleId)}
              selected={selection.exteriorId === u.styleId}
              onSelect={() => c.update({ exteriorId: u.styleId })}
              right={<PriceTag text={tag(c.sheet?.exteriors[u.styleId])} />}
              testId={`exterior-${u.styleId}`}
            />
          ))}
        </OptionList>
      </StepLayout>
    ),
    interior: (
      <StepLayout
        key="interior"
        section="InteriorStyles"
        header={header}
        image={
          <RenderView
            src={showDetails && detailsUrl ? detailsUrl : imageFor("interior")}
            alt={`${styleName(selection.interiorId)} interior`}
            testId="image-interior"
          />
        }
        toggles={
          <ToggleBar raised>
            <Switch
              label="Style details"
              on={showDetails}
              disabled={!detailsUrl}
              onToggle={() => setStyleDetails(!showDetails)}
              testId="toggle-details"
            />
          </ToggleBar>
        }
      >
        <ModelHeading name={model.name} sub="Interior Style" />
        <OptionList label="Interior Style">
          {sortedEnabled(model.interiors).map((u) => (
            <OptionCard
              key={u.styleId}
              label={styleName(u.styleId)}
              selected={selection.interiorId === u.styleId}
              onSelect={() => c.update({ interiorId: u.styleId })}
              right={<PriceTag text={tag(c.sheet?.interiors[u.styleId])} />}
              testId={`interior-${u.styleId}`}
            />
          ))}
        </OptionList>
      </StepLayout>
    ),
    appliances: (
      <StepLayout
        key="appliances"
        section="Appliances"
        header={header}
        image={
          <RenderView src={imageFor("appliances")} alt="Appliances" testId="image-appliances" />
        }
      >
        <ModelHeading name={model.name} sub="Appliances" tight />
        {!priced ? (
          <p className="mb-3 text-sm text-[#6A6A6A]">
            Enter your ZIP to see available appliances and pricing.
          </p>
        ) : null}
        <div className="flex flex-col gap-[8px] pb-25">
          {sortedEnabled(model.appliances).map((a) => (
            <FeatureCard
              key={a.id}
              title={a.name}
              lines={a.lines}
              priceText={tag(c.sheet?.appliances[a.id])}
              selected={selection.applianceId === a.id}
              onSelect={() => c.update({ applianceId: a.id })}
              testId={`appliance-${a.id}`}
            />
          ))}
        </div>
      </StepLayout>
    ),
    upgrades: (
      <StepLayout
        key="upgrades"
        section="Upgrades"
        header={header}
        image={<RenderView src={imageFor("upgrades")} alt="Upgrades" testId="image-upgrades" />}
      >
        <ModelHeading name={model.name} sub="Upgrades" tight />
        {!priced ? (
          <p className="mb-3 text-sm text-[#6A6A6A]">
            Enter your ZIP to see available upgrades and pricing.
          </p>
        ) : null}
        <div className="flex flex-col gap-[8px] pb-25">
          {sortedEnabled(model.upgrades).map((u) => (
            <FeatureCard
              key={u.id}
              title={u.name}
              lines={u.lines}
              priceText={tag(c.sheet?.upgrades[u.id])}
              selected={selection.upgradeIds.includes(u.id)}
              onSelect={() => c.selectUpgrade(u.id)}
              testId={`upgrade-${u.id}`}
            />
          ))}
        </div>
      </StepLayout>
    ),
    bathroom: (
      <StepLayout
        key="bathroom"
        section="Bathroom"
        header={header}
        image={<RenderView src={imageFor("bathroom")} alt="Bathroom" testId="image-bathroom" />}
      >
        <ModelHeading name={model.name} sub="Bathroom" />
        <OptionList label="Bathroom">
          {sortedEnabled(model.bathrooms).map((b) => (
            <OptionCard
              key={b.id}
              label={`${styleName(selection.interiorId)} ${b.name}`.trim()}
              selected={selection.bathroomId === b.id}
              onSelect={() => c.update({ bathroomId: b.id })}
              right={<PriceTag text={tag(c.sheet?.bathrooms[b.id])} />}
              testId={`bathroom-${b.id}`}
            />
          ))}
        </OptionList>
      </StepLayout>
    ),
    quote: (
      <StepLayout
        key="quote"
        section="FreeQuote"
        header={header}
        image={
          <RenderView src={imageFor("quote")} alt={`${model.name} exterior`} testId="image-quote" />
        }
      >
        <div className="no-scroll mx-auto w-full max-w-xl pb-2 md:p-4">
          <GhlFormFrame
            formId={catalog.settings.quoteFormId}
            title="Configurator Funnel - Get In Touch (GHL)"
            query={ghlPrefillQuery(c.prefill)}
            initialHeight={1235}
            mode="grow"
            onSubmitted={(s) => syncToGhl("FreeQuote", s)}
            testId="quote-form"
          />
        </div>
      </StepLayout>
    ),
  };

  return (
    <div
      className="configurator-root fixed inset-0 bg-white text-[#2E2A22]"
      data-testid="configurator"
      data-ceiling={selectedCeiling(model, selection)}
    >
      <GhlEmbedScript />
      <div
        ref={scroller}
        className="no-scrollbar relative h-screen snap-y snap-proximity overflow-y-auto overscroll-y-none scroll-smooth md:snap-mandatory"
      >
        {steps.map((step) => sections[step])}
      </div>

      <PriceCard
        quote={c.quote}
        financingEnabled={catalog.settings.financingEnabled}
        disclaimer={catalog.settings.financingDisclaimer}
        location={c.location}
        onOpen={() => setModal("location")}
      />
      <ScrollHint visible={hint} />

      {preview ? (
        <PreviewBar
          regions={catalog.regionsForPreview ?? []}
          regionId={c.previewRegionId}
          onRegion={c.setPreviewRegionId}
          version={catalog.version}
        />
      ) : null}

      <Modal open={modal === "location"} onClose={() => setModal(null)} labelledBy="location-title">
        <LocationModalBody
          catalog={catalog}
          location={c.location}
          onSubmitted={onLocationSubmitted}
          onPickCity={(city, pending) =>
            void c.submitLocation(pending, city).then((r) => r === "supported" && setModal(null))
          }
          onReset={() => c.setLocation({ status: "none" })}
          onClose={() => setModal(null)}
        />
      </Modal>

      <Modal open={modal === "save"} onClose={() => setModal(null)}>
        {modal === "save" ? (
          <GhlFormFrame
            formId={catalog.settings.saveFormId}
            title="Save Design Form (GHL)"
            initialHeight={816}
            mode="box"
            loadingText="Loading save design form…"
            onSubmitted={(s) => syncToGhl("SaveDesign", s)}
          />
        ) : null}
      </Modal>

      {propertyMounted ? (
        <PropertyCheckModal
          open={modal === "property"}
          onClose={() => setModal(null)}
          model={model}
          canibuildEnabled={catalog.settings.canibuildEnabled}
          canibuildToken={catalog.settings.canibuildToken}
          prefill={c.prefill}
          onContinue={(details) => {
            c.setPrefill({ ...c.prefill, ...details });
            setModal(null);
          }}
        />
      ) : null}

      <Modal open={modal === "floorplan"} onClose={() => setModal(null)} wide>
        {floorplanUrl ? (
          <img
            src={floorplanUrl}
            alt={`${model.name} floorplan`}
            className="w-full touch-pinch-zoom"
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ModelHeading({ name, sub, tight }: { name: string; sub: string; tight?: boolean }) {
  return (
    <>
      <h2 className="mb-2 text-[20px] font-semibold md:mb-6 md:text-4xl">{name}</h2>
      <h3 className={`${tight ? "mb-2" : "mb-4"} text-[16px] font-medium md:text-xl`}>{sub}</h3>
    </>
  );
}

function PriceCard({
  quote,
  financingEnabled,
  disclaimer,
  location,
  onOpen,
}: {
  quote: { total: number; monthly: number | null } | null;
  financingEnabled: boolean;
  disclaimer: string;
  location: LocationState;
  onOpen: () => void;
}) {
  const priced = quote !== null;
  // Placeholders only: no real price is in the page before the location is verified.
  const total = priced ? money(quote.total) : "$000,000";
  const monthly = priced && quote.monthly !== null ? money(quote.monthly) : "$0,000";
  const blur = priced ? "" : "blur-[6px] select-none";
  const tooltip =
    location.status === "outside"
      ? `Pricing isn't available in ${location.city || "your area"} yet`
      : disclaimer || "For accurate price estimate please provide your location";
  return (
    <div className="pointer-events-none fixed right-0 bottom-0 z-[1000] w-full px-[10px] pt-3 md:w-[30%] md:px-[20px]">
      <div
        role="button"
        tabIndex={0}
        data-testid="price-card"
        data-priced={priced ? "true" : "false"}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
        className="group pointer-events-auto relative w-full cursor-pointer rounded-[20px] rounded-b-none border border-gray-200 bg-[#F1F1F1] px-2 py-1 text-base md:px-5 md:py-3"
      >
        <span className="pointer-events-none absolute -top-9 right-0 rounded-md bg-gray-900 px-2 py-1 text-[12px] whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100">
          {tooltip}
        </span>
        <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] text-gray-500">
          i
        </span>
        <div className="flex">
          <div className="flex w-1/2 flex-col items-start justify-center">
            <p className="text-xs leading-[18px] text-[#777777] md:text-sm md:tracking-[0.25em]">
              STARTING AT
            </p>
            <p
              className={`text-[18px] whitespace-nowrap md:text-[28px] ${blur}`}
              data-testid="price-total"
              aria-hidden={!priced}
            >
              {total}
            </p>
            <p className="text-[10px] leading-[18px] text-[#777777] md:text-[12px]">+ Site Work</p>
          </div>
          {financingEnabled ? (
            <>
              <div className="mx-3 w-px bg-gray-300" />
              <div className="flex w-1/2 flex-col items-start justify-center pr-6 text-right">
                <p className="text-xs leading-[18px] text-[#777777] md:text-sm md:tracking-[0.25em]">
                  AS LITTLE AS
                </p>
                <p
                  className={`text-[18px] whitespace-nowrap md:text-[28px] ${blur}`}
                  data-testid="price-monthly"
                  aria-hidden={!priced}
                >
                  {monthly}
                </p>
                <p className="text-[10px] leading-[18px] text-[#777777] md:text-[12px]">
                  per month with <span className="underline">Financing</span>
                </p>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LocationModalBody({
  catalog,
  location,
  onSubmitted,
  onPickCity,
  onReset,
  onClose,
}: {
  catalog: PublicCatalog;
  location: LocationState;
  onSubmitted: (s: GhlSubmission) => void;
  onPickCity: (city: string, pending: GhlSubmission) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  if (location.status === "outside") {
    return (
      <div className="py-2" data-testid="outside-area">
        <h3 id="location-title" className="mb-3 text-xl font-semibold text-[#2E2A22]">
          You&apos;re outside our current service area
        </h3>
        <p className="mb-3 text-[15px] leading-[150%] text-[#6A624D]">
          {location.city ? `${location.city} isn't` : "Your property isn't"} in an area Acton ADU
          serves yet, so we can&apos;t show accurate pricing. You&apos;re welcome to keep exploring
          every model, style and upgrade.
        </p>
        <p className="mb-5 text-[15px] leading-[150%] text-[#6A624D]">
          Our team will reach out if we expand to your area.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-[#00263E] px-4 py-2 text-white hover:opacity-90"
          >
            Keep exploring
          </button>
          <button
            type="button"
            onClick={onReset}
            className="flex-1 rounded-full border border-[#E5E5E4] px-4 py-2 text-[#2E2A22] hover:bg-gray-50"
          >
            Use a different address
          </button>
        </div>
      </div>
    );
  }
  if (location.status === "needs_city") {
    return (
      <div className="py-2" data-testid="needs-city">
        <h3 id="location-title" className="mb-3 text-xl font-semibold text-[#2E2A22]">
          Which city is your property in?
        </h3>
        <div className="mb-3 flex flex-col gap-2">
          {location.choices.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => onPickCity(city, location.pending)}
              className="w-full rounded-[10px] border border-[#E5E5E4] px-4 py-3 text-left hover:bg-[#0088FF26]"
            >
              {city}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onPickCity(typed.trim(), location.pending);
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="City"
            className="flex-1 rounded border px-3 py-2"
            aria-label="City"
          />
          <button type="submit" className="rounded-full bg-[#00263E] px-4 py-2 text-white">
            Continue
          </button>
        </form>
      </div>
    );
  }
  return (
    <div>
      {location.status === "supported" ? (
        <p className="mb-2 text-sm text-[#6A6A6A]" data-testid="location-current">
          Showing prices for {location.city}. Submit a different address to update them.
        </p>
      ) : null}
      {location.status === "error" ? (
        <p className="mb-2 text-sm text-red-700">{location.message}</p>
      ) : null}
      <div className="relative">
        <GhlFormFrame
          formId={catalog.settings.locationFormId}
          title="Configurator Pricing - Address Pricing (GHL)"
          initialHeight={1275}
          mode="box"
          onSubmitted={onSubmitted}
          testId="location-form"
        />
        {location.status === "checking" ? (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/85 text-[#2E2A22]"
            data-testid="location-checking"
          >
            Checking your location…
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PreviewBar({
  regions,
  regionId,
  onRegion,
  version,
}: {
  regions: { id: string; name: string }[];
  regionId: string | null;
  onRegion: (id: string | null) => void;
  version: number | "draft";
}) {
  return (
    <div
      className="fixed top-3 left-1/2 z-[1500] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#0b1f3a] px-4 py-2 text-xs text-white shadow-lg md:left-[35%]"
      data-testid="preview-bar"
    >
      <span className="font-semibold">
        {version === "draft" ? "Draft preview" : `Live v${version}`}
      </span>
      <label className="flex items-center gap-1">
        <span className="text-white/70">Price as</span>
        <select
          value={regionId ?? ""}
          onChange={(e) => onRegion(e.target.value || null)}
          className="rounded bg-white/10 px-1 py-0.5 text-white"
          data-testid="preview-region"
        >
          <option value="" className="text-black">
            Customer (enter address)
          </option>
          {regions.map((r) => (
            <option key={r.id} value={r.id} className="text-black">
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <span className="text-white/60">Not visible to customers</span>
    </div>
  );
}
