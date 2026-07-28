import { AppError } from "@/lib/errors";

/** Map store/provider failures to safe AppErrors (never leak Postgres/PGRST to clients). */
export function pemNeatStoreError(error: unknown, fallback = "Unable to save PEM NEAT"): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (/relation .* does not exist|could not find the table|undefined_table|42p01/i.test(message)) {
    return new AppError(
      "PEM NEAT database tables are not available yet. Ask an admin to apply migrations 025–027 (pem_neats).",
      { code: "PEM_NEAT_MIGRATION_REQUIRED", statusCode: 503, cause: error },
    );
  }

  if (/foreign key|23503/i.test(message)) {
    return new AppError("Selected salesperson is not a valid Baxter user profile.", {
      code: "PEM_NEAT_SALESPERSON_INVALID",
      statusCode: 400,
      cause: error,
    });
  }

  if (/timeout|timed out|abort/i.test(lower)) {
    return new AppError(
      "PEM NEAT generation timed out. Your transcript was saved — try regenerating.",
      { code: "PEM_NEAT_TIMEOUT", statusCode: 504, cause: error },
    );
  }

  return new AppError(fallback, {
    code: "PEM_NEAT_STORE_ERROR",
    statusCode: 500,
    cause: error,
    expose: true,
  });
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Dedicated PEM generation timeout — large structured JSON often exceeds the global 12s API timeout. */
export function getPemNeatProviderTimeoutMs(): number {
  const raw = process.env.PEM_NEAT_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(Math.max(Number(raw), 30_000), 300_000);
  }
  return 120_000;
}
