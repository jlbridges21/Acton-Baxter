/**
 * Acton ADU Configurator import.
 *
 * Builds the initial DRAFT catalog from:
 *   1. ActonADU_Configurator/Models/          local renderings & floorplans (source of images)
 *   2. ActonADU_Configurator/legacy_snapshot/ design.actonadu.com catalog + quote API
 *      responses (models, options, labels, order, defaults, prices) and the legacy
 *      pricing-region ZIP sweep
 *   3. Legacy media the local folder does not have (bathroom renderings, interior style
 *      detail boards), downloaded once into legacy_snapshot/media/ with provenance.
 *
 * It never invents a rendering: a slot is filled only when a file's folder and name say
 * exactly what it shows. Everything else is listed in the import report for review.
 * All imported prices are marked "needs review".
 *
 * Usage (from the repo root):
 *   node_modules/.bin/jiti scripts/configurator-import.ts --target=local
 *   node_modules/.bin/jiti scripts/configurator-import.ts --target=supabase [--replace-draft]
 *
 *   --target=local     writes .configurator-local/{assets,seed.json} for local/E2E mode
 *   --target=supabase  uploads to the configurator-assets bucket and writes the draft +
 *                      import report (needs migration 086 and .env.local Supabase keys).
 *                      An existing draft is kept unless --replace-draft is passed.
 *   --dry-run          classify and report only; no image processing or writes
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, slugify } from "../src/lib/configurator/defaults";
import { assetStoragePaths, processImage } from "../src/lib/configurator/image-processing";
import { flatPrice } from "../src/lib/configurator/pricing";
import { slotKey, type Slot, requiredSlots } from "../src/lib/configurator/render";
import type {
  AppliancePackage,
  Asset,
  AssetClassification,
  BathroomOption,
  Catalog,
  CeilingHeight,
  ExteriorVariant,
  InteriorRole,
  LegacyAlias,
  Model,
  ModelOption,
  Price,
  SharedStyle,
  StyleUse,
  Upgrade,
  UpgradeEffect,
} from "../src/lib/configurator/types";
import { CATALOG_SCHEMA_VERSION } from "../src/lib/configurator/types";

const ROOT = process.cwd();
const ASSET_ROOT = path.join(ROOT, "ActonADU_Configurator", "Models");
const SNAPSHOT = path.join(ROOT, "ActonADU_Configurator", "legacy_snapshot");
const LEGACY_MEDIA = path.join(SNAPSHOT, "media");
const LOCAL_DIR = process.env.CONFIGURATOR_LOCAL_DIR || path.join(ROOT, ".configurator-local");
const REGION_ID = "bay-area";

const args = new Set(process.argv.slice(2));
const target = [...args].find((a) => a.startsWith("--target="))?.split("=")[1] ?? "local";
const dryRun = args.has("--dry-run");
const replaceDraft = args.has("--replace-draft");

// ---------------------------------------------------------------------------
// Canonical names
// ---------------------------------------------------------------------------

const EXTERIOR_STYLES = [
  "Mendocino Coastal",
  "Shelter Cove Coastal",
  "Berkeley Modern",
  "Campbell Contemporary",
  "Half Moon Bay Coastal",
  "Hayward Modern",
  "Saratoga Countryside",
  "American Canyon Countryside",
  "Cupertino Contemporary",
  "Santa Barbara Spanish",
];

const INTERIOR_STYLES = [
  "California Coastal",
  "Classic Elegance",
  "Urban Minimalism",
  "Refined Simplicity",
  "Hacienda Retreat",
  "Palm & Line",
  "Villa Noir",
  "Maison Blanc",
];

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");

/** Known spelling variants in file names and legacy labels. */
const STYLE_ALIASES: Record<string, string> = {
  santabarabaraspanish: "Santa Barbara Spanish",
  berkleymodern: "Berkeley Modern",
  saratogacountryside: "Saratoga Countryside",
  americancanyoncountryside: "American Canyon Countryside",
  palmline: "Palm & Line",
  // Typos found in the supplied file names (each is the only close match).
  urbanminimalsm: "Urban Minimalism",
  classicelegancel: "Classic Elegance",
  vilanoir: "Villa Noir",
};

/** Report entries for names that needed an alias, once per (model, raw name). */
const aliasNotes = new Set<string>();

function canonicalStyle(
  raw: string,
  kind: "exterior" | "interior",
  context?: string,
): string | null {
  const key = squash(raw);
  if (STYLE_ALIASES[key]) {
    const name = STYLE_ALIASES[key]!;
    const typo = ![
      "santabarabaraspanish",
      "berkleymodern",
      "saratogacountryside",
      "americancanyoncountryside",
      "palmline",
    ].includes(key);
    if (context && typo && !aliasNotes.has(`${context}|${raw}`)) {
      aliasNotes.add(`${context}|${raw}`);
      report.uncertainMappings.push({
        model: context,
        message: `File names spell “${raw}”; matched to “${name}”. Confirm the renderings.`,
      });
    }
    return name;
  }
  const list = kind === "exterior" ? EXTERIOR_STYLES : INTERIOR_STYLES;
  return list.find((n) => squash(n) === key) ?? null;
}

const styleId = (name: string) => slugify(name);

// ---------------------------------------------------------------------------
// Legacy snapshot types
// ---------------------------------------------------------------------------

