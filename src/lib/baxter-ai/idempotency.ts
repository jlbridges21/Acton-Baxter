import "server-only";

import { recordDuplicateRequestPrevented } from "./openai-metrics";
import type { BaxterAnswer } from "./types";

type IdempotencyEntry = {
  result: BaxterAnswer;
  expiresAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __baxterChatIdempotency?: Map<string, IdempotencyEntry>;
};

function getStore(): Map<string, IdempotencyEntry> {
  if (!globalStore.__baxterChatIdempotency) {
    globalStore.__baxterChatIdempotency = new Map();
  }
  return globalStore.__baxterChatIdempotency;
}

export function resetChatIdempotencyForTests() {
  globalStore.__baxterChatIdempotency = new Map();
}

const TTL_MS = 10 * 60 * 1000;

export function getIdempotentChatAnswer(
  userId: string,
  clientRequestId: string,
): BaxterAnswer | null {
  const key = `${userId}:${clientRequestId}`;
  const entry = getStore().get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    getStore().delete(key);
    return null;
  }
  recordDuplicateRequestPrevented();
  return entry.result;
}

export function storeIdempotentChatAnswer(
  userId: string,
  clientRequestId: string,
  result: BaxterAnswer,
): void {
  getStore().set(`${userId}:${clientRequestId}`, {
    result,
    expiresAt: Date.now() + TTL_MS,
  });
}
