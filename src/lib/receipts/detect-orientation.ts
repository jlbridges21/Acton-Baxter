/**
 * Detect how many clockwise degrees to rotate a receipt photo so printed text is upright.
 */

import "server-only";

import { getBaxterVisionProvider } from "@/lib/baxter-ai/vision";
import type { ReceiptRotationDegrees } from "./rotate-image";

export const RECEIPT_ORIENTATION_DETECT_PROMPT = `You are looking at a photo of a receipt, invoice, or billing statement.
The paper may be lying sideways or upside-down in the frame (this is common). EXIF orientation is already corrected — judge only how the printed text runs in the pixels you see.

Return ONLY valid JSON:
{"rotationDegrees": 0|90|180|270, "confidence": 0-1}

Rules:
- rotationDegrees = clockwise degrees to rotate the IMAGE so the printed text reads upright (lines left-to-right, top of the document toward the top of the image).
- Use 0 if text is already upright.
- Use 90 if the receipt is rotated so the top of the paper is toward the left edge (text runs vertically).
- Use 180 if upside-down.
- Use 270 if the top of the paper is toward the right edge.
- Prefer the orientation where dollar amounts and dates are easiest to read.
- confidence reflects how sure you are (0–1). Do not invent document fields — orientation only.`;

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error("Model returned non-JSON");
  }
}

function coerceRotation(value: unknown): ReceiptRotationDegrees | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (n === 0 || n === 90 || n === 180 || n === 270) return n;
  // Tolerate counter-clockwise answers as clockwise equivalents.
  if (n === -90 || n === 360 - 90) return 270;
  if (n === -180) return 180;
  if (n === -270) return 90;
  return null;
}

export type DetectReceiptOrientationResult = {
  rotationDegrees: ReceiptRotationDegrees;
  confidence: number;
};

/**
 * Ask vision how far to rotate clockwise so receipt text is upright.
 * On failure, returns 0° (caller may still extract / multi-try).
 */
export async function detectReceiptUprightRotation(input: {
  mimeType: string;
  base64Data: string;
  filename?: string;
}): Promise<DetectReceiptOrientationResult> {
  try {
    const provider = getBaxterVisionProvider();
    const result = await provider.analyzeImageJson({
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      filename: input.filename ?? "receipt.jpg",
      prompt: RECEIPT_ORIENTATION_DETECT_PROMPT,
    });
    const raw = parseJsonObject(result.content) as Record<string, unknown>;
    const rotation = coerceRotation(raw.rotationDegrees ?? raw.rotation_degrees);
    const confidenceRaw = Number(raw.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0.5;
    if (rotation == null) {
      return { rotationDegrees: 0, confidence: 0 };
    }
    return { rotationDegrees: rotation, confidence };
  } catch (error) {
    console.warn(
      "detectReceiptUprightRotation failed; defaulting to 0°",
      error instanceof Error ? error.message : error,
    );
    return { rotationDegrees: 0, confidence: 0 };
  }
}

export function isOrientationDetectPrompt(prompt: string): boolean {
  return prompt.includes("rotationDegrees") && prompt.includes("printed text reads upright");
}
