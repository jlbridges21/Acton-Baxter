"use client";

import { useState } from "react";
import { CheckCircle2, FlaskConical, Lock, PlayCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { findInstructionPolicyIssues } from "@/lib/agents/security-policy";
import { INSTRUCTION_SECTIONS, type ModelProvider } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import { ListEditor } from "./list-editor";
import type { ConfigEditor, StudioData } from "./studio-types";
import { Field, Notice, Pill, aiFetch, errorMessage, selectClass, textareaClass } from "./ui";

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export function InstructionsSection({ editor, data }: { editor: ConfigEditor; data: StudioData }) {
  const issues = findInstructionPolicyIssues(editor.config.instructions);
  const isOrchestrator = data.agent.kind === "orchestrator";
  return (
    <div className="space-y-6">
      {isOrchestrator ? (
        <Notice>
          These instructions shape how Baxter acts as AI CEO — when to delegate and how to report
          results. Baxter&apos;s everyday answers also follow the Baxter governance rules managed in
          Admin → Baxter → Governance.
        </Notice>
      ) : null}
      <Card>
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--acton-muted)]" aria-hidden />
          <div>
            <CardTitle>Protected security rules</CardTitle>
            <CardDescription>
              Set by engineering and always applied first. Business instructions below can&apos;t
              override them, and the platform enforces permissions and approvals in code regardless
              of wording.
            </CardDescription>
            {data.protectedRules ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--acton-navy)]">
                  Show the rules
                </summary>
                <pre className="mt-2 rounded-md bg-[var(--acton-gray-50)] p-3 text-xs whitespace-pre-wrap text-[var(--acton-navy)]">
                  {data.protectedRules}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      </Card>
      {issues.length ? (
        <Notice tone="warning">
          <p className="font-semibold">These instructions can&apos;t be published as written:</p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(issues.map((i) => i.reason))].map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        {INSTRUCTION_SECTIONS.filter((s) =>
          isOrchestrator ? true : s.key !== "delegationGuidelines",
        ).map((section) => (
          <Field
            key={section.key}
            label={section.label}
            help={section.help}
            htmlFor={`ins-${section.key}`}
          >
            <textarea
              id={`ins-${section.key}`}
              rows={section.key === "responsibilities" || section.key === "rules" ? 7 : 4}
              className={cn(
                textareaClass,
                issues.some((i) => i.section === section.key) && "border-amber-400",
              )}
              value={editor.config.instructions[section.key]}
              readOnly={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  c.instructions[section.key] = e.target.value;
                })
              }
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export function ModelSection({ editor, data }: { editor: ConfigEditor; data: StudioData }) {
  const m = editor.config.model;
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const catalog = data.models.filter((x) => x.provider === m.provider);
  const known = catalog.find((x) => x.id === m.model);
  const providerStatus = data.providers.find((p) => p.provider === m.provider);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await aiFetch<{ result: { ok: boolean; message: string } }>("/api/ai/providers", {
        method: "POST",
        body: JSON.stringify({ provider: m.provider, model: m.model }),
      });
      setTestResult(res.result);
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>AI providers on this deployment</CardTitle>
        <CardDescription>
          API keys stay on the server. This only shows whether each provider is set up.
        </CardDescription>
        <ul className="mt-3 flex flex-wrap gap-2">
          {data.providers.map((p) => (
            <li key={p.provider}>
              <Pill
                className={
                  p.configured ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-800"
                }
              >
                {p.configured ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {p.label}: {p.configured ? "configured" : "not configured"}
              </Pill>
            </li>
          ))}
        </ul>
      </Card>

      {data.agent.kind === "orchestrator" ? (
        <Field
          label="Where Baxter's model comes from"
          help="Keep the deployment's current setup (recommended), or choose one here."
        >
          <select
            className={selectClass}
            value={m.source}
            disabled={editor.readOnly}
            onChange={(e) =>
              editor.update((c) => {
                c.model.source = e.target.value as "environment" | "custom";
              })
            }
          >
            <option value="environment">Deployment default (current Baxter setup)</option>
            <option value="custom">Choose a model here</option>
          </select>
        </Field>
      ) : null}

      {m.source === "environment" ? (
        <Notice>
          Baxter uses the model configured for the deployment (BAXTER_LLM_PROVIDER /
          BAXTER_CHAT_MODEL). This setting also powers Baxter&apos;s routing decisions.
        </Notice>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Provider">
            <select
              className={selectClass}
              value={m.provider}
              disabled={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  const provider = e.target.value as ModelProvider;
                  c.model.provider = provider;
                  c.model.model =
                    data.models.find((x) => x.provider === provider)?.id ?? c.model.model;
                })
              }
            >
              {data.providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                  {p.configured ? "" : " (not configured)"}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Model"
            help={known?.note ?? "Pick from the list, or choose Other to enter a model ID."}
          >
            <select
              className={selectClass}
              value={known ? m.model : "__other"}
              disabled={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  if (e.target.value !== "__other") c.model.model = e.target.value;
                })
              }
            >
              {catalog.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} — {x.tier}
                  {x.pricing
                    ? ` (~$${x.pricing.input}/$${x.pricing.output} per 1M tokens${x.pricing.estimated ? ", est." : ""})`
                    : ""}
                </option>
              ))}
              <option value="__other">Other model ID…</option>
            </select>
            {!known ? (
              <Input
                className="mt-2"
                value={m.model}
                readOnly={editor.readOnly}
                aria-label="Model ID"
                onChange={(e) =>
                  editor.update((c) => {
                    c.model.model = e.target.value.trim();
                  })
                }
              />
            ) : null}
          </Field>
          <Field
            label="Thinking effort"
            help={
              known && !known.supportsEffort
                ? "This model doesn't support an effort setting; it will be ignored."
                : "Higher effort is more thorough but slower and costs more."
            }
          >
            <select
              className={selectClass}
              value={m.effort ?? "none"}
              disabled={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  c.model.effort =
                    e.target.value === "none"
                      ? null
                      : (e.target.value as "low" | "medium" | "high");
                })
              }
            >
              <option value="low">Low (fast, recommended)</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="none">Model default</option>
            </select>
          </Field>
          <Field
            label="Maximum response length"
            help="Upper limit on tokens per model reply (512 – 32,000)."
          >
            <Input
              type="number"
              min={512}
              max={32000}
              step={256}
              value={m.maxOutputTokens}
              readOnly={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  c.model.maxOutputTokens = Number(e.target.value) || 4000;
                })
              }
            />
          </Field>
          <Field
            label="Backup model (optional)"
            help="Used only when the main provider has a temporary outage. Leave as None to show an error instead."
          >
            <select
              className={selectClass}
              disabled={editor.readOnly}
              value={m.fallback ? `${m.fallback.provider}:${m.fallback.model}` : ""}
              onChange={(e) =>
                editor.update((c) => {
                  if (!e.target.value) c.model.fallback = null;
                  else {
                    const [provider, ...rest] = e.target.value.split(":");
                    c.model.fallback = {
                      provider: provider as ModelProvider,
                      model: rest.join(":"),
                    };
                  }
                })
              }
            >
              <option value="">None</option>
              {data.models
                .filter((x) => !(x.provider === m.provider && x.id === m.model))
                .map((x) => (
                  <option key={`${x.provider}:${x.id}`} value={`${x.provider}:${x.id}`}>
                    {x.label} ({x.provider})
                  </option>
                ))}
            </select>
          </Field>
          <div className="space-y-2 self-end">
            {data.isAdmin ? (
              <Button type="button" variant="secondary" onClick={testConnection} disabled={testing}>
                <PlayCircle className="h-4 w-4" /> {testing ? "Testing…" : "Test connection"}
              </Button>
            ) : null}
            {testResult ? (
              <Notice tone={testResult.ok ? "success" : "error"}>{testResult.message}</Notice>
            ) : null}
            {providerStatus && !providerStatus.configured ? (
              <Notice tone="warning">
                This provider isn&apos;t configured. The agent will report an error rather than
                switch providers.
              </Notice>
            ) : null}
          </div>
        </div>
      )}

      <Card>
        <CardTitle>Safety limits</CardTitle>
        <CardDescription>
          Hard limits enforced on every assignment. The agent stops and reports when it hits one.
        </CardDescription>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["maxIterations", "Max reasoning steps", 1, 8, 1],
              ["maxToolCalls", "Max tool uses", 0, 12, 1],
              ["timeoutMs", "Time limit (seconds)", 5, 240, 5],
              ["maxTotalTokens", "Token budget per task", 2000, 400000, 1000],
              ["maxCostUsd", "Cost budget per task (USD)", 0.01, 10, 0.05],
            ] as const
          ).map(([key, label, min, max, step]) => {
            const raw = editor.config.limits[key];
            const shown = key === "timeoutMs" ? raw / 1000 : raw;
            return (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={shown}
                  readOnly={editor.readOnly}
                  onChange={(e) =>
                    editor.update((c) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v))
                        c.limits[key] = key === "timeoutMs" ? Math.round(v * 1000) : v;
                    })
                  }
                />
              </Field>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegation (+ tester and regression suite)
