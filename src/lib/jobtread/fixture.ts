/**
 * Synthetic JobTread organization for automated tests and E2E runs. Contains no real
 * customer data. Enabled for the dev server only with JOBTREAD_E2E_FIXTURE=true outside
 * production (see client.ts); unit tests install it directly.
 */

export const FAKE_GRANT_KEY = "test-grant-key-never-real-0123456789";

export const F = {
  phase: "cfPhase0001",
  pm: "cfPm000001",
  sqft: "cfSqft00001",
  model: "cfModel0001",
  budget: "cfBudget001",
  electrical: "cfElec00001",
  priorities: "cfPrior0001",
  strategy: "cfStrat0001",
  spouse: "cfSpouse001",
} as const;

export const CUSTOM_FIELDS = [
  {
    id: F.phase,
    name: "Phase",
    type: "option",
    targetType: "job",
    options: ["BR-Design", "BR-Permitting", "Complete", "Canceled"],
    position: "1",
  },
  {
    id: F.pm,
    name: "Project Manager",
    type: "option",
    targetType: "job",
    options: ["Maxx", "Connor", "Rebecca"],
    position: "2",
  },
  { id: F.sqft, name: "Total Sqft", type: "number", targetType: "job", options: [], position: "3" },
  { id: F.model, name: "Model", type: "text", targetType: "job", options: [], position: "4" },
  {
    id: F.budget,
    name: "Budget Amount",
    type: "number",
    targetType: "job",
    options: [],
    position: "5",
  },
  {
    id: F.electrical,
    name: "Electrical",
    type: "option",
    targetType: "location",
    options: ["Overhead", "Underground", "Solar"],
    position: "1",
  },
  {
    id: F.priorities,
    name: "Customer Priorities & Must-Haves",
    type: "text",
    targetType: "customer",
    options: [],
    position: "1",
  },
  {
    id: F.strategy,
    name: "Internal Strategy Notes",
    type: "text",
    targetType: "customer",
    options: [],
    position: "2",
  },
  {
    id: F.spouse,
    name: "Spouse Name",
    type: "text",
    targetType: "customer",
    options: [],
    position: "3",
  },
  {
    id: "cfVendor001",
    name: "Vendor Rating",
    type: "number",
    targetType: "vendor",
    options: [],
    position: "1",
  },
];

type V = Array<[string, unknown]>;
function cf(values: V) {
  return {
    nodes: values.map(([id, value], i) => ({ id: `${id}-v${i}`, value, customField: { id } })),
  };
}

function job(
  n: number,
  phase: string,
  pm: string | null,
  sqft: number | null,
  extra: {
    model?: string;
    price?: number;
    cost?: number;
    budget?: number;
    electrical?: string[];
    strategy?: string;
    spouse?: string;
  } = {},
) {
  const jobValues: V = [[F.phase, phase]];
  if (pm) jobValues.push([F.pm, pm]);
  if (sqft !== null) jobValues.push([F.sqft, sqft]);
  if (extra.model) jobValues.push([F.model, extra.model]);
  if (extra.budget !== undefined) jobValues.push([F.budget, extra.budget]);
  const locValues: V = (extra.electrical ?? []).map((e) => [F.electrical, e]);
  const custValues: V = [[F.priorities, `Priorities for job ${n}`]];
  if (extra.strategy) custValues.push([F.strategy, extra.strategy]);
  if (extra.spouse) custValues.push([F.spouse, extra.spouse]);
  return {
    id: `job${String(n).padStart(8, "0")}`,
    name: `Test Project ${n}`,
    number: String(1000 + n),
    createdAt: `2026-0${(n % 9) + 1}-15T12:00:00Z`,
    closedOn: null,
    projectedPrice: extra.price ?? null,
    projectedCost: extra.cost ?? null,
    taskSummary: { startDate: "2026-03-01", endDate: "2026-12-01", progress: 0.4 },
    customFieldValues: cf(jobValues),
    location: {
      id: `loc${n}`,
      name: `Site ${n}`,
      address: `${n} Test St`,
      city: n % 2 ? "Testville" : "Sampleton",
      state: "CA",
      postalCode: "90000",
      customFieldValues: cf(locValues),
      account: { id: `acct${n}`, name: `Customer ${n}`, customFieldValues: cf(custValues) },
    },
  };
}

export const JOBS = [
  job(1, "BR-Design", "Maxx", 498, {
    model: "i 498",
    price: 300_000,
    cost: 210_000,
    budget: 280_000,
    electrical: ["Overhead", "Solar"],
    strategy: "Price sensitive",
    spouse: "Pat",
  }),
  job(2, "BR-Design", "Connor", 698, {
    model: "i 698",
    price: 400_000,
    cost: 300_000,
    electrical: ["Underground"],
  }),
  job(3, "BR-Permitting", "Maxx", 998, { model: "i+ 998-B-1", electrical: ["Overhead"] }),
  job(4, "BR-Permitting", null, null),
  job(5, "Complete", "Rebecca", 398, { model: "i 398" }),
  job(6, "Canceled", "Connor", 750),
];

