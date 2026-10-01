import { PNG } from "pngjs";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { generateQrAssets, normalizeQrInput, QR_PNG_SIZES, QR_SVG_FILENAME } from "@/lib/tools/qr";

function decodePngDataUrl(dataUrl: string): string | null {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code?.data ?? null;
}

describe("normalizeQrInput", () => {
  it("prefixes https:// on a host with no scheme", () => {
    expect(normalizeQrInput("actonadu.com")).toBe("https://actonadu.com");
    expect(normalizeQrInput("  www.actonadu.com/plans  ")).toBe("https://www.actonadu.com/plans");
  });

  it("leaves schemes and plain text alone", () => {
    expect(normalizeQrInput("https://actonadu.com")).toBe("https://actonadu.com");
    expect(normalizeQrInput("tel:+15125550100")).toBe("tel:+15125550100");
    expect(normalizeQrInput("Call 555-1212")).toBe("Call 555-1212");
    expect(normalizeQrInput("Meet at the yard")).toBe("Meet at the yard");
  });
});

describe("generateQrAssets", () => {
  it("encodes a URL that decodes back to the same input", async () => {
    const text = "https://actonadu.com/plans";
    const { pngDataUrl, svg } = await generateQrAssets(text, 256);
    expect(pngDataUrl.startsWith("data:image/png")).toBe(true);
    expect(decodePngDataUrl(pngDataUrl)).toBe(text);
    expect(svg).toMatch(/<svg[\s>]/);
    expect(svg).toContain("</svg>");
  });

  it("encodes a scheme-less host and plain text", async () => {
    const url = normalizeQrInput("actonadu.com");
    const note = normalizeQrInput("Call 555-1212");
    expect(decodePngDataUrl((await generateQrAssets(url, 256)).pngDataUrl)).toBe(
      "https://actonadu.com",
    );
    expect(decodePngDataUrl((await generateQrAssets(note, 256)).pngDataUrl)).toBe("Call 555-1212");
  });

  it("writes PNG files at each preset size and a real SVG document", async () => {
    const widths: number[] = [];
    for (const size of QR_PNG_SIZES) {
      const { pngDataUrl, svg } = await generateQrAssets("https://actonadu.com", size.pixels);
      const base64 = pngDataUrl.split(",")[1];
      expect(base64).toBeTruthy();
      const bytes = Buffer.from(base64!, "base64");
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const png = PNG.sync.read(bytes);
      expect(png.width).toBe(size.pixels);
      expect(png.height).toBe(size.pixels);
      widths.push(png.width);
      if (size.id === "large") {
        expect(svg).toMatch(/<svg[\s>]/);
        expect(svg).toContain("</svg>");
        expect(QR_SVG_FILENAME.endsWith(".svg")).toBe(true);
      }
    }
    expect(widths).toEqual([256, 512, 1024]);
  });
});
