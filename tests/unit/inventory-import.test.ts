import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  arithmeticMismatch,
  dollarsToCents,
  extractBuildComOrderFromLayout,
  shouldQueueVisionImport,
  type PdfPageLayout,
} from "@/lib/inventory/build-com-parse";
import {
  commitInventoryImport,
  parseBuildComPdf,
  readInventoryOrderPdf,
  resetInventoryOrdersForTests,
} from "@/lib/inventory/import-order";
import { resetInventoryFilesForTests } from "@/lib/inventory/order-files";
import { emptyInventoryFilters } from "@/lib/inventory/filters";
import {
  bulkUpdateInventoryItems,
  queryInventory,
  rememberInventoryJobLabelForTests,
  resetInventoryMemoryForTests,
  softDeleteInventoryItems,
} from "@/lib/inventory/store";

const SAMPLE = path.join(process.cwd(), "tests/fixtures/build-com-dev-order.pdf");
const JOB_ID = "11111111-1111-4111-8111-111111111111";

/** Printed Model, qty, unit cents, and line total from the sample PDF text layer. */
const EXPECTED: Array<[string, number, number, number]> = [
  ["4000101.020", 1, 8694, 8694],
  ["SCLAJXSQURCRR190", 2, 37660, 75320],
  ["442531", 1, 58968, 58968],
  ["88775-BL", 1, 59073, 59073],
  ["35749LF-BL", 1, 21316, 21316],
  ["KRLP325U4", 17, 2255, 38335],
  ["CDA 22", 1, 4875, 4875],
  ["BADGER5XPWC", 1, 18333, 18333],
  ["050-BS60-WZ", 1, 15700, 15700],
  ["KA821BB", 1, 5356, 5356],
  ["K-97626-BL", 1, 11949, 11949],
  ["KWDA-200BB", 1, 8240, 8240],
  ["720HFLSQT-514", 3, 3769, 11307],
  ["49100-07", 3, 18176, 54528],
  ["MDS01SBMB", 8, 508, 4064],
  ["FV-0511VQCL1", 1, 30166, 30166],
  ["P860046-031", 1, 2500, 2500],
  ["F51AGEO622", 1, 3152, 3152],
  ["SHGB18CMB", 1, 9405, 9405],
  ["M2603", 1, 1746, 1746],
  ["R4ERDR-W9CS-WT", 2, 2156, 4312],
  ["WCZLEDWSDSL6036", 1, 77600, 77600],
  ["3075000.020", 1, 35501, 35501],
  ["240332", 1, 10080, 10080],
  ["T60475-BL", 1, 116982, 116982],
  ["R60000-UNWS", 1, 11155, 11155],
  ["T60875-BLLHP", 2, 16975, 33950],
  ["T60875-BLLHP", 1, 16975, 16975],
  ["R60700", 1, 15423, 15423],
  ["S-LT 3860 SS", 1, 39000, 39000],
  ["435-V60S-LNO-3WZ", 1, 345900, 345900],
  ["KPF-2821BB", 1, 27495, 27495],
  ["730HFLSQT-514", 3, 3931, 11793],
  ["P5642-31/30K", 1, 12971, 12971],
  ["SHDR18TBMB", 1, 11406, 11406],
  ["SHDRTHMB", 1, 7211, 7211],
  ["SHDRTRMB", 1, 8256, 8256],
  ["SHDRRHMB", 1, 7211, 7211],
  ["482906", 1, 11305, 11305],
  ["M2605", 6, 2191, 13146],
];