type LegacyItem = {
  id: number;
  label: string;
  value: string;
  image: string;
  uiTitle?: string;
  uiLines?: string[];
};
type LegacyInterior = LegacyItem & {
  detailsImage?: string | null;
  appliances: LegacyItem[];
  upgrades: LegacyItem[];
  bathrooms: LegacyItem[];
};
type LegacyModel = {
  id: number;
  label: string;
  value: string;
  image: string;
  floorplanImage: string;
  floorplanMirrorImage: string;
  series: string;
  seriesShowModelOptions: boolean;
  canibuildDesignName: string;
  preApproved: boolean;
  preApprovedTitle: string;
  preApprovedCities: string[];
};
type LegacyCatalog = {
  models: LegacyModel[];
  modelOptions: (LegacyItem & { exteriors: LegacyItem[]; interiors: LegacyItem[] })[];
  exteriorOptions: LegacyItem[];
  interiorOptions: LegacyInterior[];
};
type QuoteItem = { value: string; label: string; price: number | null; available: boolean };
type LegacyQuote = {
  basePrice: number | null;
  upgrades: QuoteItem[];
  appliances: QuoteItem[];
  modelOptions: QuoteItem[];
  exteriors: QuoteItem[];
  bathrooms: QuoteItem[];
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type ReportEntry = { model?: string; message: string; file?: string };
const report = {
  generatedAt: new Date().toISOString(),
  target,
  sources: {
    assets: path.relative(ROOT, ASSET_ROOT),
    legacySnapshot: path.relative(ROOT, SNAPSHOT),
  },
  models: [] as {
    id: string;
    name: string;
    series: string;
    folder: string;
    folderNote: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    images: { required: number; mapped: number; missing: number };
    options: number;
    exteriors: number;
    interiors: number;
    appliances: number;
    upgrades: number;
    bathrooms: number;
  }[],
  styles: { exterior: [] as string[], interior: [] as string[] },
  images: {
    localFiles: 0,
    legacyFiles: 0,
    mappedSlots: 0,
    floorplans: 0,
    unusedButImported: 0,
    duplicates: [] as ReportEntry[],
  },
  missingRenders: [] as ReportEntry[],
  uncertainMappings: [] as ReportEntry[],
  pricing: {
    region: "Bay Area",
    itemsImported: 0,
    itemsWithoutLegacyPrice: [] as ReportEntry[],
    inconsistencies: [] as ReportEntry[],
    note: "Every price was copied from the live design.actonadu.com quote API for a Bay Area ZIP and is marked “needs review”. Nothing publishes until an admin reviews it.",
  },
  regions: {
    cities: 0,
    note: "",
    flags: [] as string[],
  },
  legacyDataIssues: [] as ReportEntry[],
  integrations: [
    "GoHighLevel: the same form IDs are embedded (quote p1swLQWD4mVI7APiGzFp, location pV3Gf1zaZHLuCTipKGKZ, save 1xhDrNtf1yDpbl6eS9gC). Writing cfg_* custom fields to the submitting contact is off until CONFIGURATOR_GHL_SYNC=true; verify with a test contact first.",
    "Can I Build: the existing search widget (token from the live site) is embedded in the Property Check popup, with data-design-name set to the selected model. Whether Can I Build filters results by that name must be confirmed with Can I Build.",
    "Financing: the live site's monthly payment matches a 6% / 30-year amortization of the total; confirm the rate and term with Acton's lender before publishing.",
  ],
};

// ---------------------------------------------------------------------------
// Local file classification
// ---------------------------------------------------------------------------

type LocalFile = { abs: string; rel: string; folder: string; name: string };

function walk(dir: string, out: LocalFile[] = []): LocalFile[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(jpe?g|png|webp)$/i.test(entry))
      out.push({
        abs,
        rel: path.relative(ASSET_ROOT, abs),
        folder: path.dirname(path.relative(ASSET_ROOT, abs)),
        name: entry,
      });
  }
  return out;
}

const ROLE_PATTERNS: [RegExp, InteriorRole][] = [
  [/lighting\s*-?\s*dusk\s*-?\s*uplights?/i, "lighting_dusk_uplights"],
  [/lighting\s*-?\s*dusk/i, "lighting_dusk"],
  [/lighting\s*-?\s*day(light)?/i, "lighting_daytime"],
  [/appliance\s*(mid|prem)/i, "appliance_mid"],
  [/appliance\s*base/i, "appliance_base"],
  [/kitchen/i, "kitchen"],
  [/ambien[cs]e/i, "ambiance"],
];

type Classified =
  | { kind: "exterior"; style: string; variant: ExteriorVariant; ceiling: CeilingHeight }
  | { kind: "interior"; style: string; role: InteriorRole; ceiling: CeilingHeight }
  | { kind: "floorplan"; mirror: boolean; size: "3k" | "800" }
  | { kind: "unknown"; reason: string };

