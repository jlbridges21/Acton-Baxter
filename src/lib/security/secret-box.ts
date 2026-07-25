import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = (process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured");
  }
  // Accept 32-byte base64 or derive from passphrase via SHA-256.
  try {
    const asBuf = Buffer.from(raw, "base64");
    if (asBuf.length === 32) return asBuf;
  } catch {
    // fall through
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isGoogleTokenEncryptionConfigured(): boolean {
  return Boolean((process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim());
}

/**
 * Authenticated encryption for Google refresh tokens.
 * Format: base64(iv).base64(ciphertext).base64(authTag)
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${encrypted.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, dataB64, tagB64] = payload.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