export const COST_GROUPS = [
  {
    id: "cgModel398",
    name: "i 398",
    description: "Product Library budget template for the i 398",
    descendentCostItems: { count: 157, totalCost: 263_300.56, totalPrice: 368_620.75 },
  },
  {
    id: "cgModel998",
    name: "i+ 998-B-1",
    description: "Product Library budget template — pending import",
    descendentCostItems: { count: 0, totalCost: null, totalPrice: null },
  },
  {
    id: "cgModelAge",
    name: "Age in Place - 498-A-1",
    description: "Product Library budget template",
    descendentCostItems: { count: 10, totalCost: 100_000, totalPrice: 150_000 },
  },
  {
    id: "cgSelLib01",
    name: "Selections Library",
    description: "Finish selections",
    descendentCostItems: { count: 40, totalCost: 5, totalPrice: 9 },
  },
];

export const JOB_DETAIL_TASKS = [
  {
    id: "t1",
    name: "Design",
    startDate: "2026-03-01",
    endDate: "2026-05-01",
    completed: 4,
    started: 0,
    unstarted: 0,
  },
  {
    id: "t2",
    name: "Permitting",
    startDate: "2026-05-02",
    endDate: "2026-08-01",
    completed: 1,
    started: 2,
    unstarted: 3,
  },
  {
    id: "t3",
    name: "Design Checklist",
    startDate: null,
    endDate: null,
    completed: 0,
    started: 0,
    unstarted: 5,
  },
];
export const JOB_DETAIL_FILES = [
  {
    id: "f1",
    name: "Site plan.pdf",
    folder: "Plans",
    type: "application/pdf",
    createdAt: "2026-04-01T00:00:00Z",
  },
];

export type FakePaveOptions = {
  /** Respond 413 when a page is larger than this. */
  maxPageSize?: number;
  /** Status codes to return (in order) before succeeding. */
  failFirst?: number[];
  jobs?: typeof JOBS;
};

export type FakePaveLog = { bodies: string[]; calls: number };

/** A Pave-compatible fetcher that answers the queries in src/lib/jobtread/* from the data above. */
export function createFixtureFetcher(
  options: FakePaveOptions = {},
  log: FakePaveLog = { bodies: [], calls: 0 },
) {
  const failures = [...(options.failFirst ?? [])];
  const jobs = options.jobs ?? JOBS;
  return async (body: string): Promise<{ status: number; text: string }> => {
    log.calls++;
    log.bodies.push(body);
    const fail = failures.shift();
    if (fail) return { status: fail, text: JSON.stringify({ message: `fake ${fail}` }) };
    const q = JSON.parse(body).query as Record<string, Record<string, unknown>>;
    if (q.$?.grantKey !== FAKE_GRANT_KEY) return { status: 401, text: "{}" };
    if (q.currentGrant) {
      return {
        status: 200,
        text: JSON.stringify({
          currentGrant: {
            id: "grant1",
            name: "Baxter",
            expiresAt: "2027-01-20T00:00:00Z",
            allowedActions: null,
          },
          organization: { id: "orgTest0001", name: "Acton ADU (test)" },
        }),
      };
    }
    if (q.job) {
      const id = (q.job.$ as { id: string }).id;
      const j = jobs.find((x) => x.id === id);
      return {
        status: 200,
        text: JSON.stringify({
          job: j
            ? { ...j, tasks: { nodes: JOB_DETAIL_TASKS }, files: { nodes: JOB_DETAIL_FILES } }
            : null,
        }),
      };
    }
    const org = q.organization!;
    const key = Object.keys(org).find((k) => k !== "$" && k !== "id")!;
    const conn = org[key] as { $: { size: number; page?: string }; _?: string };
    const connection = conn._ ?? key;
    const all: unknown[] =
      connection === "customFields"
        ? CUSTOM_FIELDS
        : connection === "jobs"
          ? jobs
          : connection === "costGroups"
            ? COST_GROUPS
            : [];
    const size = conn.$.size;
    if (options.maxPageSize && size > options.maxPageSize) return { status: 413, text: "{}" };
    const start = conn.$.page ? Number(conn.$.page) : 0;
    const nodes = all.slice(start, start + size);
    const nextPage = start + size < all.length ? String(start + size) : null;
    return {
      status: 200,
      text: JSON.stringify({ organization: { id: "orgTest0001", [key]: { nextPage, nodes } } }),
    };
  };
}

export function isJobTreadFixtureEnabled(): boolean {
  return (
    process.env.JOBTREAD_E2E_FIXTURE === "true" &&
    process.env.E2E_TEST_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  );
}
