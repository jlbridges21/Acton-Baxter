/**
 * Baxter AI-CEO evaluation set: organization awareness, name disambiguation, delegation, and
 * follow-ups. Each case runs through answerBaxterQuestion — the same path Slack and web use —
 * and is scored from what Baxter actually did (which route it took, whether CRM search ran,
 * which specialist ran), not from the wording alone.
 *
 * Rubric (per turn, pass/fail):
 *   route      — the strategy matches (registry answer / delegation to the named agent /
 *                CRM lookup / clarification question / other pipeline).
 *   noCrm      — when required, no GoHighLevel search was attempted.
 *   includes   — every required phrase appears; excludes — none of the forbidden ones do.
 */

export type ExpectedRoute = "registry" | "delegate" | "crm" | "clarify" | "pipeline";

export type EvalTurnSpec = {
  question: string;
  route: ExpectedRoute;
  agent?: string;
  noCrm?: boolean;
  includes?: string[];
  excludes?: string[];
};

export type OrgEvalCase = {
  id: string;
  category: string;
  channel?: "web" | "slack";
  asEmployee?: boolean;
  turns: EvalTurnSpec[];
};

export const ORG_EVAL_CASES: OrgEvalCase[] = [
  // The real failure.
  {
    id: "who-is-sam",
    category: "agent_awareness",
    turns: [
      {
        question: "Who is Sam?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Sam", "HR"],
      },
    ],
  },
  {
    id: "who-is-sam-slack",
    category: "agent_awareness",
    channel: "slack",
    turns: [
      { question: "Who is Sam?", route: "registry", agent: "sam", noCrm: true, includes: ["Sam"] },
    ],
  },
  {
    id: "what-does-dexter-do",
    category: "agent_awareness",
    turns: [
      {
        question: "What does Dexter do?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Dexter", "Report"],
      },
    ],
  },
  {
    id: "who-reports",
    category: "agent_awareness",
    turns: [
      {
        question: "Who reports to you?",
        route: "registry",
        noCrm: true,
        includes: ["Sam", "Dexter"],
      },
    ],
  },
  {
    id: "which-agents",
    category: "agent_awareness",
    turns: [
      {
        question: "Which agents do you have?",
        route: "registry",
        noCrm: true,
        includes: ["Sam", "Dexter"],
      },
    ],
  },
  {
    id: "which-agent-hr",
    category: "agent_awareness",
    turns: [
      {
        question: "Which agent handles HR?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Sam", "handles"],
        excludes: ["Dexter"],
      },
    ],
  },
  {
    id: "which-agent-reports",
    category: "agent_awareness",
    turns: [
      {
        question: "Which agent is responsible for reporting?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Dexter", "handles"],
        excludes: ["Sam"],
      },
    ],
  },
  {
    id: "what-can-sam-currently-do",
    category: "capability_truth",
    turns: [
      {
        question: "What can Sam currently do?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["working right now"],
      },
    ],
  },
  {
    id: "tools",
    category: "capability_truth",
    turns: [
      {
        question: "What tools do you have?",
        route: "registry",
        noCrm: true,
        includes: ["right now"],
      },
    ],
  },
  {
    id: "can-sam-onboard",
    category: "agent_awareness",
    turns: [
      {
        question: "Can Sam help with onboarding?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Yes"],
      },
    ],
  },
  {
    id: "can-dexter-hr",
    category: "agent_awareness",
    turns: [
      {
        question: "Can Dexter help with employee onboarding?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Sam"],
      },
    ],
  },
  {
    id: "dexter-status",
    category: "status",
    turns: [
      {
        question: "Is Dexter working on anything?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
      },
    ],
  },
  // Name ambiguity / explicit CRM.
  {
    id: "sam-in-ghl",
    category: "disambiguation",
    turns: [
      {
        question: "Who is Sam in GoHighLevel?",
        route: "crm",
        excludes: ["Operations Coordinator"],
      },
    ],
  },
  {
    id: "sam-contact-record",
    category: "disambiguation",
    turns: [
      {
        question: "Show me Sam's contact record",
        route: "crm",
        excludes: ["Operations Coordinator"],
      },
    ],
  },
  // Delegation.
  {
    id: "ask-sam-onboarding",
    category: "delegation",
    turns: [
      {
        question: "Ask Sam to explain our onboarding process.",
        route: "delegate",
        agent: "sam",
        noCrm: true,
      },
    ],
  },
  {
    id: "ask-dexter-dashboard",
    category: "delegation",
    turns: [
      {
        question: "Ask Dexter to build a sales dashboard.",
        route: "delegate",
        agent: "dexter",
        noCrm: true,
      },
    ],
  },
  // Follow-ups.
  {
    id: "pronoun-follow-up",
    category: "follow_up",
    turns: [
      { question: "Who is Sam?", route: "registry", agent: "sam", noCrm: true },
      {
        question: "Can she help with onboarding?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Yes"],
      },
      { question: "Ask her what documents we need.", route: "delegate", agent: "sam", noCrm: true },
    ],
  },
  {
    id: "clarify-after-crm",
    category: "disambiguation",
    turns: [
      { question: "Find the contact Sam Rivera in GoHighLevel", route: "crm" },
      { question: "Who is Sam?", route: "clarify", noCrm: true, includes: ["or a person named"] },
      { question: "The AI agent", route: "registry", agent: "sam", noCrm: true },
    ],
  },
  // Access honesty.
  {
    id: "employee-who-is-sam",
    category: "permissions",
    asEmployee: true,
    turns: [
      {
        question: "Who is Sam?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["doesn't have access"],
      },
    ],
  },
];

