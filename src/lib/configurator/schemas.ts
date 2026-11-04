/**
 * Runtime validation for admin writes. Every entity an admin saves is parsed here, so a
 * malformed client can never write a draft the public configurator cannot read.
 */

import { z } from "zod";

const id = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dashes");
const name = z.string().trim().min(1, "Name is required").max(160);
const text = z.string().max(4000);
const money = z.number().finite().min(-10_000_000).max(100_000_000);
const rev = z.number().int().min(0);

export const priceSchema = z.object({
  mode: z.enum(["explicit", "adjusted"]),
  base: money.nullable(),
  adjustKind: z.enum(["amount", "percent"]),
  regions: z.record(z.string().max(120), money.nullable()),
  needsReview: z.boolean(),
});

const cityRef = z.object({
  name: z.string().trim().min(1).max(80),
  state: z.string().trim().min(2).max(40),
});

export const regionSchema = z.object({
  id,
  name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  cities: z.array(cityRef).max(2000),
  sortOrder: z.number().int(),
  rev,
});

export const seriesSchema = z.object({
  id,
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  name,
  sortOrder: z.number().int(),
  rev,
});

export const styleSchema = z.object({
  id,
  kind: z.enum(["exterior", "interior"]),
  name,
  description: text,
  detailsAssetId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  rev,
});

const orderable = {
  enabled: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  price: priceSchema,
};
const lines = z.array(z.string().max(500)).max(30);

const assetId = z.string().uuid();
const slotKey = z
  .string()
  .regex(/^(ext\|[^|]+\|(standard|porch)\|[89]|int\|[^|]+\|[a-z_]+\|[89]|bath\|[^|]+\|[^|]+)$/);

export const modelSchema = z.object({
  id,
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and dashes"),
  name,
  seriesId: id,
  status: z.enum(["active", "inactive"]),
  sortOrder: z.number().int(),
  beds: z.number().min(0).max(20).nullable(),
  baths: z.number().min(0).max(20).nullable(),
  sqft: z.number().int().min(0).max(100_000).nullable(),
  description: text,
  canibuildDesignName: z.string().max(160),
  preApproved: z.boolean(),
  preApprovedTitle: z.string().max(300),
  preApprovedCities: z.array(z.string().max(80)).max(200),
  basePrice: priceSchema,
  floorplans: z.object({ standard: assetId.nullable(), mirror: assetId.nullable() }),
  options: z
    .array(z.object({ id, name, exteriorVariant: z.enum(["standard", "porch"]), ...orderable }))
    .max(20),
  exteriors: z.array(z.object({ styleId: id, ...orderable })).max(100),
  interiors: z.array(z.object({ styleId: id, ...orderable })).max(100),
  appliances: z
    .array(
      z.object({
        id,
        name,
        lines,
        renderRole: z.enum(["appliance_base", "appliance_mid"]),
        ...orderable,
      }),
    )
    .max(20),
  upgrades: z
    .array(
      z.object({
        id,
        name,
        lines,
        effect: z.enum(["none", "ceiling_9ft", "lighting", "other"]),
        ...orderable,
      }),
    )
    .max(20),
  bathrooms: z.array(z.object({ id, name, lines, ...orderable })).max(20),
  renders: z.record(slotKey, assetId),
  ceilingFallback: z.boolean(),
  legacyAliases: z
    .array(
      z.object({
        value: z.string().max(200),
        kind: z.enum([
          "model",
          "option",
          "exterior",
          "interior",
          "appliance",
          "upgrade",
          "bathroom",
        ]),
        ref: z.string().max(120),
      }),
    )
    .max(1000),
  rev,
});

export const settingsSchema = z.object({
  financing: z.object({
    enabled: z.boolean(),
    annualRatePct: z.number().min(0).max(30),
    termMonths: z.number().int().min(1).max(600),
    disclaimer: z.string().max(500),
    linkUrl: z
      .string()
      .max(500)
      .refine((v) => v === "" || /^https:\/\//.test(v), "Use an https:// link"),
  }),
  upgradeSelection: z.enum(["single", "multiple"]),
  quoteFormId: z.string().regex(/^[A-Za-z0-9]{10,40}$/),
  locationFormId: z.string().regex(/^[A-Za-z0-9]{10,40}$/),
  canibuildEnabled: z.boolean(),
  homeUrl: z.string().url().max(300),
  rev,
});

const expectedRev = z.number().int().min(0).nullable();

export const changeSchema = z.union([
  z.object({
    op: z.literal("put"),
    collection: z.literal("series"),
    value: seriesSchema,
    expectedRev,
  }),
  z.object({
    op: z.literal("put"),
    collection: z.literal("styles"),
    value: styleSchema,
    expectedRev,
  }),
  z.object({
    op: z.literal("put"),
    collection: z.literal("regions"),
    value: regionSchema,
    expectedRev,
  }),
  z.object({
    op: z.literal("put"),
    collection: z.literal("models"),
    value: modelSchema,
    expectedRev,
  }),
  z.object({
    op: z.literal("delete"),
    collection: z.enum(["series", "styles", "regions", "models"]),
    id,
    expectedRev,
  }),
  z.object({ op: z.literal("settings"), value: settingsSchema, expectedRev }),
]);

export const saveDraftSchema = z.object({
  changes: z.array(changeSchema).min(1).max(500),
});

export const publishSchema = z.object({
  notes: z.string().max(1000).default(""),
});

export const rollbackSchema = z.object({ version: z.number().int().min(1) });

export const assetClassificationSchema = z.object({
  kind: z.enum(["exterior", "interior", "bathroom", "floorplan", "details", "other"]),
  modelId: z.string().max(120).nullable(),
  styleId: z.string().max(120).nullable(),
  role: z
    .enum([
      "kitchen",
      "lighting_daytime",
      "appliance_base",
      "appliance_mid",
      "lighting_dusk_uplights",
      "lighting_dusk",
      "ambiance",
    ])
    .nullable(),
  ceiling: z.enum(["8", "9"]).nullable(),
  variant: z.enum(["standard", "porch"]).nullable(),
  mirror: z.boolean().nullable(),
  bathroomName: z.string().max(120).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.array(z.string().max(500)).max(20),
});

export const locationRequestSchema = z.object({
  address: z.string().trim().max(300).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  postalCode: z.string().trim().max(12).optional().default(""),
});

export const quoteRequestSchema = z.object({
  model: z.string().trim().min(1).max(120),
  token: z.string().max(2000).optional(),
  /** Admin preview only: price the draft for a chosen region. */
  preview: z.boolean().optional(),
  regionId: z.string().max(120).optional(),
});
