import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACTORY_HOTSPOT_STYLE,
  readHotspotStyle,
  writeHotspotStyle,
} from "@/lib/tours/hotspot-style";

function memoryStorage(initial = ""): Storage {
  const values = new Map<string, string>();
  if (initial) values.set("baxter.tours.hotspot-style", initial);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("sticky hotspot style", () => {
  it("falls back field by field and ignores a throwing store", () => {
    expect(readHotspotStyle(null)).toEqual(FACTORY_HOTSPOT_STYLE);
    expect(
      readHotspotStyle(
        memoryStorage(
          JSON.stringify({
            styleShape: "square",
            stylePlacement: "floor",
            styleColor: "#112233",
            styleSize: 64,
          }),
        ),
      ),
    ).toEqual({
      styleShape: "arrow",
      stylePlacement: "floor",
      styleColor: "#112233",
      styleSize: 64,
    });
    expect(
      readHotspotStyle(
        memoryStorage(
          JSON.stringify({
            styleShape: "chevron",
            stylePlacement: "painted",
            styleColor: "white",
            styleSize: 200,
          }),
        ),
      ),
    ).toEqual({
      ...FACTORY_HOTSPOT_STYLE,
      styleShape: "chevron",
    });
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readHotspotStyle(throwing)).toEqual(FACTORY_HOTSPOT_STYLE);
    expect(() => writeHotspotStyle(throwing, FACTORY_HOTSPOT_STYLE)).not.toThrow();
  });

  it("stores shape, placement, color, and size only", () => {
    const storage = memoryStorage();
    writeHotspotStyle(storage, {
      styleShape: "ring",
      stylePlacement: "floor",
      styleColor: "#ABCDEF",
      styleSize: 32,
    });
    const raw = storage.getItem("baxter.tours.hotspot-style") ?? "";
    expect(raw).not.toContain("rotation");
    expect(raw).not.toContain("label");
    expect(raw).not.toContain("target");
    expect(readHotspotStyle(storage)).toEqual({
      styleShape: "ring",
      stylePlacement: "floor",
      styleColor: "#ABCDEF",
      styleSize: 32,
    });
    const editor = readFileSync(
      path.join(process.cwd(), "src/components/tours/tour-editor.tsx"),
      "utf8",
    );
    expect(editor).toContain("readHotspotStyle");
    expect(editor).toContain("styleRotation: 0");
    expect(editor).toContain('type: "link"');
    expect(editor).not.toContain("replaceHotspots");
  });
});
