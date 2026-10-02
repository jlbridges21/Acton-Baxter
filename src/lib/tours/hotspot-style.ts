import {
  HOTSPOT_SHAPES,
  type HotspotPlacement,
  type HotspotShape,
} from "@/lib/tours/hotspot-shapes";

export const HOTSPOT_STYLE_STORAGE_KEY = "baxter.tours.hotspot-style";

export type HotspotStyleDefaults = {
  styleShape: HotspotShape;
  stylePlacement: HotspotPlacement;
  styleColor: string;
  styleSize: number;
};

export const FACTORY_HOTSPOT_STYLE: HotspotStyleDefaults = {
  styleShape: "arrow",
  stylePlacement: "billboard",
  styleColor: "#FFFFFF",
  styleSize: 48,
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

type StyleStorage = Pick<Storage, "getItem" | "setItem">;

export function readHotspotStyle(storage: StyleStorage | null): HotspotStyleDefaults {
  if (!storage) return { ...FACTORY_HOTSPOT_STYLE };
  try {
    const raw = storage.getItem(HOTSPOT_STYLE_STORAGE_KEY);
    if (!raw) return { ...FACTORY_HOTSPOT_STYLE };
    const parsed = JSON.parse(raw) as Partial<HotspotStyleDefaults>;
    return {
      styleShape: validShape(parsed.styleShape),
      stylePlacement: validPlacement(parsed.stylePlacement),
      styleColor: validColor(parsed.styleColor),
      styleSize: validSize(parsed.styleSize),
    };
  } catch {
    return { ...FACTORY_HOTSPOT_STYLE };
  }
}

export function writeHotspotStyle(storage: StyleStorage | null, style: HotspotStyleDefaults): void {
  if (!storage) return;
  try {
    storage.setItem(
      HOTSPOT_STYLE_STORAGE_KEY,
      JSON.stringify({
        styleShape: style.styleShape,
        stylePlacement: style.stylePlacement,
        styleColor: style.styleColor,
        styleSize: style.styleSize,
      }),
    );
  } catch {
    // Private mode and blocked storage leave the factory defaults in place.
  }
}

export function browserHotspotStorage(): StyleStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function styleFieldsChanged(
  previous: HotspotStyleDefaults,
  next: HotspotStyleDefaults,
): boolean {
  return (
    previous.styleShape !== next.styleShape ||
    previous.stylePlacement !== next.stylePlacement ||
    previous.styleColor !== next.styleColor ||
    previous.styleSize !== next.styleSize
  );
}

function validShape(value: unknown): HotspotShape {
  if (typeof value === "string" && (HOTSPOT_SHAPES as readonly string[]).includes(value)) {
    return value as HotspotShape;
  }
  return FACTORY_HOTSPOT_STYLE.styleShape;
}

function validPlacement(value: unknown): HotspotPlacement {
  if (value === "floor" || value === "billboard") return value;
  return FACTORY_HOTSPOT_STYLE.stylePlacement;
}

function validColor(value: unknown): string {
  if (typeof value === "string" && HEX.test(value)) return value;
  return FACTORY_HOTSPOT_STYLE.styleColor;
}

function validSize(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 16 && value <= 128) {
    return value;
  }
  return FACTORY_HOTSPOT_STYLE.styleSize;
}
