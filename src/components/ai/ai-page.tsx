import { AppShell } from "@/components/layout/app-shell";
import type { AuthUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/errors";
import { StoreError } from "@/lib/agents/store";
import { WorkspaceTabs } from "./ui";

/** Detects "the AI Workforce tables don't exist yet" (migration 067 not applied). */
export function isMissingSchemaError(error: unknown): boolean {
  return (
    error instanceof StoreError &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message))
  );
}

export function AiPageShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  return (
    <AppShell user={user}>
      <WorkspaceTabs />
      {children}
    </AppShell>
  );
}

export function AiLoadError({ error, context }: { error: unknown; context: string }) {
  logServerError(context, error);
  if (isMissingSchemaError(error)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">The AI Workspace database isn&apos;t set up yet.</p>
        <p className="mt-1">
          An administrator needs to apply migration <code>067_ai_workforce.sql</code> to Supabase.
          Baxter chat keeps working normally in the meantime.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900">
      This page couldn&apos;t be loaded. Refresh to try again.
    </div>
  );
}
