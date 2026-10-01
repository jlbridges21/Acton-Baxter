import QRCode from "qrcode";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Host with a dotted domain, optional port, and optional path — no scheme and no spaces. */
const BARE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i;

export const QR_PNG_FILENAME = "acton-qr.png";
export const QR_SVG_FILENAME = "acton-qr.svg";

export const QR_PNG_SIZES = [
  { id: "small", label: "Small", pixels: 256 },
  { id: "medium", label: "Medium", pixels: 512 },
  { id: "large", label: "Large", pixels: 1024 },
] as const;

export type QrPngSizeId = (typeof QR_PNG_SIZES)[number]["id"];

const QR_OPTIONS = {
  margin: 2,
  errorCorrectionLevel: "M" as const,
};

/**
 * Prefix https:// when the text is a host without a scheme.
 * Phone numbers, sentences, and strings that already have a scheme stay as typed.
 */
export function normalizeQrInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (SCHEME.test(trimmed)) return trimmed;
  if (BARE_HOST.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function qrPngSize(id: QrPngSizeId) {
  const size = QR_PNG_SIZES.find((entry) => entry.id === id);
  if (!size) throw new Error(`Unknown QR size: ${id}`);
  return size;
}

export async function generateQrAssets(
  text: string,
  pngPixels: number,
): Promise<{ pngDataUrl: string; svg: string }> {
  const [pngDataUrl, svg] = await Promise.all([
    QRCode.toDataURL(text, { ...QR_OPTIONS, width: pngPixels }),
    QRCode.toString(text, { ...QR_OPTIONS, type: "svg" }),
  ]);
  return { pngDataUrl, svg };
}
