import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { verifyLocationToken } from "@/lib/configurator/location";
import { modelPriceSheet, type ModelPriceSheet } from "@/lib/configurator/pricing";
import { regionForCity } from "@/lib/configurator/regions";
import { enforceRateLimit, isAdminPreview } from "@/lib/configurator/request-context";
import { quoteRequestSchema } from "@/lib/configurator/schemas";
import { findModelByLinkValue } from "@/lib/configurator/selection";
import { loadPricingCatalog } from "@/lib/configurator/server";
import type { Model, Price } from "@/lib/configurator/types";

export const dynamic = "force-dynamic";

/** Live pricing never serves a value an admin has not reviewed. */
function withoutUnreviewed(model: Model): Model {
  const scrub = <T extends { price: Price }>(items: T[]): T[] =>
    items.map((i) =>
      i.price.needsReview ? { ...i, price: { ...i.price, regions: {}, base: null } } : i,
    );
  return {
    ...model,
    basePrice: model.basePrice.needsReview
      ? { ...model.basePrice, regions: {}, base: null }
      : model.basePrice,
    options: scrub(model.options),
    exteriors: scrub(model.exteriors),
    interiors: scrub(model.interiors),
    appliances: scrub(model.appliances),
    upgrades: scrub(model.upgrades),
    bathrooms: scrub(model.bathrooms),
  };
}

/**
 * Prices for one model in the customer's verified region. Requires a location token from
 * /location (admins previewing the draft may pick a region directly).
 */
export async function POST(request: Request) {
  try {
    enforceRateLimit(request, "quote", 120);
    const body = quoteRequestSchema.parse(await request.json());
    const preview = await isAdminPreview(body.preview === true);
    const catalog = await loadPricingCatalog({ preview });
    const headers = { "Cache-Control": "no-store" };
    if (!catalog) return NextResponse.json({ status: "unavailable" }, { headers });

    const model = findModelByLinkValue(
      catalog.models.filter((m) => m.status === "active"),
      body.model,
    );
    if (!model) return NextResponse.json({ status: "unavailable" }, { headers });

    let region =
      preview && body.regionId
        ? (catalog.regions.find((r) => r.id === body.regionId) ?? null)
        : null;
    let city: string | null = null;
    if (!region) {
      const claims = verifyLocationToken(body.token);
      if (!claims)
        return NextResponse.json({ status: "location_required" }, { status: 401, headers });
      city = claims.city;
      region = regionForCity(catalog.regions, { name: claims.city, state: claims.state });
      if (!region) return NextResponse.json({ status: "outside", city }, { headers });
    }

    const sheet: ModelPriceSheet = modelPriceSheet(
      preview ? model : withoutUnreviewed(model),
      region.id,
    );
    if (sheet.base === null) return NextResponse.json({ status: "unavailable", city }, { headers });
    const f = catalog.settings.financing;
    return NextResponse.json(
      {
        status: "priced",
        modelId: model.id,
        regionId: region.id,
        regionName: region.name,
        city,
        sheet,
        financing: { enabled: f.enabled, annualRatePct: f.annualRatePct, termMonths: f.termMonths },
        preview,
      },
      { headers },
    );
  } catch (error) {
    return jsonError(error, "POST /api/public/configurator/quote");
  }
}
