import { z } from "zod";

const booleanFromString = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return value.toLowerCase() === "true" || value === "1";
});

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  ENABLE_MOCK_RESEARCH: booleanFromString.default(true),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function readPublicRaw() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_BASE_URL:
      process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    ENABLE_MOCK_RESEARCH: process.env.ENABLE_MOCK_RESEARCH ?? "true",
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  };
}

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const parsed = publicEnvSchema.safeParse(readPublicRaw());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid public environment configuration: ${details}`);
  }
  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

export function resetPublicEnvCacheForTests() {
  cachedPublicEnv = null;
}
