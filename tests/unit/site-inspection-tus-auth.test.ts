/**
 * Auth header normalization + TUS endpoint helpers for site inspection uploads.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeAccessToken,
  redactAuthorizationForLog,
  supabaseResumableUploadEndpoint,
} from "@/lib/inspections/media-limits";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("TUS auth + endpoint contract", () => {
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
      tokenSegmentCount: 3,
      tokenLength: token.length,
    });
  });

  it("uses direct storage hostname for resumable uploads", () => {
    expect(supabaseResumableUploadEndpoint("https://abcd.supabase.co")).toBe(
      "https://abcd.storage.supabase.co/storage/v1/upload/resumable",
    );
    expect(supabaseResumableUploadEndpoint("https://abcd.storage.supabase.co")).toBe(
      "https://abcd.storage.supabase.co/storage/v1/upload/resumable",
    );
  });

  it("prepare route uses storage hostname helper", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/inspections/records-store.ts"),
      "utf8",
    );
    expect(source).toContain("supabaseResumableUploadEndpoint");
  });

  it("browser supabase client is a singleton", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/supabase/client.ts"), "utf8");
    expect(source).toContain("browserClient");
    expect(source).toContain("if (browserClient) return browserClient");
  });
});