const EXPECTED_NAMES = [
  "American Standard Cadet 3 1.28 GPF Toilet Tank with Performance Flus...",
  "Baldwin La Jolla Standard C Keyway Single Cylinder Keyed E...",
  'Blanco Precis 30" Undermount Single Basin SILGRANIT Kitch...',
  "Brizo Odin 1.75 GPM Single Function Hand Shower Package ...",
  "Delta Nicoli 1.2 GPM Widespread Bathroom Faucet with Lev...",
  "Deltana 3-1/4 Inch Bar Cabinet Knob...",
  'Infinity Drain Compact Clamp Down ABS Drain with 2" Throat and 2"...',
  "InSinkErator Badger 3/4 HP Continuous Feed Garbage Disposal...",
  'James Martin Vanities Silestone 60" Quartz Vanity Backsplash...',
  "Kingston Brass Trimscape Brass / Plastic Air Gap...",
  'Kohler Choreograph 36" Shower Barre...',
  "Kraus Garbage Disposal Air Switch Kit with Flat-Top Push...",
  "Kwikset Halifax Passage Door Lever Set with Square Rose...",
  'Livex Lighting Dublin Single Light 10" Wide Mini Pendant...',
  "Miseno Adjustable Solid Brass Hinge Pin Door Stop...",
  "Panasonic 110 CFM 0.3 Sone Ceiling Mounted LED Exhaust Fan w...",
  'Progress Lighting 6" Wide Round Cylinder Cover...',
  "Schlage Georgian Keyed Entry Door Knob Set...",
  'Signature Hardware Contemporary 18" Grab Bar...',
  "Top Knobs Bar Pulls 6-5/16 Inch Center to Center Handle Cabi...",
  'WAC Lighting Lotos 4" LED Canless Downlight with Adjustable Col...',
  'Wyndham Collection Carlton 60"W x 36"H Rectangular Flat Frameless Wal...',
  "American Standard Cadet 3 Elongated Toilet Bowl Only with Concealed ...",
  'Blanco 3-1/2" Metal Disposal Flange and Basket Strainer...',
  "Brizo Odin Tub and Shower Trim Package with Single Funct...",
  "Brizo MultiChoice Universal Tub and Shower Rough In Valv...",
  "Brizo Odin Three Function Diverter Valve Trim Less Handl...",
  "Brizo Odin Three Function Diverter Valve Trim Less Handl...",
  "Brizo Universal Diverter Rough-In Valve - For Use with A...",
  'Infinity Drain 60" Site Sizable Stainless Steel Low Profile Linea...',
  'James Martin Vanities Hudson 60" Free Standing Single Basin Poplar Wood ...',
  "Kraus Oletto 1.8 GPM High Arc Single Handle Pull Down Ki...",
  "Kwikset Halifax Privacy Door Lever Set with Square Rose...",
  "Progress Lighting LED Cylinder Outdoor Wall Sconce - Up / Down Light...",
  'Signature Hardware Drea 18" Towel Bar...',
  "Signature Hardware Drea Wall-Mounted Toilet Paper Holder...",
  'Signature Hardware Drea 10" Wall-Mounted Towel Ring...',
  "Signature Hardware Drea Single Robe Hook...",
  'Signature Hardware Contemporary 24" Grab Bar...',
  "Top Knobs Bar Pulls 11-3/8 Inch Center to Center Handle Cabi...",
];

const EXPECTED_FINISHES = [
  "White",
  "Satin Black",
  "Truffle",
  "Matte Black",
  "Matte Black",
  "Satin Brass",
  "N/A",
  "Power Cord Included",
  "White Zeus",
  "Brushed Brass",
  "Matte Black",
  "Brushed Brass",
  "Matte Black",
  "Bronze with Antique Brass Accents",
  "Matte Black",
  "N/A",
  "Black",
  "Matte Black",
  "Matte Black",
  "Honey Bronze",
  "White",
  "Silver",
  "White",
  "Truffle",
  "Matte Black",
  "na",
  "Matte Black",
  "Matte Black",
  "N/A",
  "Satin Stainless",
  "Light Natural Oak",
  "Brushed Brass",
  "Matte Black",
  "Black",
  "Matte Black",
  "Matte Black",
  "Matte Black",
  "Matte Black",
  "Matte Black",
  "Honey Bronze",
];

beforeEach(() => {
  resetInventoryMemoryForTests();
  resetInventoryOrdersForTests();
  resetInventoryFilesForTests();
  rememberInventoryJobLabelForTests(JOB_ID, "DEVIRREDY");
});

describe("build.com sample PDF", () => {
  it("matches every printed SKU, quantity, unit cost, and line total from the text layer", async () => {
    const result = await parseBuildComPdf(readFileSync(SAMPLE));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const { draft } = result;
    expect(draft.source).toBe("text");
    expect(draft.textUsable).toBe(true);
    expect(draft.orderNumber).toBe("95855811");
    expect(draft.vendor).toBe("build.com");
    expect(draft.lines).toHaveLength(EXPECTED.length);
    expect(
      draft.lines.map((line) => [line.sku, line.quantity, line.unitCostCents, line.lineTotalCents]),
    ).toEqual(EXPECTED);
    expect(draft.lines.every((line) => !line.flags.includes("arithmetic_mismatch"))).toBe(true);
    expect(draft.lines.every((line) => line.source === "text")).toBe(true);
    const subtotal = draft.lines.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0);
    expect(subtotal).toBe(1_260_699);
    expect(draft.lines.map((line) => line.itemName)).toEqual(EXPECTED_NAMES);
    expect(draft.lines.map((line) => line.description)).toEqual(EXPECTED_FINISHES);
    expect(draft.lines[0]?.productUrl).toContain("american-standard-4000-101");
    expect(draft.lines[2]?.productUrl).toContain("blanco-442533");
    expect(draft.lines.filter((line) => line.photoStoragePath)).toHaveLength(EXPECTED.length);
    expect(draft.lines.filter((line) => line.productUrl)).toHaveLength(EXPECTED.length);
  });
});

