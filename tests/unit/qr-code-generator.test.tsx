/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QrCodeGenerator } from "@/components/tools/qr-code-generator";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function decodePngDataUrl(dataUrl: string): string | null {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

describe("QrCodeGenerator", () => {
  it("starts empty, then downloads a PNG and SVG that match the input", async () => {
    render(
      <div style={{ width: 375 }}>
        <QrCodeGenerator />
      </div>,
    );

    expect(screen.getByText(/paste a link or a short message, then generate/i)).toBeTruthy();
    const root = screen.getByTestId("qr-generator");
    expect(root.className).toContain("w-full");
    expect(screen.getByRole("textbox", { name: /url or text/i }).className).toContain("w-full");

    const downloads: Array<{ name: string; href: string }> = [];
    const blobs: Blob[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href });
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:acton-qr";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    fireEvent.change(screen.getByRole("textbox", { name: /url or text/i }), {
      target: { value: "actonadu.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    const preview = await screen.findByRole("img", { name: /qr code for https:\/\/actonadu.com/i });
    expect(decodePngDataUrl(preview.getAttribute("src") ?? "")).toBe("https://actonadu.com");
    expect(screen.getByText("Encoded: https://actonadu.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "Download SVG" }));

    expect(downloads[0]).toMatchObject({
      name: "acton-qr.png",
    });
    expect(downloads[0]?.href.startsWith("data:image/png")).toBe(true);
    expect(downloads[1]).toEqual({ name: "acton-qr.svg", href: "blob:acton-qr" });
    const svg = await blobs[0]?.text();
    expect(svg).toMatch(/<svg[\s>]/);
    expect(svg).toContain("</svg>");
  });

  it("uses the selected PNG size", async () => {
    render(<QrCodeGenerator />);
    fireEvent.change(screen.getByRole("textbox", { name: /url or text/i }), {
      target: { value: "https://actonadu.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /small/i }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const small = await screen.findByRole("img", { name: /qr code/i });
    const smallPng = PNG.sync.read(
      Buffer.from((small.getAttribute("src") ?? "").split(",")[1] ?? "", "base64"),
    );
    expect(smallPng.width).toBe(256);

    fireEvent.click(screen.getByRole("button", { name: /large/i }));
    await waitFor(() => {
      const large = screen.getByRole("img", { name: /qr code/i });
      const largePng = PNG.sync.read(
        Buffer.from((large.getAttribute("src") ?? "").split(",")[1] ?? "", "base64"),
      );
      expect(largePng.width).toBe(1024);
    });
  });

  it("explains an empty generate and a payload that cannot be encoded", async () => {
    render(<QrCodeGenerator />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByRole("alert").textContent).toMatch(/enter a link or some text/i);

    fireEvent.change(screen.getByRole("textbox", { name: /url or text/i }), {
      target: { value: "x".repeat(4000) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/shorter message/i);
    });
  });
});
