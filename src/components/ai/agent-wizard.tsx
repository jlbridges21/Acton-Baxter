"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ModelCatalogEntry, ProviderStatus } from "@/lib/agents/models";
import { agentConfigSchema, type ModelProvider } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import { ListEditor } from "./list-editor";
import type { StudioToolInfo } from "./studio-types";
import { Field, Notice, aiFetch, errorMessage, selectClass, textareaClass } from "./ui";

const STEPS = [
  "Name & role",
  "Department & manager",
  "Responsibilities",
  "Instructions",
  "AI model",
  "Knowledge & tools",
  "Delegation",
  "Access & review",
];

export function AgentWizard(props: {
  departments: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string; kind: string }>;
  models: ModelCatalogEntry[];
  providers: ProviderStatus[];
  tools: StudioToolInfo[];
  categories: ReadonlyArray<{ slug: string; label: string }>;
}) {
  const router = useRouter();
  const orchestrator = props.agents.find((a) => a.kind === "orchestrator");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [newDept, setNewDept] = useState({ name: "", color: "#2f6f5e" });
  const [form, setForm] = useState({
    displayName: "",
    title: "",
    description: "",
    departmentId: props.departments[0]?.id ?? "",
    managerAgentId: orchestrator?.id ?? "",
    responsibilities: "",
    identity: "",
    tone: "Friendly, clear, and concise.",
    rules:
      "Cite the approved document you used.\nIf no approved document covers the question, say so.",
    boundaries: "",
    escalation: "",
    provider: "anthropic" as ModelProvider,
    model: "claude-opus-5-5",
    categories: [] as string[],
    tools: ["knowledge_search"] as string[],
    acceptsDelegation: true,
    specialization: "",
    positiveExamples: [] as string[],
    negativeExamples: [] as string[],
    keywords: [] as string[],
    everyoneCanAsk: false,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const stepError = (() => {
    if (step === 0 && !form.displayName.trim()) return "Give the agent a name.";
    if (step === 1 && form.departmentId === "__new" && !newDept.name.trim())
      return "Name the new department.";
    if (
      step === 6 &&
      form.acceptsDelegation &&
      (!form.specialization.trim() || form.positiveExamples.length < 2)
    ) {
      return "Add a specialization and at least two example requests, or turn off delegation.";
    }
    return null;
  })();

  async function create(activate: boolean) {
    setBusy(true);
    setError(null);
    try {
      let departmentId: string | null = form.departmentId || null;
      if (departmentId === "__new") {
        const res = await aiFetch<{ department: { id: string } }>("/api/ai/departments", {
          method: "POST",
          body: JSON.stringify({
            name: newDept.name,
            color: newDept.color,
            description: null,
            is_visible: true,
          }),
        });
        departmentId = res.department.id;
      }
      const config = agentConfigSchema.parse({
        instructions: {
          identity:
            form.identity ||
            `You are ${form.displayName}, ${form.title || "a specialist"} at Acton ADU. You report to Baxter, the AI CEO.`,
          tone: form.tone,
          objectives: form.description,
          responsibilities: form.responsibilities,
          rules: form.rules,
          boundaries: form.boundaries,
          escalation: form.escalation,
        },
        model: {
          source: "custom",
          provider: form.provider,
          model: form.model,
          effort: "low",
          maxOutputTokens: 4000,
          fallback: null,
        },
        delegation: {
          acceptsDelegation: form.acceptsDelegation,
          specialization: form.specialization,
          positiveExamples: form.positiveExamples,
          negativeExamples: form.negativeExamples,
          keywords: form.keywords,
          requiredKnowledgeCategories: form.categories,
          sensitivity: "internal",
        },
        tools: { enabled: form.tools, approvalRequired: [] },
        knowledge: { categories: form.categories },
      });
      const { agent } = await aiFetch<{ agent: { slug: string } }>("/api/ai/agents", {
        method: "POST",
        body: JSON.stringify({
          displayName: form.displayName,
          title: form.title,
          description: form.description,
          departmentId,
          managerAgentId: form.managerAgentId || null,
          config,
          activate,
        }),
      });
      if (form.everyoneCanAsk) {
        await aiFetch(`/api/ai/agents/${agent.slug}/access`, {
          method: "POST",
          body: JSON.stringify({
            principalType: "role",
            principalValue: "user",
            accessLevel: "use_via_baxter",
          }),
        });
      }
      if (portrait) {
        const body = new FormData();
        body.append("file", portrait);
        await aiFetch(`/api/ai/agents/${agent.slug}/avatar`, { method: "POST", body }).catch(
          () => undefined,
        );
      }
      router.push(`/ai/agents/${agent.slug}?tab=${activate ? "overview" : "test"}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <ol className="space-y-1" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                i === step
                  ? "bg-[var(--acton-navy)] font-semibold text-white"
                  : i < step
                    ? "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-100)]"
                    : "text-[var(--acton-muted)]",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  i < step ? "bg-emerald-600 text-white" : "border",
                )}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Card className="space-y-5">
        <CardTitle>{STEPS[step]}</CardTitle>
        {step === 0 ? (
          <>
            <Field
              label="Agent name"
              help="A friendly first name works well, like Sam."
              htmlFor="wz-name"
            >
              <Input
                id="wz-name"
                value={form.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label="Role / title" htmlFor="wz-title">
              <Input
                id="wz-title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Finance Specialist"
              />
            </Field>
            <Field label="Short description" help="Shown in the directory and office.">
              <textarea
                className={textareaClass}
                rows={3}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <Field
              label="Portrait (optional)"
              help="PNG, JPEG, or WebP up to 2 MB. You can crop it later in the profile."
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setPortrait(e.target.files?.[0] ?? null)}
              />
            </Field>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Field label="Department">
              <select
                className={selectClass}
                value={form.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}
              >
                {props.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value="__new">+ Create a new department…</option>
                <option value="">No department</option>
              </select>
            </Field>
            {form.departmentId === "__new" ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                <Field label="New department name">
                  <Input
                    value={newDept.name}
                    onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                    placeholder="e.g. Finance"
                  />
                </Field>
                <Field label="Color">
                  <input
                    type="color"
                    value={newDept.color}
                    onChange={(e) => setNewDept({ ...newDept, color: e.target.value })}
                    className="h-11 w-full rounded-md border border-[var(--acton-border)]"
                  />
                </Field>
              </div>
            ) : null}
            <Field
              label="Reports to"
              help="Specialists normally report to Baxter so Baxter can hand them work."
            >
              <select
                className={selectClass}
                value={form.managerAgentId}
                onChange={(e) => set("managerAgentId", e.target.value)}
              >
                <option value="">Nobody</option>
                {props.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}
        {step === 2 ? (
          <Field label="Responsibilities" help="What this agent owns. One per line.">
            <textarea
              className={textareaClass}
              rows={8}
              value={form.responsibilities}
              onChange={(e) => set("responsibilities", e.target.value)}
            />
          </Field>
        ) : null}
        {step === 3 ? (
          <>
            <Notice>
              Write in plain language. Platform security rules are added automatically and
              can&apos;t be overridden.
            </Notice>
            <Field label="Who this agent is (optional)">
              <textarea
                className={textareaClass}
                rows={2}
                value={form.identity}
                onChange={(e) => set("identity", e.target.value)}
                placeholder={`You are ${form.displayName || "…"}, …`}
              />
            </Field>
            <Field label="Tone">
              <Input value={form.tone} onChange={(e) => set("tone", e.target.value)} />
            </Field>
            <Field label="Operating rules">
              <textarea
                className={textareaClass}
                rows={4}
                value={form.rules}
                onChange={(e) => set("rules", e.target.value)}
              />
            </Field>
            <Field label="Things this agent must not do">
              <textarea
                className={textareaClass}
                rows={3}
                value={form.boundaries}
                onChange={(e) => set("boundaries", e.target.value)}
              />
            </Field>
            <Field label="When to involve a person">
              <textarea
                className={textareaClass}
                rows={2}
                value={form.escalation}
                onChange={(e) => set("escalation", e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {step === 4 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <select
                className={selectClass}
                value={form.provider}
                onChange={(e) => {
                  const provider = e.target.value as ModelProvider;
                  setForm((f) => ({
                    ...f,
                    provider,
                    model: props.models.find((m) => m.provider === provider)?.id ?? f.model,
                  }));
                }}
              >
                {props.providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.label}
                    {p.configured ? "" : " (not configured)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model">
              <select
                className={selectClass}
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
              >
                {props.models
                  .filter((m) => m.provider === form.provider)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.tier}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        ) : null}
        {step === 5 ? (
          <>
            <Field
              label="Knowledge categories"
              help="Which kinds of documents this agent works with. Upload documents in the Knowledge Hub."
            >
              <div className="flex flex-wrap gap-3">
                {props.categories.map((c) => (
                  <label key={c.slug} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.categories.includes(c.slug)}
                      onChange={(e) =>
                        set(
                          "categories",
                          e.target.checked
                            ? [...form.categories, c.slug]
                            : form.categories.filter((x) => x !== c.slug),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Tools">
              <ul className="space-y-2">
                {props.tools.map((t) => (
                  <li key={t.key}>
                    <label
                      className={cn("flex items-start gap-2 text-sm", !t.available && "opacity-60")}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={!t.available}
                        checked={form.tools.includes(t.key)}
                        onChange={(e) =>
                          set(
                            "tools",
                            e.target.checked
                              ? [...form.tools, t.key]
                              : form.tools.filter((x) => x !== t.key),
                          )
                        }
                      />
                      <span>
                        <b>{t.label}</b>
                        {!t.available ? " (coming later)" : ""} —{" "}
                        <span className="text-[var(--acton-muted)]">{t.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Field>
          </>
        ) : null}
        {step === 6 ? (
          <>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.acceptsDelegation}
                onChange={(e) => set("acceptsDelegation", e.target.checked)}
              />
              Baxter may hand requests to this agent
            </label>
            {form.acceptsDelegation ? (
              <>
                <Field
                  label="Specialization"
                  help="One or two sentences Baxter reads when deciding."
                >
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={form.specialization}
                    onChange={(e) => set("specialization", e.target.value)}
                  />
                </Field>
                <Field label="Example requests to hand over (at least two)">
                  <ListEditor
                    label="Positive examples"
                    items={form.positiveExamples}
                    onChange={(v) => set("positiveExamples", v)}
                    placeholder="Type an example and press Enter"
                  />
                </Field>
                <Field label="Similar requests Baxter should keep">
                  <ListEditor
                    label="Negative examples"
                    items={form.negativeExamples}
                    onChange={(v) => set("negativeExamples", v)}
                  />
                </Field>
                <Field label="Key phrases">
                  <ListEditor
                    label="Key phrases"
                    items={form.keywords}
                    onChange={(v) => set("keywords", v)}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        {step === 7 ? (
          <>
            <Field label="Who can ask this agent through Baxter?">
              <select
                className={selectClass}
                value={form.everyoneCanAsk ? "everyone" : "admins"}
                onChange={(e) => set("everyoneCanAsk", e.target.value === "everyone")}
              >
                <option value="admins">
                  Only administrators for now (you can add people later)
                </option>
                <option value="everyone">Everyone with Baxter access</option>
              </select>
            </Field>
            <CardDescription>
              <b>{form.displayName || "This agent"}</b> — {form.title || "no title"}. Model:{" "}
              {form.model}. Tools: {form.tools.length}.{" "}
              {form.acceptsDelegation
                ? `${form.positiveExamples.length} delegation examples.`
                : "Baxter won't delegate to it."}
            </CardDescription>
            <Notice>
              <b>Save as draft</b> keeps the agent switched off so you can test it on the Test tab.{" "}
              <b>Create and activate</b> makes it available right away.
            </Notice>
          </>
        ) : null}

        {stepError && step < STEPS.length ? (
          <p className="text-sm text-amber-800">{stepError}</p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--acton-border)] pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={Boolean(stepError)}
            >
              Next
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => create(false)}
                disabled={busy}
              >
                Save as draft &amp; test
              </Button>
              <Button type="button" onClick={() => create(true)} disabled={busy}>
                {busy ? "Creating…" : "Create and activate"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
