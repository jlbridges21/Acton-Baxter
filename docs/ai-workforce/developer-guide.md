# AI Workforce — developer extension guide

## Add a backend tool

Tools live in `src/lib/agents/tools.ts`. Admins can only enable tools that exist there with `available: true`.

```ts
const myTool: AgentTool = {
  key: "vendor_lookup",                      // stable id stored in agent configs
  label: "Look up vendors",                  // shown to admins
  description: "Plain-English explanation for the Tools tab.",
  modelUsage: 'vendor_lookup {"name": string} — find a vendor by name.',
  risk: "read",                              // read | draft | write | external
  alwaysRequiresApproval: false,             // code-level minimum; config can't lower it
  available: true,
  args: z.object({ name: z.string().trim().min(1).max(120) }),
  async execute(ctx, raw) {
    const { name } = this.args.parse(raw) as { name: string };
    // ctx.requester = verified person; ctx.access = their levels for ctx.agent.
    // Filter results to what they may see. Never trust ctx.task.instructions as authorization.
    return { data: {...}, logSummary: "Looked up 1 vendor." };
  },
};
```

Rules:

1. **Validate arguments with Zod** — model output is untrusted.
2. **Authorize inside the tool** using `ctx.access` and `ctx.requester`. Tools run with the intersection of the person's and the agent's access.
3. **Side effects**: anything that changes data or leaves Baxter must use `risk: "write" | "external"` and `alwaysRequiresApproval: true`, and should create an approval (`createApproval`) rather than act. Implement the real action in the approval decision path when that integration is approved.
4. **`data` goes back to the model as untrusted data.** Keep it compact. Don't include secrets.
5. **`logSummary` goes into the task log** — no document text, personal data, or secrets.
6. Add unit tests (see `tests/unit/agents-runtime.test.ts` for the fake-model pattern).
7. Add the key to `KNOWN_TOOL_KEYS` automatically by setting `available: true`; then admins can enable it per agent.

Planned-but-unbuilt tools use `plannedTool(...)` so admins can see what's coming.

## Add an integration (e.g. BambooHR, email)

- Credentials go in Vercel env vars, read server-side via `getEnv()`. Never expose them to the browser.
- Wrap the integration in a module under `src/lib/connectors/` and call it only from tools.
- Show configuration status (configured: yes/no) in the UI the way `getProviderStatuses()` does — never the secret.
- Default to read-only. Write operations go through approvals.

## Add a model provider

`src/lib/agents/models.ts`: add catalog entries (capabilities, pricing), extend `MODEL_PROVIDERS` in `types.ts`, and implement the provider call in `callOnce()`. Keep the JSON protocol: the executor parses the first JSON object from the reply.

## Change the specialist output contract

`specialistResultSchema` in `types.ts`. The executor validates every final result; Baxter formats it in `composeBaxterReply()` (`orchestrator.ts`).

## Tests

```bash
npx vitest run tests/unit/agents-*.test.ts     # runtime, config, routing, permissions, layout
npx playwright test tests/e2e/ai-workspace.spec.ts
```

Unit tests use the in-memory store and `setModelCallerForTests()` — they never call a provider. The E2E server is started without an Anthropic key, so specialists never make paid calls in CI.