/**
 * Held-out set: different wording, written after the main set and not used to tune the
 * interpreter. Reported separately so the main score can't hide overfitting.
 */
export const ORG_EVAL_HELDOUT: OrgEvalCase[] = [
  {
    id: "h-whos-sam",
    category: "heldout",
    turns: [
      { question: "who's sam", route: "registry", agent: "sam", noCrm: true, includes: ["Sam"] },
    ],
  },
  {
    id: "h-tell-me-dexter",
    category: "heldout",
    turns: [
      {
        question: "Tell me about Dexter",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Dexter"],
      },
    ],
  },
  {
    id: "h-sams-job",
    category: "heldout",
    turns: [
      {
        question: "What is Sam's job?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Sam"],
      },
    ],
  },
  {
    id: "h-ai-employees",
    category: "heldout",
    turns: [
      {
        question: "Who are your AI employees?",
        route: "registry",
        noCrm: true,
        includes: ["Sam", "Dexter"],
      },
    ],
  },
  {
    id: "h-introduce",
    category: "heldout",
    turns: [
      {
        question: "Can you introduce me to Dexter?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Dexter"],
      },
    ],
  },
  {
    id: "h-integrations",
    category: "heldout",
    turns: [{ question: "What integrations are connected?", route: "registry", noCrm: true }],
  },
  {
    id: "h-timecards-agent",
    category: "heldout",
    turns: [
      {
        question: "Which agent should I ask about timecards?",
        route: "registry",
        noCrm: true,
        includes: ["Sam"],
      },
    ],
  },
  {
    id: "h-no-agent-fits",
    category: "heldout",
    turns: [
      {
        question: "Which agent handles construction scheduling?",
        route: "registry",
        noCrm: true,
        excludes: ["Sam, our", "Dexter, our"],
      },
    ],
  },
  {
    id: "h-addressed",
    category: "heldout",
    turns: [
      {
        question: "Sam, what documents does a new hire need?",
        route: "delegate",
        agent: "sam",
        noCrm: true,
      },
    ],
  },
  {
    id: "h-have-dexter",
    category: "heldout",
    turns: [
      {
        question: "Have Dexter make a chart of jobs by phase",
        route: "delegate",
        agent: "dexter",
        noCrm: true,
      },
    ],
  },
  {
    id: "h-crm-phone",
    category: "heldout",
    turns: [
      {
        question: "What's the phone number for Sam Johnson?",
        route: "crm",
        excludes: ["Operations Coordinator"],
      },
    ],
  },
  {
    id: "h-unknown-agent",
    category: "heldout",
    turns: [{ question: "Who is Olivia?", route: "crm", excludes: ["Olivia is our AI"] }],
  },
  {
    id: "h-sam-bamboo",
    category: "heldout",
    turns: [
      {
        question: "Is Sam able to look up employee info in BambooHR?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["BambooHR"],
      },
    ],
  },
];

/**
 * Second held-out set, written after the first held-out set had been used to fix the interpreter
 * (so set 1 is no longer independent). Not used for tuning; reported as-is.
 */
