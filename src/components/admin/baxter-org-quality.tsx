import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { OrgQuality } from "@/lib/agents/org-quality";

function Counts({ label, counts }: { label: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
        {label}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {entries.length ? (
          entries.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-4">
              <span>{k.replace(/_/g, " ")}</span>
              <span className="text-[var(--acton-muted)] tabular-nums">{v}</span>
            </li>
          ))
        ) : (
          <li className="text-[var(--acton-muted)]">No traces yet</li>
        )}
      </ul>
    </div>
  );
}

/** Organization-routing quality: live intent checks and aggregate routing traces (no message content). */
export function BaxterOrgQuality({ quality }: { quality: OrgQuality }) {
  const { checks, traces } = quality;
  const sets = [...new Set(checks.map((c) => c.set))];
  const failures = checks.filter((c) => !c.pass);
  return (
    <Card className="space-y-5 p-5">
      <div>
        <CardTitle>Organization routing</CardTitle>
        <CardDescription>
          How Baxter decides between answering about its AI team, delegating to an agent, asking a
          clarifying question, or searching systems like GoHighLevel. Checks use the live Agent
          Registry; traces show routing decisions only, never message content.
        </CardDescription>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {sets.map((set) => {
          const rows = checks.filter((c) => c.set === set);
          const passed = rows.filter((c) => c.pass).length;
          return (
            <div key={set} className="rounded-lg border border-[var(--acton-border)] p-3">
              <p className="text-xs tracking-wide text-[var(--acton-muted)] uppercase">
                Intent check · {set}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {passed}/{rows.length}
              </p>
            </div>
          );
        })}
      </div>
      {failures.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Not routed as expected</p>
          <ul className="space-y-1">
            {failures.map((f) => (
              <li key={`${f.set}-${f.id}`} className="text-[var(--acton-muted)]">
                “{f.question}” — expected {f.expected}, got {f.actual}
                {f.agent ? ` (${f.agent})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Counts label={`Routes · last ${traces.total}`} counts={traces.byStrategy} />
        <Counts label="Intents" counts={traces.byIntent} />
        <Counts label="Agents" counts={traces.byAgent} />
      </div>
      {traces.medianLatencyMs !== null && (
        <p className="text-sm text-[var(--acton-muted)]">
          Median routing time: {traces.medianLatencyMs} ms
        </p>
      )}
    </Card>
  );
}
