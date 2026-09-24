/**
 * Auth header diagnostics + signed-upload contract (TUS kept as debt helpers).
 */
import { describe, expect, it } from "vitest";
import {
  normalizeAccessToken,
  redactApiKeyForLog,
  redactAuthorizationForLog,
  supabaseResumableUploadEndpoint,
} from "@/lib/inspections/media-limits";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("upload auth + endpoint contract", () => {
  it("normalizes Bearer prefix and rejects malformed JWTs", () => {
    const raw = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    expect(normalizeAccessToken(raw)).toBe(raw);
    expect(normalizeAccessToken(`Bearer ${raw}`)).toBe(raw);
    expect(normalizeAccessToken(`bearer ${raw} `)).toBe(raw);
    expect(() => normalizeAccessToken("")).toThrow(/invalid/i);
    expect(() => normalizeAccessToken("Bearer ")).toThrow(/invalid/i);
    expect(() => normalizeAccessToken("not-a-jwt")).toThrow(/invalid/i);
  });

  it("redacts Authorization structure for diagnostics", () => {
    const token = "aaa.bbb.ccc";
    expect(redactAuthorizationForLog(`Bearer ${token}`)).toEqual({
      hasBearerPrefix: true,
      bearerPrefixCount: 1,
      tokenSegmentCount: 3,
      firstSegmentPrefix: "aaa",
      tokenLength: token.length,
    });
    expect(redactAuthorizationForLog(`Bearer ${token}, Bearer ${token}`)).toMatchObject({
      bearerPrefixCount: 2,
      tokenSegmentCount: 5,
    });
  });

  it("classifies legacy JWT vs new-format publishable keys", () => {
    expect(redactApiKeyForLog("eyJhbGciOiJIUzI1NiJ9.aa.bb").format).toBe("legacy_jwt");
    expect(redactApiKeyForLog("sb_publishable_abc").format).toBe("sb_publishable");
  });

  it("uses direct storage hostname for resumable uploads (TUS debt helper)", () => {
    expect(supabaseResumableUploadEndpoint("https://abcd.supabase.co")).toBe(
      "https://abcd.storage.supabase.co/storage/v1/upload/resumable",
    );
    expect(supabaseResumableUploadEndpoint("https://abcd.storage.supabase.co")).toBe(
      "https://abcd.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("prepare uses TUS for video and signed uploads for photo", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/inspections/records-store.ts"),
      "utf8",
    );
    expect(source).toContain("createSignedUploadForPath");
    expect(source).toContain('mode: "tus"');
    expect(source).toContain('mode: "signed"');
    expect(source).toContain("Does NOT create a media row");
  });

  it("browser supabase client is a singleton", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/supabase/client.ts"), "utf8");
    expect(source).toContain("browserClient");
    expect(source).toContain("if (browserClient) return browserClient");
  });
});
