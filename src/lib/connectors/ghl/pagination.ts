/**
 * Reusable pagination helpers for GHL list/search endpoints.
 */

export type GhlPageMeta = {
  total: number | null;
  hasMore: boolean;
  nextPageUrl: string | null;
  startAfterId: string | null;
  startAfter: string | number | null;
  currentPage: number | null;
  nextPage: number | null;
};

export function parseGhlPageMeta(meta: unknown): GhlPageMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  return {
    total: typeof m.total === "number" ? m.total : null,
    hasMore: Boolean(m.nextPageUrl || m.nextPage || m.startAfterId),
    nextPageUrl: typeof m.nextPageUrl === "string" ? m.nextPageUrl : null,
    startAfterId: typeof m.startAfterId === "string" ? m.startAfterId : null,
    startAfter:
      typeof m.startAfter === "string" || typeof m.startAfter === "number" ? m.startAfter : null,
    currentPage: typeof m.currentPage === "number" ? m.currentPage : null,
    nextPage: typeof m.nextPage === "number" ? m.nextPage : null,
  };
}

export type PaginateOptions<T> = {
  /** Max pages to fetch (hard cap). Default 5. */
  maxPages?: number;
  /** Max total items. Default 200. */
  maxItems?: number;
  fetchPage: (cursor: {
    page: number;
    startAfterId: string | null;
    startAfter: string | number | null;
  }) => Promise<{ items: T[]; meta: GhlPageMeta }>;
};

/**
 * Fetch multiple pages until exhausted or caps hit.
 * Never infinite — always bounded.
 */
export async function paginateGhl<T>(options: PaginateOptions<T>): Promise<{
  items: T[];
  total: number | null;
  pagesFetched: number;
  truncated: boolean;
}> {
  const maxPages = options.maxPages ?? 5;
  const maxItems = options.maxItems ?? 200;
  const items: T[] = [];
  let pagesFetched = 0;
  let total: number | null = null;
  let startAfterId: string | null = null;
  let startAfter: string | number | null = null;
  let truncated = false;

  for (let page = 1; page <= maxPages; page++) {
    const result = await options.fetchPage({ page, startAfterId, startAfter });
    pagesFetched += 1;
    if (result.meta.total != null) total = result.meta.total;
    items.push(...result.items);

    if (items.length >= maxItems) {
      truncated = items.length > maxItems || Boolean(result.meta.hasMore);
      return { items: items.slice(0, maxItems), total, pagesFetched, truncated };
    }

    if (!result.meta.hasMore || result.items.length === 0) {
      return { items, total, pagesFetched, truncated: false };
    }

    startAfterId = result.meta.startAfterId;
    startAfter = result.meta.startAfter;
    if (!startAfterId && !startAfter && !result.meta.nextPage) {
      // No cursor to continue
      return { items, total, pagesFetched, truncated: false };
    }
  }

  return { items, total, pagesFetched, truncated: true };
}
