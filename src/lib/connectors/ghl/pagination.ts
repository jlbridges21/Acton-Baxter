/**
 * Reusable pagination helpers for GHL list/search endpoints.
 *
 * Incomplete/truncated results are never silently presented as complete.
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

/** Hard safety ceiling — hit = incomplete, never silent truncate-as-complete. */
export const GHL_PAGINATION_HARD_MAX_PAGES = 100;
export const GHL_PAGINATION_HARD_MAX_ITEMS = 10_000;

export type PaginateOptions<T> = {
  /** Max pages to fetch. Default 5. Capped by hard max. */
  maxPages?: number;
  /** Max total items. Default 200. Capped by hard max. */
  maxItems?: number;
  fetchPage: (cursor: {
    page: number;
    startAfterId: string | null;
    startAfter: string | number | null;
  }) => Promise<{ items: T[]; meta: GhlPageMeta }>;
};

export type PaginateResult<T> = {
  items: T[];
  total: number | null;
  pagesFetched: number;
  /** True when more data may exist beyond what was fetched. */
  truncated: boolean;
  /** Alias for truncated — monitoring/UI should treat this as incomplete coverage. */
  incomplete: boolean;
  incompleteReason: string | null;
};

/**
 * Fetch multiple pages until exhausted or caps hit.
 * Never infinite — always bounded.
 * When truncated/incomplete, callers MUST NOT claim a clean complete dataset.
 */
export async function paginateGhl<T>(options: PaginateOptions<T>): Promise<PaginateResult<T>> {
  const maxPages = Math.min(options.maxPages ?? 5, GHL_PAGINATION_HARD_MAX_PAGES);
  const maxItems = Math.min(options.maxItems ?? 200, GHL_PAGINATION_HARD_MAX_ITEMS);
  const items: T[] = [];
  let pagesFetched = 0;
  let total: number | null = null;
  let startAfterId: string | null = null;
  let startAfter: string | number | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const result = await options.fetchPage({ page, startAfterId, startAfter });
    pagesFetched += 1;
    if (result.meta.total != null) total = result.meta.total;
    items.push(...result.items);

    if (items.length >= maxItems) {
      const incomplete = items.length > maxItems || Boolean(result.meta.hasMore);
      const sliced = items.slice(0, maxItems);
      return {
        items: sliced,
        total,
        pagesFetched,
        truncated: incomplete,
        incomplete,
        incompleteReason: incomplete
          ? `Reached item safety ceiling (${maxItems})${result.meta.hasMore ? " with more pages available" : ""}`
          : null,
      };
    }

    if (!result.meta.hasMore || result.items.length === 0) {
      return {
        items,
        total,
        pagesFetched,
        truncated: false,
        incomplete: false,
        incompleteReason: null,
      };
    }

    startAfterId = result.meta.startAfterId;
    startAfter = result.meta.startAfter;
    if (!startAfterId && !startAfter && !result.meta.nextPage) {
      return {
        items,
        total,
        pagesFetched,
        truncated: false,
        incomplete: false,
        incompleteReason: null,
      };
    }
  }

  return {
    items,
    total,
    pagesFetched,
    truncated: true,
    incomplete: true,
    incompleteReason: `Reached page safety ceiling (${maxPages}) with more data available`,
  };
}