/** Text after the "(BD-x) (BA-y)" block, minus "(L)"/"(P)" tags and the 9-ft suffix. */
function tailAfterBeds(name: string): string {
  const base = name.replace(/\.[a-z]+$/i, "");
  const idx = base.search(/\(BA-[\d.]+\)/i);
  const tail = idx >= 0 ? base.slice(base.indexOf(")", idx) + 1) : base;
  return tail
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*-?\s*9-1\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ceilingFromFolder(folder: string): CeilingHeight | null {
  if (/(^|\/)9\s*ft$/i.test(folder)) return "9";
  if (/(^|\/)8\s*ft$/i.test(folder)) return "8";
  return null;
}

function classify(file: LocalFile, isSignature: boolean, modelName: string): Classified {
  const parts = file.folder.split("/");
  const section = parts[2] ?? "";
  if (section === "Floor Plan") {
    const size = /_800\./i.test(file.name) ? "800" : "3k";
    return { kind: "floorplan", mirror: /\(REV\)/i.test(file.name), size };
  }
  const tail = tailAfterBeds(file.name);
  if (section === "Exterior") {
    const sub = parts.slice(3).join("/");
    const style = canonicalStyle(tail, "exterior", modelName);
    if (!style) return { kind: "unknown", reason: `Exterior style “${tail}” not recognized` };
    if (isSignature) {
      if (/^porch$/i.test(sub)) return { kind: "exterior", style, variant: "porch", ceiling: "8" };
      if (/^nonporch$/i.test(sub))
        return { kind: "exterior", style, variant: "standard", ceiling: "8" };
      return { kind: "unknown", reason: `Unexpected exterior folder “${sub}”` };
    }
    const ceiling = ceilingFromFolder(sub);
    if (!ceiling)
      return { kind: "unknown", reason: `Exterior folder “${sub}” has no ceiling height` };
    return { kind: "exterior", style, variant: "standard", ceiling };
  }
  if (section === "Interior") {
    const sub = parts.slice(3).join("/");
    if (/CABINET/i.test(sub)) return { kind: "unknown", reason: "CABINET subfolder" };
    const ceiling = isSignature ? "8" : ceilingFromFolder(sub);
    if (!ceiling)
      return { kind: "unknown", reason: `Interior folder “${sub}” has no ceiling height` };
    const dash = tail.indexOf(" - ");
    const styleRaw = dash >= 0 ? tail.slice(0, dash) : tail;
    const roleRaw = dash >= 0 ? tail.slice(dash + 3) : "";
    const style = canonicalStyle(styleRaw, "interior", modelName);
    if (!style) return { kind: "unknown", reason: `Interior style “${styleRaw}” not recognized` };
    const role = ROLE_PATTERNS.find(([re]) => re.test(roleRaw))?.[1];
    if (!role) return { kind: "unknown", reason: `Rendering type “${roleRaw}” not recognized` };
    return { kind: "interior", style, role, ceiling };
  }
  return { kind: "unknown", reason: `Unexpected folder “${section}”` };
}

// ---------------------------------------------------------------------------
// Model folder mapping (verified against legacy model codes)
// ---------------------------------------------------------------------------

type ModelPlan = {
  legacyValue: string;
  folder: string;
  series: "investor" | "signature";
  note: string | null;
};

function planModels(legacyModels: LegacyModel[]): ModelPlan[] {
  const folders = ["Investor_Series", "Signature_Series"].flatMap((s) =>
    readdirSync(path.join(ASSET_ROOT, s))
      .filter((f) => !f.startsWith("."))
      .map((f) => `${s}/${f}`),
  );
  const plans: ModelPlan[] = [];
  for (const m of legacyModels) {
    const code = m.label.match(/([is])(\d{3,4})\s*([AB])\d/i);
    if (!code) {
      report.uncertainMappings.push({
        model: m.label,
        message: "Could not read the plan code from the model name; not imported.",
      });
      continue;
    }
    const [, letter, digits, plan] = code;
    const prefix = letter!.toLowerCase() === "i" ? "Investor_Series/i-" : "Signature_Series/S-";
    const matches = folders.filter((f) =>
      f.toLowerCase().startsWith(`${prefix}${digits}-`.toLowerCase()),
    );
    const exact = matches.filter((f) => new RegExp(`-${digits}-${plan}-?1$`, "i").test(f));
    const folder = exact[0] ?? (matches.length === 1 ? matches[0] : undefined);
    if (!folder) {
      report.uncertainMappings.push({
        model: m.label,
        message: `No asset folder found for plan ${letter}${digits} ${plan}.`,
      });
      continue;
    }
    let note: string | null = null;
    if (!exact.length)
      note = `Folder “${folder.split("/")[1]}” is the only ${digits} plan folder; its name does not match “${plan}1” exactly. Mapped by plan size — confirm.`;
    plans.push({
      legacyValue: m.value,
      folder,
      series: m.series === "signature" ? "signature" : "investor",
      note,
    });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Image store (local folder or Supabase)
// ---------------------------------------------------------------------------

type Env = Record<string, string>;
function readEnvLocal(): Env {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const env: Env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  return env;
}

const env = { ...readEnvLocal(), ...process.env } as Env;
const supabase =
  target === "supabase" && !dryRun
    ? createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      })
    : null;

const assets: Asset[] = [];
const assetBySha = new Map<string, Asset>();
let existingBySha = new Map<string, Asset>();

async function loadExistingAssets(): Promise<void> {
  if (!supabase) return;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("configurator_assets")
      .select("*")
      .range(from, from + 999);
    if (error)
      throw new Error(
        `Cannot read configurator_assets (is migration 086 applied?): ${error.message}`,
      );
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  existingBySha = new Map(
    rows.map((r) => [
      r.sha256 as string,
      {
        id: r.id as string,
        displayPath: r.display_path as string,
        thumbPath: r.thumb_path as string,
        width: r.width as number | null,
        height: r.height as number | null,
        bytes: r.bytes as number | null,
        sha256: r.sha256 as string,
        originalName: r.original_name as string,
        source: r.source as Asset["source"],
        provenance: r.provenance as string,
        classification: r.classification as AssetClassification | null,
        createdAt: r.created_at as string,
      },
    ]),
  );
}

async function putObject(objectPath: string, body: Buffer): Promise<void> {
  if (supabase) {
    const { error } = await supabase.storage
      .from("configurator-assets")
      .upload(objectPath, body, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
    if (error) throw new Error(`Upload failed for ${objectPath}: ${error.message}`);
    return;
  }
  const file = path.join(LOCAL_DIR, "assets", objectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

class UnreadableImageError extends Error {}

async function registerImage(
  buffer: Buffer,
  originalName: string,
  source: Asset["source"],
  provenance: string,
  classification: AssetClassification,
): Promise<Asset> {
  const hash = createHash("sha256").update(buffer).digest("hex");
  const seen = assetBySha.get(hash);
  if (seen) return seen;
  const previous = existingBySha.get(hash);
  const paths = assetStoragePaths(hash);
  let width: number | null = previous?.width ?? null;
  let height: number | null = previous?.height ?? null;
  const localExists = !supabase && existsSync(path.join(LOCAL_DIR, "assets", paths.displayPath));
  if (!dryRun && !previous && !localExists) {
    const processed = await processImage(buffer).catch((error: unknown) => {
      throw new UnreadableImageError(
        `${originalName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    width = processed.width;
    height = processed.height;
    await putObject(paths.displayPath, processed.display);
    await putObject(paths.thumbPath, processed.thumb);
  }
  const asset: Asset = previous
    ? { ...previous, classification: previous.classification ?? classification }
    : {
        id: randomUUID(),
        ...paths,
        width,
        height,
        bytes: buffer.byteLength,
        sha256: hash,
        originalName,
        source,
        provenance,
        classification,
        createdAt: new Date().toISOString(),
      };
  if (!dryRun && supabase && !previous) {
    const { error } = await supabase.from("configurator_assets").insert({
      id: asset.id,
      display_path: asset.displayPath,
      thumb_path: asset.thumbPath,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      sha256: asset.sha256,
      original_name: asset.originalName,
      source: asset.source,
      provenance: asset.provenance,
      classification: asset.classification,
      created_at: asset.createdAt,
    });
    if (error) throw new Error(`Asset row insert failed: ${error.message}`);
  }
  assetBySha.set(hash, asset);
  assets.push(asset);
  return asset;
}

/** registerImage, but an unreadable file is reported and skipped instead of aborting the import. */
async function tryRegister(...args: Parameters<typeof registerImage>): Promise<Asset | null> {
  try {
    return await registerImage(...args);
  } catch (error) {
    if (!(error instanceof UnreadableImageError)) throw error;
    report.uncertainMappings.push({
      file: args[3],
      message: `Not a readable image (${error.message}); skipped.`,
    });
    return null;
  }
}

async function fetchLegacyMedia(url: string): Promise<Buffer | null> {
  const name = decodeURIComponent(url.split("/media/")[1] ?? "").replace(/[^A-Za-z0-9._/-]/g, "_");
  if (!name) return null;
  const file = path.join(LEGACY_MEDIA, name);
  if (existsSync(file)) {
    const cached = readFileSync(file);
    if (isImageBuffer(cached)) return cached;
  }
  const https = url.replace(/^http:/, "https:");
  const res = await fetch(https);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // The live site answers unknown paths with its HTML page; only keep real images.
  if (!isImageBuffer(buf)) return null;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return buf;
}

function isImageBuffer(buf: Buffer): boolean {
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf.subarray(0, 4).toString("hex") === "89504e47";
  const webp =
    buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  return jpeg || png || webp;
}

/** Prefer the full-size legacy file over its "-min" variant when it exists. */
async function fetchLegacyBest(url: string): Promise<{ url: string; buf: Buffer } | null> {
  const full = url.replace(/-min(\.[a-z]+)$/i, "$1");
  for (const candidate of full === url ? [url] : [full, url]) {
    const buf = await fetchLegacyMedia(candidate);
    if (buf) return { url: candidate, buf };
  }
  return null;
}

function classification(partial: Partial<AssetClassification>): AssetClassification {
  return {
    kind: "other",
    modelId: null,
    styleId: null,
    role: null,
    ceiling: null,
    variant: null,
    mirror: null,
    bathroomName: null,
    confidence: "high",
    notes: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

function legacyPrice(
  value: number | null | undefined,
  context: { model: string; label: string },
): Price {
  report.pricing.itemsImported++;
  if (value === null || value === undefined) {
    report.pricing.itemsWithoutLegacyPrice.push({
      model: context.model,
      message: `${context.label}: no price on the live site — set as a $0 placeholder, needs review.`,
    });
    return flatPrice(0, [REGION_ID], true);
  }
  return flatPrice(value, [REGION_ID], true);
}

function mostCommon(values: (number | null)[]): { value: number | null; consistent: boolean } {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]));
  const value = top ? (top[0] === "null" ? null : Number(top[0])) : null;
  return { value, consistent: counts.size <= 1 };
}

function effectFor(title: string): UpgradeEffect {
  if (/no upgrade|default/i.test(title)) return "none";
  if (/9.?(foot|ft)/i.test(title)) return "ceiling_9ft";
  if (/light/i.test(title)) return "lighting";
  return "other";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(ASSET_ROOT)) throw new Error(`Asset folder not found: ${ASSET_ROOT}`);
  if (!existsSync(path.join(SNAPSHOT, "models")))
    throw new Error(`Legacy snapshot not found: ${SNAPSHOT}/models`);
  await loadExistingAssets();

  const legacyModels: { cat: LegacyCatalog; quote: LegacyQuote; model: LegacyModel }[] = [];
  for (const file of readdirSync(path.join(SNAPSHOT, "models")).filter((f) =>
    f.endsWith(".cat.json"),
  )) {
    const value = file.replace(/\.cat\.json$/, "");
    const cat = JSON.parse(
      readFileSync(path.join(SNAPSHOT, "models", file), "utf8"),
    ) as LegacyCatalog;
    const quote = JSON.parse(
      readFileSync(path.join(SNAPSHOT, "models", `${value}.quote.json`), "utf8"),
    ) as LegacyQuote;
    const model = cat.models.find((m) => m.value === value);
    if (model) legacyModels.push({ cat, quote, model });
  }
  legacyModels.sort((a, b) => {
    const order = (m: LegacyModel) =>
      (m.series === "investor" ? 0 : 1000) + Number(m.label.match(/\d{3,4}/)?.[0] ?? 0);
    return order(a.model) - order(b.model);
  });

  const styles: SharedStyle[] = [
    ...EXTERIOR_STYLES.map((name, i) => ({
      id: styleId(name),
      kind: "exterior" as const,
      name,
      description: "",
      detailsAssetId: null,
      sortOrder: i,
      archived: false,
      rev: 1,
    })),
    ...INTERIOR_STYLES.map((name, i) => ({
      id: styleId(name),
      kind: "interior" as const,
      name,
      description: "",
      detailsAssetId: null,
      sortOrder: i,
      archived: false,
      rev: 1,
    })),
  ];
  report.styles.exterior = EXTERIOR_STYLES;
  report.styles.interior = INTERIOR_STYLES;

  const plans = planModels(legacyModels.map((l) => l.model));
  const localFiles = walk(ASSET_ROOT);
  report.images.localFiles = localFiles.length;
  const detailsCandidates = new Map<string, Map<string, { url: string; count: number }>>();
  const models: Model[] = [];

  for (const [index, { cat, quote, model: lm }] of legacyModels.entries()) {
    const plan = plans.find((p) => p.legacyValue === lm.value);
    if (!plan) continue;
    const isSignature = plan.series === "signature";
    const modelId = slugify(lm.label);
    const label = lm.label;
    const files = localFiles.filter(
      (f) => f.folder.startsWith(plan.folder + "/") || f.folder === plan.folder,
    );
    const bdba = files.map((f) => f.name.match(/\(BD-(\d+)\)\s*\(BA-([\d.]+)\)/)).find(Boolean);
    const sqft = Number(lm.label.match(/[is](\d{3,4})/i)?.[1] ?? NaN);
    const aliases: LegacyAlias[] = [{ value: lm.value, kind: "model", ref: modelId }];
    if (lm.canibuildDesignName && lm.canibuildDesignName !== lm.value)
      aliases.push({ value: lm.canibuildDesignName, kind: "model", ref: modelId });

    // --- Model options -----------------------------------------------------
    const options: ModelOption[] = cat.modelOptions.map((o, i) => {
      const id = /porch/i.test(o.label) ? "with-porch" : slugify(o.label) || `option-${i + 1}`;
      aliases.push({ value: o.value, kind: "option", ref: id });
      return {
        id,
        name: o.label,
        exteriorVariant: /porch/i.test(o.label) ? "porch" : "standard",
        enabled: true,
        isDefault: i === 0,
        sortOrder: i,
        price: legacyPrice(quote.modelOptions.find((q) => q.value === o.value)?.price, {
          model: label,
          label: `Model option “${o.label}”`,
        }),
      };
    });
    if (lm.seriesShowModelOptions && options.length === 0)
      report.legacyDataIssues.push({
        model: label,
        message:
          "Live site shows an empty Model Options step for this model; the new configurator skips it.",
      });

    // --- Exteriors ---------------------------------------------------------
    const legacyExteriors = cat.modelOptions.length
      ? cat.modelOptions.flatMap((o) => o.exteriors)
      : cat.exteriorOptions;
    const exteriorOrder: string[] = [];
    for (const e of cat.modelOptions.length
      ? (cat.modelOptions[0]?.exteriors ?? [])
      : cat.exteriorOptions) {
      const name = canonicalStyle(e.label, "exterior");
      if (name && !exteriorOrder.includes(name)) exteriorOrder.push(name);
    }
    for (const e of legacyExteriors) {
      const name = canonicalStyle(e.label, "exterior");
      if (!name) {
        report.uncertainMappings.push({
          model: label,
          message: `Legacy exterior “${e.label}” does not match a shared style; skipped.`,
        });
        continue;
      }
      if (!exteriorOrder.includes(name)) exteriorOrder.push(name);
      aliases.push({ value: e.value, kind: "exterior", ref: styleId(name) });
    }
    // Cypress "Standard" Santa Barbara Spanish points at an Investor i-748 image on the live site.
    for (const o of cat.modelOptions)
      for (const e of o.exteriors)
        if (isSignature && /Investor_Series/i.test(e.image))
          report.legacyDataIssues.push({
            model: label,
            message: `Live site shows an Investor Series image for “${o.label} / ${e.label}”. The new configurator uses this model's own rendering.`,
          });

    const exteriors: StyleUse[] = exteriorOrder.map((name, i) => {
      const prices = quote.exteriors
        .filter((q) => canonicalStyle(q.label, "exterior") === name)
        .map((q) => q.price);
      const common = mostCommon(prices);
      if (!common.consistent)
        report.pricing.inconsistencies.push({
          model: label,
          message: `Exterior “${name}” has different prices for Standard and Porch on the live site (${prices.join(", ")}); imported ${common.value}.`,
        });
      return {
        styleId: styleId(name),
        enabled: true,
        isDefault: i === 0,
        sortOrder: i,
        price: legacyPrice(prices.length ? common.value : null, {
          model: label,
          label: `Exterior “${name}”`,
        }),
      };
    });

    // --- Interiors, appliances, upgrades, bathrooms --------------------------
    const interiors: StyleUse[] = [];
    const appliancePrices: (number | null)[][] = [[], []];
    const applianceTemplate: LegacyItem[] = [];
    const upgradeTemplate = new Map<UpgradeEffect, LegacyItem>();
    const upgradePrices = new Map<UpgradeEffect, (number | null)[]>();
    const bathroomTypes = new Map<string, { prices: (number | null)[]; order: number }>();
    const bathroomImages: { interior: string; type: string; url: string }[] = [];

    for (const [i, interior] of cat.interiorOptions.entries()) {
      const name = canonicalStyle(interior.label, "interior");
      if (!name) {
        report.uncertainMappings.push({
          model: label,
          message: `Legacy interior “${interior.label}” does not match a shared style; skipped.`,
        });
        continue;
      }
      const sid = styleId(name);
      aliases.push({ value: interior.value, kind: "interior", ref: sid });
      interiors.push({
        styleId: sid,
        enabled: true,
        isDefault: i === 0,
        sortOrder: i,
        price: legacyPrice(0, { model: label, label: `Interior “${name}”` }),
      });
      if (interior.detailsImage) {
        const bucket = detailsCandidates.get(sid) ?? new Map();
        const key = interior.detailsImage;
        bucket.set(key, { url: key, count: (bucket.get(key)?.count ?? 0) + 1 });
        detailsCandidates.set(sid, bucket);
      }
      interior.appliances.forEach((a, tier) => {
        if (tier > 1) {
          report.uncertainMappings.push({
            model: label,
            message: `More than two appliance packages for ${name}; extra package “${a.uiTitle ?? a.label}” skipped.`,
          });
          return;
        }
        if (!applianceTemplate[tier]) applianceTemplate[tier] = a;
        appliancePrices[tier]!.push(
          quote.appliances.find((q) => q.value === a.value)?.price ?? null,
        );
        aliases.push({
          value: a.value,
          kind: "appliance",
          ref: slugify(applianceTemplate[tier]!.uiTitle || a.label),
        });
      });
      for (const u of interior.upgrades) {
        const effect = effectFor(u.uiTitle || u.label);
        if (!upgradeTemplate.has(effect)) upgradeTemplate.set(effect, u);
        upgradePrices.set(effect, [
          ...(upgradePrices.get(effect) ?? []),
          quote.upgrades.find((q) => q.value === u.value)?.price ?? null,
        ]);
        aliases.push({
          value: u.value,
          kind: "upgrade",
          ref: slugify(upgradeTemplate.get(effect)!.uiTitle || u.label),
        });
      }
      for (const [order, b] of interior.bathrooms.entries()) {
        const type = b.label.replace(interior.label, "").trim() || b.label;
        const entry = bathroomTypes.get(type) ?? { prices: [], order };
        entry.prices.push(quote.bathrooms.find((q) => q.value === b.value)?.price ?? null);
        bathroomTypes.set(type, entry);
        aliases.push({ value: b.value, kind: "bathroom", ref: slugify(type) });
        if (b.image) bathroomImages.push({ interior: sid, type, url: b.image });
      }
    }

    const appliances: AppliancePackage[] = applianceTemplate.map((a, tier) => {
      const common = mostCommon(appliancePrices[tier]!);
      const title = a.uiTitle || a.label;
      if (!common.consistent)
        report.pricing.inconsistencies.push({
          model: label,
          message: `Appliance package “${title}” has different prices by interior on the live site (${appliancePrices[tier]!.join(", ")}); imported ${common.value}.`,
        });
      return {
        id: slugify(title),
        name: title,
        lines: a.uiLines ?? [],
        renderRole: tier === 0 ? "appliance_base" : "appliance_mid",
        enabled: true,
        isDefault: tier === 0,
        sortOrder: tier,
        price: legacyPrice(common.value, { model: label, label: `Appliance package “${title}”` }),
      };
    });

    const effectOrder: UpgradeEffect[] = ["none", "ceiling_9ft", "lighting", "other"];
    const upgrades: Upgrade[] = effectOrder
      .filter((e) => upgradeTemplate.has(e))
      .map((effect, i) => {
        const u = upgradeTemplate.get(effect)!;
        const common = mostCommon(upgradePrices.get(effect)!);
        const title = u.uiTitle || u.label;
        if (!common.consistent)
          report.pricing.inconsistencies.push({
            model: label,
            message: `Upgrade “${title}” has different prices by interior on the live site (${upgradePrices.get(effect)!.join(", ")}); imported ${common.value}.`,
          });
        return {
          id: slugify(title),
          name: title,
          lines: u.uiLines ?? [],
          effect,
          enabled: true,
          isDefault: effect === "none",
          sortOrder: i,
          price: legacyPrice(common.value, { model: label, label: `Upgrade “${title}”` }),
        };
      });
    const otherUpgrades = upgrades.filter((u) => u.effect === "other");
    if (otherUpgrades.length)
      report.uncertainMappings.push({
        model: label,
        message: `Upgrade(s) ${otherUpgrades.map((u) => `“${u.name}”`).join(", ")} have no known rendering effect.`,
      });

    const bathrooms: BathroomOption[] = [...bathroomTypes.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([type, entry], i) => {
        const priced = entry.prices.filter((p) => p !== null);
        const common = mostCommon(priced.length ? priced : [null]);
        if (priced.length < entry.prices.length)
          report.pricing.inconsistencies.push({
            model: label,
            message: `Bathroom “${type}” is listed on the live site but not priced for every interior.`,
          });
        return {
          id: slugify(type),
          name: type,
          lines: [],
          enabled: true,
          isDefault: i === 0,
          sortOrder: i,
          price: legacyPrice(priced.length ? common.value : null, {
            model: label,
            label: `Bathroom “${type}”`,
          }),
        };
      });

    const model: Model = {
      id: modelId,
      slug: lm.value,
      name: label,
      seriesId: plan.series,
      status: "active",
      sortOrder: index,
      beds: bdba ? Number(bdba[1]) : null,
      baths: bdba ? Number(bdba[2]) : null,
      sqft: Number.isFinite(sqft) ? sqft : null,
      description: "",
      canibuildDesignName: lm.canibuildDesignName || label,
      preApproved: lm.preApproved,
      preApprovedTitle: lm.preApprovedTitle || "",
      preApprovedCities: lm.preApprovedCities ?? [],
      basePrice: legacyPrice(quote.basePrice, { model: label, label: "Starting price" }),
      floorplans: { standard: null, mirror: null },
      options,
      exteriors,
      interiors,
      appliances,
      upgrades,
      bathrooms,
      renders: {},
      ceilingFallback: false,
      legacyAliases: dedupeAliases(aliases),
      rev: 1,
    };

    // --- Local renderings ---------------------------------------------------
    for (const file of files) {
      const c = classify(file, isSignature, label);
      const provenance = `ActonADU_Configurator/Models/${file.rel}`;
      if (c.kind === "unknown") {
        report.uncertainMappings.push({
          model: label,
          file: file.rel,
          message: `${c.reason}; imported to the media library unassigned.`,
        });
        await tryRegister(
          readFileSync(file.abs),
          file.name,
          "local_import",
          provenance,
          classification({ modelId, confidence: "low", notes: [c.reason] }),
        );
        continue;
      }
      if (c.kind === "floorplan") {
        if (c.size === "800") continue; // the 3k version is used; 800px is a redundant copy
        const asset = await tryRegister(
          readFileSync(file.abs),
          file.name,
          "local_import",
          provenance,
          classification({ kind: "floorplan", modelId, mirror: c.mirror }),
        );
        if (!asset) continue;
        if (c.mirror) model.floorplans.mirror = asset.id;
        else model.floorplans.standard = asset.id;
        report.images.floorplans++;
        continue;
      }
      const slot: Slot =
        c.kind === "exterior"
          ? { type: "ext", styleId: styleId(c.style), variant: c.variant, ceiling: c.ceiling }
          : { type: "int", styleId: styleId(c.style), role: c.role, ceiling: c.ceiling };
      const asset = await tryRegister(
        readFileSync(file.abs),
        file.name,
        "local_import",
        provenance,
        classification({
          kind: c.kind,
          modelId,
          styleId: styleId(c.style),
          role: c.kind === "interior" ? c.role : null,
          ceiling: c.ceiling,
          variant: c.kind === "exterior" ? c.variant : null,
        }),
      );
      if (!asset) {
        report.missingRenders.push({
          model: label,
          file: file.rel,
          message: `The file for this rendering could not be read: ${file.rel}`,
        });
        continue;
      }
      const key = slotKey(slot);
      if (model.renders[key] && model.renders[key] !== asset.id) {
        report.images.duplicates.push({
          model: label,
          file: file.rel,
          message: `Second file for the same rendering (${key}); the first one was kept.`,
        });
        continue;
      }
      model.renders[key] = asset.id;
    }

    // --- Legacy bathroom renderings (not in the local folder) ---------------
    for (const b of bathroomImages) {
      const bathroomId = slugify(b.type);
      const key = slotKey({ type: "bath", styleId: b.interior, bathroomId });
      if (model.renders[key]) continue;
      const fetched = await fetchLegacyBest(b.url);
      if (!fetched) {
        report.missingRenders.push({
          model: label,
          message: `Could not download the live site's ${b.type} image for ${b.interior}.`,
        });
        continue;
      }
      report.images.legacyFiles++;
      const asset = await tryRegister(
        fetched.buf,
        path.basename(fetched.url),
        "legacy_site",
        fetched.url.replace(/^http:/, "https:"),
        classification({
          kind: "bathroom",
          modelId,
          styleId: b.interior,
          bathroomName: b.type,
          confidence: "medium",
          notes: [
            "Bathroom rendering copied from the live configurator; not in the local Models folder.",
          ],
        }),
      );
      if (asset) model.renders[key] = asset.id;
    }
    const bathImageUrls = new Set(bathroomImages.map((b) => b.url));
    if (bathroomImages.length && bathImageUrls.size < bathroomImages.length)
      report.uncertainMappings.push({
        model: label,
        message: `The live site uses the same bathroom image for more than one bathroom type (e.g. Bathtub and Shower Pan). Imported as-is; replace with type-specific renderings if they exist.`,
      });

    if (plan.note) report.uncertainMappings.push({ model: label, message: plan.note });
    const tagged = files.filter((f) => /\((O-\d+|GS)\)/.test(f.name));
    if (tagged.length)
      report.uncertainMappings.push({
        model: label,
        message: `${tagged.length} interior file names carry extra tags “(O-1) (GS)”. They were mapped by style and rendering type; confirm these are the current ${label} renderings.`,
      });
    models.push(model);
  }

  // --- Interior style detail boards (shared per style) ----------------------
  for (const [sid, candidates] of detailsCandidates) {
    const best = [...candidates.values()].sort((a, b) => b.count - a.count)[0];
    if (!best) continue;
    const fetched = await fetchLegacyBest(best.url);
    if (!fetched) continue;
    report.images.legacyFiles++;
    const asset = await tryRegister(
      fetched.buf,
      path.basename(fetched.url),
      "legacy_site",
      fetched.url.replace(/^http:/, "https:"),
      classification({
        kind: "details",
        styleId: sid,
        confidence: "medium",
        notes: ["Style details board copied from the live configurator."],
      }),
    );
    const style = styles.find((s) => s.id === sid);
    if (style && asset) style.detailsAssetId = asset.id;
  }

  // --- Coverage + report ----------------------------------------------------
  const assetIds = new Set<string>();
  for (const model of models) {
    const required = requiredSlots(model, "single");
    const missing = required.filter((r) => !model.renders[r.key]);
    for (const r of missing)
      report.missingRenders.push({ model: model.name, message: describe(r.slot, model, styles) });
    Object.values(model.renders).forEach((id) => assetIds.add(id));
    report.images.mappedSlots += Object.keys(model.renders).length;
    report.models.push({
      id: model.id,
      name: model.name,
      series: model.seriesId,
      folder: plans.find((p) => p.legacyValue === model.slug)?.folder ?? "",
      folderNote: plans.find((p) => p.legacyValue === model.slug)?.note ?? null,
      beds: model.beds,
      baths: model.baths,
      sqft: model.sqft,
      images: {
        required: required.length,
        mapped: required.length - missing.length,
        missing: missing.length,
      },
      options: model.options.length,
      exteriors: model.exteriors.length,
      interiors: model.interiors.length,
      appliances: model.appliances.length,
      upgrades: model.upgrades.length,
      bathrooms: model.bathrooms.length,
    });
  }
  report.images.unusedButImported = assets.filter(
    (a) =>
      !assetIds.has(a.id) &&
      a.classification?.kind !== "floorplan" &&
      a.classification?.kind !== "details",
  ).length;

  const region = JSON.parse(readFileSync(path.join(SNAPSHOT, "legacy-region.json"), "utf8")) as {
    cities: string[];
    pricedZips: string[];
    unresolvedZips: string[];
    zipCities: Record<string, string[]>;
  };
  report.regions.cities = region.cities.length;
  report.regions.note = `The live site priced ${region.pricedZips.length} ZIP codes identically, so one region (“Bay Area”) was created with the ${region.cities.length} USPS cities those ZIPs belong to. The new configurator matches by city, so every ZIP of these cities is now included — review the list.`;
  if (region.unresolvedZips.length)
    report.regions.flags.push(
      `${region.unresolvedZips.length} legacy ZIPs could not be matched to a city (${region.unresolvedZips.join(", ")}); they are usually PO-box or unique ZIPs.`,
    );
  const partialCities = ["San Francisco", "Milpitas"];
  report.regions.flags.push(
    `The live site priced only some ZIPs in a few cities (for example San Francisco: ${Object.entries(
      region.zipCities,
    )
      .filter(([, c]) => c.includes("San Francisco"))
      .map(([z]) => z)
      .join(
        ", ",
      )}). San Francisco is included; Milpitas was never priced and is not included. Review: ${partialCities.join(", ")}.`,
  );

  const catalog: Catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, rev: 1 },
    series: [
      { id: "investor", slug: "investor", name: "Investor Series", sortOrder: 0, rev: 1 },
      { id: "signature", slug: "signature", name: "Signature Series", sortOrder: 1, rev: 1 },
    ],
    styles,
    regions: [
      {
        id: REGION_ID,
        name: "Bay Area",
        color: "#22c55e",
        cities: region.cities.map((name) => ({ name, state: "CA" })),
        sortOrder: 0,
        rev: 1,
      },
    ],
    models,
  };

  await writeOutputs(catalog);
  printSummary();
}

function dedupeAliases(aliases: LegacyAlias[]): LegacyAlias[] {
  const seen = new Set<string>();
  return aliases.filter((a) => {
    const key = `${a.kind}|${a.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describe(slot: Slot, model: Model, styles: SharedStyle[]): string {
  const style = styles.find((s) => s.id === slot.styleId)?.name ?? slot.styleId;
  if (slot.type === "ext") {
    const porch = model.options.length
      ? slot.variant === "porch"
        ? " with Porch"
        : " (Standard)"
      : "";
    return `Missing ${slot.ceiling}-foot ${style} exterior rendering for ${model.name}${porch}.`;
  }
  if (slot.type === "int") {
    const role = {
      kitchen: "Kitchen",
      lighting_daytime: "Lighting Daytime",
      appliance_base: "Appliance Base",
      appliance_mid: "Appliance Mid",
      lighting_dusk_uplights: "Lighting Dusk Uplights",
      lighting_dusk: "Lighting Dusk",
      ambiance: "Ambiance",
    }[slot.role];
    return `Missing ${slot.ceiling}-foot ${style} ${role} rendering for ${model.name}.`;
  }
  const bath = model.bathrooms.find((b) => b.id === slot.bathroomId)?.name ?? slot.bathroomId;
  return `Missing ${style} ${bath} bathroom rendering for ${model.name}.`;
}

async function writeOutputs(catalog: Catalog): Promise<void> {
  if (dryRun) {
    mkdirSync(LOCAL_DIR, { recursive: true });
    writeFileSync(
      path.join(LOCAL_DIR, "import-report.dry-run.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `[dry run] report only: ${path.relative(ROOT, LOCAL_DIR)}/import-report.dry-run.json`,
    );
    return;
  }
  if (target === "local") {
    mkdirSync(LOCAL_DIR, { recursive: true });
    writeFileSync(
      path.join(LOCAL_DIR, "seed.json"),
      JSON.stringify({ catalog, assets, importReport: report }),
    );
    writeFileSync(path.join(LOCAL_DIR, "import-report.json"), JSON.stringify(report, null, 2));
    console.log(`Wrote ${path.relative(ROOT, LOCAL_DIR)}/seed.json`);
    return;
  }
  if (!supabase) return;
  const { data: draft } = await supabase
    .from("configurator_documents")
    .select("revision")
    .eq("key", "draft")
    .maybeSingle();
  if (!draft || replaceDraft) {
    const { error } = await supabase.from("configurator_documents").upsert({
      key: "draft",
      body: catalog,
      revision: ((draft?.revision as number | undefined) ?? 0) + 1,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Draft write failed: ${error.message}`);
    console.log("Draft catalog written.");
  } else {
    console.log(
      "A draft already exists; it was kept. Pass --replace-draft to overwrite it with the import.",
    );
  }
  const { error } = await supabase
    .from("configurator_documents")
    .upsert({
      key: "import_report",
      body: report,
      revision: 1,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Import report write failed: ${error.message}`);
  writeFileSync(
    path.join(ROOT, "ActonADU_Configurator", "import-report.json"),
    JSON.stringify(report, null, 2),
  );
}

function printSummary(): void {
  console.log(`Models: ${report.models.length}`);
  for (const m of report.models)
    console.log(
      `  ${m.name.padEnd(22)} images ${m.images.mapped}/${m.images.required}  options ${m.options}  ext ${m.exteriors}  int ${m.interiors}`,
    );
  console.log(
    `Images: ${assets.length} registered (${report.images.localFiles} local files, ${report.images.legacyFiles} from live site)`,
  );
  console.log(`Missing renderings: ${report.missingRenders.length}`);
  console.log(`Uncertain mappings: ${report.uncertainMappings.length}`);
  console.log(
    `Prices imported (needs review): ${report.pricing.itemsImported}; without legacy price: ${report.pricing.itemsWithoutLegacyPrice.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
