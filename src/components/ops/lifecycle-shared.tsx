"use client";

/**
 * Shared state for the Staff lifecycle tab: one GET (/api/ops/lifecycle, scoped to the viewer)
 * and validated POST commands. Each command is re-authorized on the server.
 */

import { createContext, useCallback, useContext, useState } from "react";
import { aiFetch, errorMessage, useLoad } from "@/components/ai/ui";
import type { loadLifecycleState } from "@/lib/hr-lifecycle/commands";
import { DISPLAY_STATUS_LABELS, type DisplayStatus } from "@/lib/hr-lifecycle/types";
import { TonePill } from "./shared";

export type LifecycleState = Awaited<ReturnType<typeof loadLifecycleState>>;
export type FullLifecycleState = Extract<LifecycleState, { limited: false }>;
export type CaseRow = LifecycleState["cases"][number];

type Ctx = {
  state: LifecycleState | null;
  full: FullLifecycleState | null;
  error: string | null;
  reload: () => Promise<void>;
  run: <T = unknown>(command: Record<string, unknown>, success?: string) => Promise<T | null>;
  busy: boolean;
  message: { tone: "success" | "error"; text: string } | null;
  clearMessage: () => void;
};

const LifecycleCtx = createContext<Ctx | null>(null);

export function useLifecycle(): Ctx {
  const v = useContext(LifecycleCtx);
  if (!v) throw new Error("useLifecycle must be used inside <LifecycleProvider>");
  return v;
}

export function LifecycleProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LifecycleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Ctx["message"]>(null);

  const reload = useCallback(async () => {
    try {
      setState(await aiFetch<LifecycleState>("/api/ops/lifecycle"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useLoad(reload);

  const run = useCallback(
    async <T,>(command: Record<string, unknown>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await aiFetch<{ result: T }>("/api/ops/lifecycle", {
          method: "POST",
          body: JSON.stringify(command),
        });
        if (success) setMessage({ tone: "success", text: success });
        await reload();
        return res.result;
      } catch (e) {
        setMessage({ tone: "error", text: errorMessage(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return (
    <LifecycleCtx.Provider
      value={{
        state,
        full: state && !state.limited ? (state as FullLifecycleState) : null,
        error,
        reload,
        run,
        busy,
        message,
        clearMessage: () => setMessage(null),
      }}
    >
      {children}
    </LifecycleCtx.Provider>
  );
}

const DISPLAY_TONES: Record<DisplayStatus, "green" | "amber" | "red" | "blue" | "gray" | "violet"> =
  {
    completed: "green",
    awaiting_action: "blue",
    awaiting_approval: "amber",
    overdue: "red",
    external_verification: "violet",
    not_applicable: "gray",
    blocked: "gray",
  };

export function DisplayStatusPill({ status }: { status: DisplayStatus }) {
  return <TonePill tone={DISPLAY_TONES[status]}>{DISPLAY_STATUS_LABELS[status]}</TonePill>;
}

export function VerificationPill({ state }: { state: string | null }) {
  if (!state) return null;
  return state === "verified" ? (
    <TonePill tone="green">Legal timing verified</TonePill>
  ) : state === "discrepancy" ? (
    <TonePill tone="red">Discrepancy flagged</TonePill>
  ) : (
    <TonePill tone="amber">Unverified legal timing</TonePill>
  );
}

export const OWNER_LABELS: Record<string, string> = {
  ceo: "CEO",
  coo: "COO",
  leadership: "CEO or COO",
  hr_admin: "HR administrator",
  finance_owner: "Head of finance",
  hiring_manager: "Hiring manager",
  employee: "Employee",
  tech_ops_manager: "Tech ops manager",
  specific_person: "Specific person",
};