// ---------------------------------------------------------------------------

type RoutingResult = {
  question: string;
  expected: string | null;
  actual: string;
  passed: boolean | null;
  method: string;
  explanation: string;
  aiUsed: boolean;
  authorization: { allowed: boolean; reason: string } | null;
};

export function DelegationTester({
  defaultExpected,
  useDraftFor,
}: {
  defaultExpected: string | null;
  useDraftFor: string | null;
}) {
  const [question, setQuestion] = useState("Help me onboard a new employee.");
  const [expected, setExpected] = useState<string>(defaultExpected ?? "");
  const [simulateRole, setSimulateRole] = useState<"user" | "admin">("user");
  const [useAi, setUseAi] = useState(true);
  const [result, setResult] = useState<RoutingResult | null>(null);
  const [regression, setRegression] = useState<{
    total: number;
    passed: number;
    results: RoutingResult[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy("test");
    setError(null);
    try {
      const res = await aiFetch<{ result: RoutingResult }>("/api/ai/routing/test", {
        method: "POST",
        body: JSON.stringify({
          question,
          expectedSlug: expected || null,
          useAi,
          simulateRole,
          useDraftFor,
        }),
      });
      setResult(res.result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runRegression() {
    setBusy("regression");
    setError(null);
    try {
      const res = await aiFetch<{
        report: { total: number; passed: number; results: RoutingResult[] };
      }>("/api/ai/routing/regression", {
        method: "POST",
        body: JSON.stringify({ useAi: false, useDraftFor }),
      });
      setRegression(res.report);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 text-[var(--acton-muted)]" aria-hidden />
        <div className="flex-1 space-y-4">
          <div>
            <CardTitle>Delegation tester</CardTitle>
            <CardDescription>
              Type a request and see who Baxter would hand it to — and whether the person asking
              would be allowed.
              {useDraftFor
                ? " Uses your unsaved draft's delegation settings if a draft is saved."
                : ""}
            </CardDescription>
          </div>
          <Field label="Request">
            <textarea
              className={textareaClass}
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Expected agent">
              <Input
                value={expected}
                onChange={(e) => setExpected(e.target.value.trim().toLowerCase())}
                placeholder="e.g. sam or baxter"
              />
            </Field>
            <Field label="Check access as">
              <select
                className={selectClass}
                value={simulateRole}
                onChange={(e) => setSimulateRole(e.target.value as "user" | "admin")}
              >
                <option value="user">A typical employee</option>
                <option value="admin">An administrator</option>
              </select>
            </Field>
            <Field label="Router">
              <select
                className={selectClass}
                value={useAi ? "ai" : "rules"}
                onChange={(e) => setUseAi(e.target.value === "ai")}
              >
                <option value="ai">Full (rules + AI, small cost)</option>
                <option value="rules">Rules only (free)</option>
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={run} disabled={busy !== null || !question.trim()}>
              {busy === "test" ? "Testing…" : "Test routing"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={runRegression}
              disabled={busy !== null}
            >
              {busy === "regression" ? "Running…" : "Run all example checks"}
            </Button>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {result ? (
            <dl className="grid gap-2 rounded-md border border-[var(--acton-border)] p-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[var(--acton-muted)]">Expected agent</dt>
                <dd className="font-semibold">{result.expected ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--acton-muted)]">Actual agent selected</dt>
                <dd className="flex items-center gap-2 font-semibold">
                  {result.actual}
                  {result.passed === true ? (
                    <Pill className="bg-emerald-100 text-emerald-900">Match</Pill>
                  ) : null}
                  {result.passed === false ? (
                    <Pill className="bg-red-100 text-red-800">Mismatch</Pill>
                  ) : null}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--acton-muted)]">
                  Why ({result.method}
                  {result.aiUsed ? ", AI router used" : ""})
                </dt>
                <dd>{result.explanation}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--acton-muted)]">Authorization</dt>
                <dd>
                  {result.authorization
                    ? result.authorization.reason
                    : "Baxter handles this itself — no specialist access needed."}
                </dd>
              </div>
            </dl>
          ) : null}
          {regression ? (
            <div className="space-y-2">
              <Notice tone={regression.passed === regression.total ? "success" : "warning"}>
                {regression.passed} of {regression.total} example requests routed as expected (rules
                only).
              </Notice>
              {regression.results.some((r) => !r.passed) ? (
                <ul className="space-y-1 text-sm">
                  {regression.results
                    .filter((r) => !r.passed)
                    .map((r) => (
                      <li
                        key={r.question}
                        className="rounded border border-red-200 bg-red-50 px-2 py-1"
                      >
                        “{r.question}” → expected <b>{r.expected}</b>, got <b>{r.actual}</b>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function DelegationSection({ editor, data }: { editor: ConfigEditor; data: StudioData }) {
  const d = editor.config.delegation;
  if (data.agent.kind === "orchestrator") {
    const o = editor.config.orchestration;
    return (
      <div className="space-y-6">
        <Card className="space-y-4">
          <CardTitle>Baxter&apos;s delegation</CardTitle>
          <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
            <input
              type="checkbox"
              checked={o.delegationEnabled}
              disabled={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  c.orchestration.delegationEnabled = e.target.checked;
                })
              }
            />
            Let Baxter hand requests to specialist agents
          </label>
          <Field
            label="How Baxter decides"
            help="Rules only never calls an AI model to route (cheapest); Rules + AI handles borderline requests better."
          >
            <select
              className={selectClass}
              value={o.routerMode}
              disabled={editor.readOnly}
              onChange={(e) =>
                editor.update((c) => {
                  c.orchestration.routerMode = e.target.value as "hybrid" | "rules";
                })
              }
            >
              <option value="hybrid">Rules + AI for borderline requests (recommended)</option>
              <option value="rules">Rules only</option>
            </select>
          </Field>
          <p className="text-sm text-[var(--acton-muted)]">
            Each specialist&apos;s own Delegation tab defines what it handles. Routing never grants
            access — Baxter checks the employee&apos;s permissions before any hand-off.
          </p>
        </Card>
        <DelegationTester defaultExpected={null} useDraftFor={null} />
      </div>
    );
  }
  const set = <K extends keyof typeof d>(key: K, value: (typeof d)[K]) =>
    editor.update((c) => {
      c.delegation[key] = value;
    });
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--acton-navy)]">
          <input
            type="checkbox"
            checked={d.acceptsDelegation}
            disabled={editor.readOnly}
            onChange={(e) => set("acceptsDelegation", e.target.checked)}
          />
          Baxter may hand requests to {data.agent.name}
        </label>
        <Field
          label="What this agent specializes in"
          help="One or two sentences Baxter reads when deciding."
        >
          <textarea
            className={textareaClass}
            rows={3}
            value={d.specialization}
            readOnly={editor.readOnly}
            onChange={(e) => set("specialization", e.target.value)}
          />
        </Field>
        <Field label="Delegate when…" help="Describe the kinds of requests that belong here.">
          <textarea
            className={textareaClass}
            rows={3}
            value={d.eligibilityCriteria}
            readOnly={editor.readOnly}
            onChange={(e) => set("eligibilityCriteria", e.target.value)}
          />
        </Field>
        <Field label="Escalation rules" help="What must always go to a person.">
          <textarea
            className={textareaClass}
            rows={2}
            value={d.escalationRules}
            readOnly={editor.readOnly}
            onChange={(e) => set("escalationRules", e.target.value)}
          />
        </Field>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>Example requests to hand over</CardTitle>
          <CardDescription>
            Real phrasing employees use. These also become automatic routing checks.
          </CardDescription>
          <ListEditor
            label="Positive examples"
            items={d.positiveExamples}
            readOnly={editor.readOnly}
            onChange={(v) => set("positiveExamples", v)}
            placeholder="e.g. What forms does a new hire sign?"
          />
        </Card>
        <Card className="space-y-3">
          <CardTitle>Requests that are NOT for this agent</CardTitle>
          <CardDescription>Similar-sounding requests Baxter should keep.</CardDescription>
          <ListEditor
            label="Negative examples"
            items={d.negativeExamples}
            readOnly={editor.readOnly}
            onChange={(v) => set("negativeExamples", v)}
            placeholder="e.g. Onboard this customer into the CRM"
          />
        </Card>
        <Card className="space-y-3">
          <CardTitle>Supported tasks</CardTitle>
          <ListEditor
            label="Supported tasks"
            items={d.supportedTasks}
            readOnly={editor.readOnly}
            onChange={(v) => set("supportedTasks", v)}
            placeholder="e.g. Report onboarding progress"
          />
        </Card>
        <Card className="space-y-3">
          <CardTitle>Key phrases</CardTitle>
          <CardDescription>Short words or phrases that strongly signal this agent.</CardDescription>
          <ListEditor
            label="Key phrases"
            items={d.keywords}
            readOnly={editor.readOnly}
            onChange={(v) => set("keywords", v)}
            placeholder="e.g. new hire"
            maxItems={60}
          />
        </Card>
      </div>
      <Card className="space-y-3">
        <CardTitle>Privacy</CardTitle>
        <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
          <input
            type="checkbox"
            checked={d.sensitivity === "confidential"}
            disabled={editor.readOnly}
            onChange={(e) => set("sensitivity", e.target.checked ? "confidential" : "internal")}
          />
          Treat this agent&apos;s results as confidential (limits who can see task details)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--acton-navy)]">
          <input
            type="checkbox"
            checked={d.allowPublicChannelResults}
            disabled={editor.readOnly}
            onChange={(e) => set("allowPublicChannelResults", e.target.checked)}
          />
          Allow answers in public Slack channels (otherwise Baxter asks people to DM)
        </label>
      </Card>
      <DelegationTester defaultExpected={data.agent.slug} useDraftFor={data.agent.slug} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const RISK_LABELS = {
  read: "Reads information",
  draft: "Creates drafts for review",
  write: "Changes records",
  external: "Acts outside Baxter",
};

export function ToolsSection({ editor, data }: { editor: ConfigEditor; data: StudioData }) {
  const enabled = new Set(editor.config.tools.enabled);
  return (
    <div className="space-y-4">
      <Notice>
        Tools are built by engineers. You can turn on the ones this agent needs; every tool still
        respects the person&apos;s permissions, and tools marked &quot;always reviewed&quot; can
        never act without human approval.
      </Notice>
      <ul className="space-y-3">
        {data.tools.map((tool) => (
          <li
            key={tool.key}
            className={cn(
              "rounded-lg border bg-white p-4",
              tool.available
                ? "border-[var(--acton-border)]"
                : "border-dashed border-[var(--acton-border)] opacity-75",
            )}
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={enabled.has(tool.key)}
                disabled={editor.readOnly || !tool.available}
                onChange={(e) =>
                  editor.update((c) => {
                    c.tools.enabled = e.target.checked
                      ? [...new Set([...c.tools.enabled, tool.key])]
                      : c.tools.enabled.filter((k) => k !== tool.key);
                  })
                }
              />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--acton-navy)]">{tool.label}</span>
                  <Pill className="bg-slate-100 text-slate-700">{RISK_LABELS[tool.risk]}</Pill>
                  {tool.alwaysRequiresApproval && tool.available ? (
                    <Pill className="bg-violet-100 text-violet-900">
                      Always reviewed by a person
                    </Pill>
                  ) : null}
                  {!tool.available ? (
                    <Pill className="bg-amber-100 text-amber-900">Coming later</Pill>
                  ) : null}
                </span>
                <span className="mt-1 block text-sm text-[var(--acton-muted)]">
                  {tool.description}
                </span>
                {!tool.available && tool.unavailableReason ? (
                  <span className="mt-1 block text-xs text-[var(--acton-muted)]">
                    Needs: {tool.unavailableReason}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
