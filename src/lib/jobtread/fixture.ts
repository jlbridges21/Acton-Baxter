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
  salesRep: "cfSalesRep01",
} as const;

export const CUSTOM_FIELDS = [
  {
    id: F.salesRep,
    name: "Sales Rep",
    type: "option",
    targetType: "job",
    options: ["Kevin", "Connor", "Jesse"],
    position: "0",
  },
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
    salesRep?: string;
  } = {},
) {
  const jobValues: V = [[F.phase, phase]];
  if (pm) jobValues.push([F.pm, pm]);
  if (sqft !== null) jobValues.push([F.sqft, sqft]);
  if (extra.model) jobValues.push([F.model, extra.model]);
  if (extra.budget !== undefined) jobValues.push([F.budget, extra.budget]);
  if (extra.salesRep) jobValues.push([F.salesRep, extra.salesRep]);
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
  job(3, "BR-Permitting", "Maxx", 998, {
    model: "i+ 998-B-1",
    electrical: ["Overhead"],
    salesRep: "Jesse",
  }),
  job(4, "BR-Permitting", null, null),
  job(5, "Complete", "Rebecca", 398, { model: "i 398", salesRep: "Kevin" }),
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

/** Customer orders and invoices (synthetic). Job 1: approved order; job 2: draft; job 4: loss. */
export const DOCUMENTS = [
  {
    id: "docOrder001",
    type: "customerOrder",
    status: "approved",
    number: "1",
    name: "Contract",
    issueDate: "2026-04-01",
    dueDate: null,
    signedAt: null,
    createdAt: "2026-04-01T00:00:00Z",
    price: 300000,
    cost: 210000,
    tax: 0,
    amountPaid: 0,
    balance: 300000,
    job: { id: "job00000001" },
  },
  {
    id: "docOrder002",
    type: "customerOrder",
    status: "draft",
    number: "2",
    name: "Estimate",
    issueDate: "2026-05-01",
    dueDate: null,
    signedAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    price: 400000,
    cost: 300000,
    tax: 0,
    amountPaid: 0,
    balance: 400000,
    job: { id: "job00000002" },
  },
  {
    id: "docOrder003",
    type: "customerOrder",
    status: "draft",
    number: "3",
    name: "Old estimate",
    issueDate: "2026-03-01",
    dueDate: null,
    signedAt: null,
    createdAt: "2026-03-01T00:00:00Z",
    price: 380000,
    cost: 300000,
    tax: 0,
    amountPaid: 0,
    balance: 380000,
    job: { id: "job00000002" },
  },
  {
    id: "docOrder004",
    type: "customerOrder",
    status: "draft",
    number: "4",
    name: "Estimate",
    issueDate: "2026-06-01",
    dueDate: null,
    signedAt: null,
    createdAt: "2026-06-01T00:00:00Z",
    price: 200000,
    cost: 215000,
    tax: 0,
    amountPaid: 0,
    balance: 200000,
    job: { id: "job00000004" },
  },
  {
    id: "docInv0001",
    type: "customerInvoice",
    status: "draft",
    number: "5",
    name: "Deposit",
    issueDate: "2026-04-15",
    dueDate: "2026-05-15",
    signedAt: null,
    createdAt: "2026-04-15T00:00:00Z",
    price: 30000,
    cost: 0,
    tax: 0,
    amountPaid: 0,
    balance: 30000,
    job: { id: "job00000001" },
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

/**
 * Cost items: catalog lines under two Product Library models plus job budget lines. Every
 * 7th line has no unit price, so tests can prove blanks are never filled in.
 */
/**
 * Catalog group hierarchy below the Product Library models (mirrors Acton's real structure:
 * model → "Exterior Package Options" → style → items), plus job budget groups.
 */
export const CHILD_COST_GROUPS = [
  { id: "cgExt398", name: "Exterior Package Options", parent: "cgModel398", job: null },
  { id: "cgHay398", name: "Hayward Modern", parent: "cgExt398", job: null },
  { id: "cgHmb398", name: "Half Moon Bay Coastal", parent: "cgExt398", job: null },
  { id: "cgWin398", name: "Windows", parent: "cgModel398", job: null },
  { id: "cgExtAge", name: "Exterior Package Options", parent: "cgModelAge", job: null },
  { id: "cgHayAge", name: "Hayward Modern", parent: "cgExtAge", job: null },
  { id: "cgJob1", name: "Budget", parent: null, job: "job00000001" },
  { id: "cgJob2", name: "Budget", parent: null, job: "job00000002" },
  { id: "cgJob3", name: "Budget", parent: null, job: "job00000003" },
];

const ITEM_GROUP: Array<[number, string]> = [
  [4, "cgHay398"],
  [6, "cgHmb398"],
  [10, "cgWin398"],
  [20, "cgModel398"],
  [23, "cgHayAge"],
  [40, "cgModelAge"],
];
const groupFor = (i: number) => ITEM_GROUP.find(([end]) => i < end)?.[1] ?? null;
const groupName = (id: string) =>
  CHILD_COST_GROUPS.find((g) => g.id === id)?.name ??
  (id === "cgModel398" ? "i 398" : id === "cgModelAge" ? "Age in Place - 498-A-1" : id);

/**
 * Cost items: catalog lines under two Product Library models (some inside exterior options)
 * plus job budget lines. Every 7th line has no unit price, so tests can prove blanks are
 * never filled in.
 */
export const COST_ITEMS = Array.from({ length: 230 }, (_, i) => {
  const catalog = i < 40;
  const priced = i % 7 !== 3;
  const quantity = (i % 5) + 1;
  const unitCost = 100 + i;
  const group = catalog ? groupFor(i)! : `cgJob${(i % 3) + 1}`;
  return {
    id: `ci${String(i).padStart(6, "0")}`,
    name: `Line ${i}`,
    description: null,
    quantity,
    unitCost,
    unitPrice: priced ? unitCost * 1.4 : null,
    cost: quantity * unitCost,
    price: priced ? quantity * unitCost * 1.4 : null,
    isSelected: true,
    createdAt: "2026-05-01T00:00:00Z",
    costGroup: { id: group, name: catalog ? groupName(group) : "Budget" },
    job: catalog ? null : { id: `job0000000${(i % 3) + 1}` },
    costCode: { id: `cc${i % 4}`, name: ["Design", "Permits", "Foundation", "Framing"][i % 4] },
    costType: { id: `ct${i % 2}`, name: i % 2 ? "Labor" : "Materials" },
    unit: { id: "u1", name: "Each" },
    organizationCostItem: i < 10 ? { id: `org${i}` } : null,
    isTaxable: false,
  };
});

export const TASKS = JOBS.flatMap((j, n) =>
  JOB_DETAIL_TASKS.map((t) => ({
    id: `${t.id}-${n}`,
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    progress: t.completed ? 1 : 0.5,
    completed: t.completed,
    isGroup: !t.name.includes("Checklist"),
    isToDo: t.name.includes("Checklist"),
    createdAt: "2026-03-01T00:00:00Z",
    job: { id: j.id },
  })),
);

export const ACCOUNTS = [
  ...JOBS.map((j) => ({
    id: j.location.account.id,
    name: j.location.account.name,
    type: "customer",
    createdAt: "2026-02-01T00:00:00Z",
    customFieldValues: j.location.account.customFieldValues,
  })),
  {
    id: "acctVendor1",
    name: "Test Lumber Co",
    type: "vendor",
    createdAt: "2026-01-01T00:00:00Z",
    customFieldValues: cf([["cfVendor001", 4]]),
  },
];

export const MEMBERSHIPS = [
  {
    id: "mem1",
    createdAt: "2026-01-01T00:00:00Z",
    user: { id: "u1", name: "Pat Planner" },
    role: { id: "r1", name: "Admin" },
  },
  {
    id: "mem2",
    createdAt: "2026-01-01T00:00:00Z",
    user: { id: "u2", name: "Sam Site" },
    role: { id: "r2", name: "Field" },
  },
];

export const CONTACTS = JOBS.map((j, n) => ({
  id: `contact${n + 1}`,
  name: `Contact ${n + 1}`,
  title: "Homeowner",
  createdAt: "2026-02-01T00:00:00Z",
  account: { id: j.location.account.id },
  customFieldValues: { nodes: [] },
}));

export const DAILY_LOGS = [
  {
    id: "dl1",
    date: "2026-06-01",
    notes: "Site walk",
    createdAt: "2026-06-01T00:00:00Z",
    job: { id: "job00000001" },
    user: { id: "u2" },
  },
];

export const FILES = JOB_DETAIL_FILES.map((f) => ({
  ...f,
  size: 1024,
  job: { id: "job00000001" },
}));

export type FakePaveOptions = {
  /** Respond 413 when a page is larger than this. */
  maxPageSize?: number;
  /** Status codes to return (in order) before succeeding. */
  failFirst?: number[];
  jobs?: typeof JOBS;
  /** Fields that answer `The field "x" does not exist` (as JobTread does for unknown fields). */
  missingFields?: string[];
  /** Fail requests for this connection once the given offset is reached (status code). */
  failAt?: { connection: string; offset: number; status: number; times?: number };
  /** Replace a connection's records (e.g. to simulate deletions or an empty response). */
  records?: Record<string, Array<Record<string, unknown>>>;
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
    const conn = org[key] as {
      $?: { size?: number; page?: string; where?: unknown };
      _?: string;
      count?: unknown;
      nodes?: unknown;
    };
    const connection = conn._ ?? key;
    const missing = (options.missingFields ?? []).find(
      (f) => conn.nodes && f in (conn.nodes as Record<string, unknown>),
    );
    if (missing)
      return {
        status: 400,
        text: JSON.stringify({ message: `The field "${missing}" does not exist` }),
      };
    const offset = conn.$?.page ? Number(conn.$.page) : 0;
    const failAt = options.failAt;
    if (
      failAt &&
      failAt.connection === connection &&
      offset >= failAt.offset &&
      (failAt.times ?? Infinity) > 0
    ) {
      failAt.times = (failAt.times ?? Infinity) - 1;
      return { status: failAt.status, text: JSON.stringify({ message: `fake ${failAt.status}` }) };
    }
    const all: Array<Record<string, unknown>> =
      options.records?.[connection] ??
      (connection === "customFields"
        ? CUSTOM_FIELDS
        : connection === "jobs"
          ? jobs
          : connection === "costGroups"
            ? // The Product Library query filters to top-level catalog groups; the cost_groups
              // dataset reads the whole hierarchy.
              conn.$?.where
              ? COST_GROUPS
              : ALL_COST_GROUPS
            : connection === "documents"
              ? DOCUMENTS
              : (EXTRA_CONNECTIONS[connection] ?? []));
    if (conn.count && !conn.nodes) {
      // `where: [[field], "!=", null]` → populated count; no filter → total.
      const where = conn.$?.where as [string[], string, unknown] | undefined;
      const n = where
        ? all.filter((r) => r[where[0][0]!] !== null && r[where[0][0]!] !== undefined).length
        : all.length;
      return {
        status: 200,
        text: JSON.stringify({ organization: { id: "orgTest0001", [key]: { count: n } } }),
      };
    }
    const size = conn.$?.size ?? 20;
    if (options.maxPageSize && size > options.maxPageSize) return { status: 413, text: "{}" };
    const start = offset;
    const nodes = all.slice(start, start + size);
    const nextPage = start + size < all.length ? String(start + size) : null;
    return {
      status: 200,
      text: JSON.stringify({ organization: { id: "orgTest0001", [key]: { nextPage, nodes } } }),
    };
  };
}

const ALL_COST_GROUPS: Array<Record<string, unknown>> = [
  ...COST_GROUPS.map((g) => ({ ...g, parentCostGroup: null, job: null, quantity: null })),
  ...CHILD_COST_GROUPS.map((g) => ({
    id: g.id,
    name: g.name,
    description: null,
    quantity: null,
    parentCostGroup: g.parent ? { id: g.parent } : null,
    job: g.job ? { id: g.job } : null,
  })),
];

const EXTRA_CONNECTIONS: Record<string, Array<Record<string, unknown>>> = {
  costItems: COST_ITEMS,
  tasks: TASKS,
  accounts: ACCOUNTS,
  memberships: MEMBERSHIPS,
  contacts: CONTACTS,
  dailyLogs: DAILY_LOGS,
  files: FILES,
  payments: [],
  timeEntries: [],
};

export function isJobTreadFixtureEnabled(): boolean {
  return (
    process.env.JOBTREAD_E2E_FIXTURE === "true" &&
    process.env.E2E_TEST_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  );
}