export const ORG_EVAL_HELDOUT_2: OrgEvalCase[] = [
  {
    id: "h2-what-is-dexter",
    category: "heldout2",
    turns: [
      {
        question: "what is dexter?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["Dexter"],
      },
    ],
  },
  {
    id: "h2-sam-role",
    category: "heldout2",
    turns: [
      {
        question: "What's Sam's role here?",
        route: "registry",
        agent: "sam",
        noCrm: true,
        includes: ["Sam"],
      },
    ],
  },
  {
    id: "h2-team",
    category: "heldout2",
    turns: [
      {
        question: "Who's on your team?",
        route: "registry",
        noCrm: true,
        includes: ["Sam", "Dexter"],
      },
    ],
  },
  {
    id: "h2-dashboards",
    category: "heldout2",
    turns: [
      {
        question: "Who handles dashboards?",
        route: "registry",
        noCrm: true,
        includes: ["Dexter"],
        excludes: ["Sam, our"],
      },
    ],
  },
  {
    id: "h2-offboarding",
    category: "heldout2",
    turns: [
      {
        question: "Which agent takes care of offboarding?",
        route: "registry",
        noCrm: true,
        includes: ["Sam"],
        excludes: ["Dexter, our"],
      },
    ],
  },
  {
    id: "h2-marketing",
    category: "heldout2",
    turns: [
      {
        question: "Which agent handles social media marketing?",
        route: "registry",
        noCrm: true,
        excludes: ["Sam, our", "Dexter, our"],
      },
    ],
  },
  {
    id: "h2-dexter-hiring",
    category: "heldout2",
    turns: [
      {
        question: "Can Dexter help with hiring?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        excludes: ["Yes —"],
      },
    ],
  },
  {
    id: "h2-loop-in",
    category: "heldout2",
    turns: [
      {
        question: "Loop in Sam on the new hire paperwork for Maria",
        route: "delegate",
        agent: "sam",
        noCrm: true,
      },
    ],
  },
  {
    id: "h2-dexter-addressed",
    category: "heldout2",
    turns: [
      {
        question: "Dexter: how many jobs are in permitting?",
        route: "delegate",
        agent: "dexter",
        noCrm: true,
      },
    ],
  },
  {
    id: "h2-email-sam",
    category: "heldout2",
    turns: [
      {
        question: "What's Sam Patel's email address?",
        route: "crm",
        excludes: ["Operations Coordinator"],
      },
    ],
  },
  {
    id: "h2-ghl-lead",
    category: "heldout2",
    turns: [
      {
        question: "Is Dexter a lead in GHL?",
        route: "crm",
        excludes: ["Data Analytics Specialist"],
      },
    ],
  },
  {
    id: "h2-he-follow-up",
    category: "heldout2",
    turns: [
      { question: "Tell me about Dexter", route: "registry", agent: "dexter", noCrm: true },
      { question: "What is he working on?", route: "registry", agent: "dexter", noCrm: true },
    ],
  },
  {
    id: "h2-dexter-access",
    category: "heldout2",
    turns: [
      {
        question: "Does Dexter have access to JobTread right now?",
        route: "registry",
        agent: "dexter",
        noCrm: true,
        includes: ["JobTread"],
      },
    ],
  },
];

export type TurnObservation = {
  answer: string;
  delegatedTo: string | null;
  crmCalls: number;
  routingStrategy: string | null;
  answerMode: string | null;
};

export type TurnScore = {
  question: string;
  expected: ExpectedRoute;
  actual: ExpectedRoute;
  pass: boolean;
  failures: string[];
};

/** What Baxter actually did on a turn, from observable behaviour (works on old and new code). */
export function observedRoute(o: TurnObservation, spec: EvalTurnSpec): ExpectedRoute {
  if (o.delegatedTo) return "delegate";
  if (o.routingStrategy === "clarify" || /\bDo you mean\b.*\bor\b/i.test(o.answer))
    return "clarify";
  if (o.routingStrategy === "registry") return "registry";
  if (o.crmCalls > 0) return "crm";
  // Old code had no registry route: credit an agent-profile answer only if it names the agent's role.
  if (
    spec.route === "registry" &&
    spec.includes?.every((p) => plain(o.answer).includes(plain(p))) &&
    o.crmCalls === 0
  )
    return "registry";
  return "pipeline";
}

/** Lowercase with Slack / Markdown emphasis removed, so "**Sam**, our" matches "Sam, our". */
const plain = (s: string) => s.replace(/[*_`]/g, "").toLowerCase();

export function scoreTurn(spec: EvalTurnSpec, o: TurnObservation): TurnScore {
  const actual = observedRoute(o, spec);
  const failures: string[] = [];
  if (actual !== spec.route) failures.push(`route: expected ${spec.route}, got ${actual}`);
  if (spec.route === "delegate" && spec.agent && o.delegatedTo !== spec.agent)
    failures.push(`delegated to ${o.delegatedTo ?? "nobody"}, expected ${spec.agent}`);
  if (spec.noCrm && o.crmCalls > 0) failures.push(`searched GoHighLevel ${o.crmCalls} time(s)`);
  for (const p of spec.includes ?? [])
    if (!plain(o.answer).includes(plain(p))) failures.push(`missing "${p}"`);
  for (const p of spec.excludes ?? [])
    if (plain(o.answer).includes(plain(p))) failures.push(`should not contain "${p}"`);
  return {
    question: spec.question,
    expected: spec.route,
    actual,
    pass: failures.length === 0,
    failures,
  };
}

export function summarize(results: Array<{ id: string; category: string; turns: TurnScore[] }>) {
  const turns = results.flatMap((r) => r.turns);
  const byCategory: Record<string, { pass: number; total: number }> = {};
  for (const r of results)
    for (const t of r.turns) {
      const c = (byCategory[r.category] ??= { pass: 0, total: 0 });
      c.total++;
      if (t.pass) c.pass++;
    }
  return {
    turns: turns.length,
    passed: turns.filter((t) => t.pass).length,
    casesPassed: results.filter((r) => r.turns.every((t) => t.pass)).length,
    cases: results.length,
    unnecessaryCrmSearches: turns.filter((t) =>
      t.failures.some((f) => f.startsWith("searched GoHighLevel")),
    ).length,
    byCategory,
  };
}