describe("import review and commit", () => {
  it("flags arithmetic that does not reconcile and still keeps the row", () => {
    expect(arithmeticMismatch({ quantity: 2, unitCostCents: 100, lineTotalCents: 250 })).toBe(true);
    expect(dollarsToCents("$1,169.82")).toBe(116982);
    const pages: PdfPageLayout[] = [
      {
        pageNumber: 1,
        links: [],
        images: [],
        items: [
          { str: "Order #", x: 30, y: 700 },
          { str: "12345", x: 80, y: 700 },
          { str: "Bad item", x: 140, y: 500 },
          { str: "$10.00", x: 520, y: 500 },
          { str: "Model:", x: 140, y: 480 },
          { str: "SKU1", x: 180, y: 480 },
          { str: "Color/Finish:", x: 140, y: 460 },
          { str: "Black", x: 200, y: 460 },
          { str: "$4.00", x: 140, y: 440 },
          { str: "(Qty.", x: 180, y: 440 },
          { str: "2", x: 210, y: 440 },
          { str: ")", x: 220, y: 440 },
        ],
      },
    ];
    const parsed = extractBuildComOrderFromLayout(pages);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.flags).toContain("arithmetic_mismatch");
    expect(parsed.lines[0]?.unitCostCents).toBe(400);
    expect(parsed.lines[0]?.lineTotalCents).toBe(1000);
  });

  it("persists review edits, deletions, and additions, then warns on a second upload", async () => {
    const pdf = readFileSync(SAMPLE);
    const parsed = await parseBuildComPdf(pdf);
    if (parsed.status !== "ready") throw new Error("expected a ready draft");
    const kept = parsed.draft.lines.slice(1, 3);
    const committed = await commitInventoryImport({
      sha256: parsed.draft.sha256,
      vendor: "build.com",
      orderNumber: parsed.draft.orderNumber,
      jobId: JOB_ID,
      customProjectLabel: null,
      allowDuplicate: false,
      actorId: "user-1",
      lines: [
        {
          itemName: "Corrected faucet",
          sku: kept[0]!.sku,
          description: "edited finish",
          quantity: 4,
          unitCostCents: kept[0]!.unitCostCents ?? 0,
          productUrl: kept[0]!.productUrl,
          photoStoragePath: kept[0]!.photoStoragePath,
        },
        {
          itemName: "Added by hand",
          sku: "MANUAL-1",
          quantity: 1,
          unitCostCents: 250,
          productUrl: null,
          photoStoragePath: null,
        },
      ],
    });
    expect(committed.itemCount).toBe(2);
    const rows = await queryInventory({
      ...emptyInventoryFilters(),
      vendor: "build.com",
      orderNumber: "95855811",
    });
    expect(rows.total).toBe(2);
    const bySku = new Map(rows.rows.map((row) => [row.sku, row]));
    expect(bySku.get(kept[0]!.sku)?.itemName).toBe("Corrected faucet");
    expect(bySku.get(kept[0]!.sku)?.quantity).toBe(4);
    expect(bySku.get(kept[0]!.sku)?.description).toBe("edited finish");
    expect(bySku.get(kept[0]!.sku)?.statusLabel).toBe("Ordered – not in");
    expect(bySku.get(kept[0]!.sku)?.projectLabel).toBe("DEVIRREDY");
    expect(bySku.get("MANUAL-1")?.itemName).toBe("Added by hand");
    expect(bySku.has(parsed.draft.lines[0]!.sku)).toBe(false);
    const target = bySku.get("MANUAL-1");
    expect(target).toBeTruthy();
    await bulkUpdateInventoryItems({
      ids: [target!.id],
      patch: { deliveryDate: "2026-09-30" },
      actorId: "user-1",
    });
    const afterBulk = await queryInventory({ ...emptyInventoryFilters(), q: "MANUAL-1" });
    expect(afterBulk.rows[0]?.deliveryDate).toBe("2026-09-30");
    expect(afterBulk.rows[0]?.vendor).toBe("build.com");

    const again = await parseBuildComPdf(pdf);
    if (again.status !== "ready") throw new Error("expected a ready draft");
    expect(again.draft.duplicate?.match).toBe("file");
    await expect(
      commitInventoryImport({
        sha256: again.draft.sha256,
        vendor: "build.com",
        orderNumber: again.draft.orderNumber,
        jobId: JOB_ID,
        customProjectLabel: null,
        allowDuplicate: false,
        actorId: "user-1",
        lines: [
          {
            itemName: "Duplicate",
            sku: "DUP",
            quantity: 1,
            unitCostCents: 100,
          },
        ],
      }),
    ).rejects.toThrow(/already imported/i);

    await softDeleteInventoryItems(
      (await queryInventory(emptyInventoryFilters())).rows.map((row) => row.id),
      "user-1",
    );
    expect((await queryInventory(emptyInventoryFilters())).total).toBe(0);
    const file = await readInventoryOrderPdf(committed.orderId);
    expect(file?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file?.bytes.equals(pdf)).toBe(true);
  });

  it("queues vision fallback only when the text layer is missing on a long PDF", () => {
    expect(shouldQueueVisionImport(8)).toBe(true);
    expect(shouldQueueVisionImport(1)).toBe(false);
  });
});
