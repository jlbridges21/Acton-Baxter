"use client";

/**
 * Sam Operations Studio: the no-code home for Sam's HR, administration, and legal operations.
 * One page, sectioned tabs (?tab=…), so it stays a single item in the AI Workspace navigation.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Notice } from "@/components/ai/ui";
import { cn } from "@/lib/utils";
import {
  ContractsTab,
  DocumentsTab,
  InsuranceTab,
  RecruitmentTab,
  SurveysTab,
  TimecardsTab,
} from "./registers";
import { EmployeesTab } from "./bamboohr";
import { LibraryTab } from "./editor";
import { LifecycleTab } from "./lifecycle";
import { ActivityTab, IntegrationsTab, OverviewTab, SamConfigTab, SetupTab } from "./setup";
import { OpsProvider, useFullOps, useOps } from "./shared";
import { ApprovalsTab, InboxTab, InstanceDialog, WorkflowsTab } from "./workflows";

type TabDef = { key: string; label: string; group: string; full?: boolean };

const TABS: TabDef[] = [
  { key: "overview", label: "Overview", group: "Home" },
  { key: "inbox", label: "My tasks", group: "Home" },
  { key: "approvals", label: "Approvals", group: "Home", full: true },
  { key: "workflows", label: "Active workflows", group: "Workflows" },
  { key: "lifecycle", label: "Staff lifecycle", group: "Workflows" },
  { key: "onboarding", label: "Onboarding", group: "Workflows", full: true },
  { key: "offboarding", label: "Offboarding", group: "Workflows", full: true },
  { key: "library", label: "Library & editor", group: "Workflows", full: true },
  { key: "employees", label: "Employees (BambooHR)", group: "Records" },
  { key: "documents", label: "Documents", group: "Records", full: true },
  { key: "recruitment", label: "Recruitment & interviews", group: "Records", full: true },
  { key: "surveys", label: "Surveys", group: "Records", full: true },
  { key: "timecards", label: "Timecards", group: "Records", full: true },
  { key: "contracts", label: "Contracts", group: "Legal", full: true },
  { key: "insurance", label: "Insurance", group: "Legal", full: true },
  { key: "integrations", label: "Integrations", group: "Admin", full: true },
  { key: "setup", label: "Setup", group: "Admin", full: true },
  { key: "sam", label: "Sam configuration", group: "Admin", full: true },
  { key: "activity", label: "Activity", group: "Admin", full: true },
];

export function OperationsStudio() {
  return (
    <OpsProvider>
      <Studio />
    </OpsProvider>
  );
}

function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const { state, error, toast, clearToast } = useOps();
  const { full } = useFullOps();
  const tab = params.get("tab") ?? "overview";
  const [openInstance, setOpenInstance] = useState<string | null>(params.get("workflow"));
  const visible = TABS.filter((t) => !t.full || full);
  const go = (key: string) => router.replace(`/ai/operations?tab=${key}`, { scroll: false });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 5000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!state) return <p className="text-sm text-[var(--acton-muted)]">Loading Sam Operations…</p>;

  const current = visible.find((t) => t.key === tab) ?? visible[0]!;
  const groups = [...new Set(visible.map((t) => t.group))];

  return (
    <div className="space-y-5">
      <nav
        aria-label="Sam Operations sections"
        className="flex gap-4 overflow-x-auto rounded-lg border border-[var(--acton-border)] bg-white p-2 shadow-sm"
      >
        {groups.map((g) => (
          <div key={g} className="flex shrink-0 items-center gap-1">
            <span className="px-1 text-[10px] font-bold tracking-wider text-[var(--acton-muted)] uppercase">
              {g}
            </span>
            {visible
              .filter((t) => t.group === g)
              .map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => go(t.key)}
                  aria-current={current.key === t.key ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap",
                    current.key === t.key
                      ? "bg-[var(--acton-navy)] text-white"
                      : "text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]",
                  )}
                >
                  {t.label}
                  {t.key === "inbox" && state.inbox.length ? (
                    <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-[var(--acton-navy)]">
                      {state.inbox.length}
                    </span>
                  ) : null}
                  {t.key === "approvals" &&
                  full?.actions.some((a) => a.status === "pending_approval") ? (
                    <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-[var(--acton-navy)]">
                      {full.actions.filter((a) => a.status === "pending_approval").length}
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
        ))}
      </nav>

      {state.limited ? (
        <Notice tone="info">
          You see only tasks and workflows that involve you. HR administrators and leadership see
          everything.
        </Notice>
      ) : null}

      {current.key === "overview" ? <OverviewTab go={go} /> : null}
      {current.key === "inbox" ? <InboxTab onOpen={setOpenInstance} /> : null}
      {current.key === "approvals" ? <ApprovalsTab /> : null}
      {current.key === "workflows" ? (
        <WorkflowsTab
          title="Active workflows"
          description="Every running workflow, its progress, what's overdue, and what's waiting for approval."
          onOpen={setOpenInstance}
        />
      ) : null}
      {current.key === "onboarding" ? (
        <WorkflowsTab
          category="onboarding"
          title="Onboarding"
          description="New hires from approved offer to their 30-day check-in. Access steps belong to the COO; payroll setup belongs to finance."
          onOpen={setOpenInstance}
        />
      ) : null}
      {current.key === "offboarding" ? (
        <WorkflowsTab
          category="offboarding"
          title="Offboarding"
          description="Departures from leadership confirmation to final records. Access removal belongs to the COO; final pay belongs to finance."
          onOpen={setOpenInstance}
        />
      ) : null}
      {current.key === "lifecycle" ? <LifecycleTab /> : null}
      {current.key === "library" ? <LibraryTab /> : null}
      {current.key === "employees" ? <EmployeesTab /> : null}
      {current.key === "documents" ? <DocumentsTab /> : null}
      {current.key === "recruitment" ? <RecruitmentTab /> : null}
      {current.key === "surveys" ? <SurveysTab /> : null}
      {current.key === "timecards" ? <TimecardsTab /> : null}
      {current.key === "contracts" ? <ContractsTab /> : null}
      {current.key === "insurance" ? <InsuranceTab /> : null}
      {current.key === "integrations" ? <IntegrationsTab /> : null}
      {current.key === "setup" ? <SetupTab /> : null}
      {current.key === "sam" ? <SamConfigTab /> : null}
      {current.key === "activity" ? <ActivityTab /> : null}

      {openInstance ? (
        <InstanceDialog id={openInstance} onClose={() => setOpenInstance(null)} />
      ) : null}

      {toast ? (
        <div
          role="status"
          className={cn(
            "fixed right-4 bottom-4 z-[60] flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg",
            toast.tone === "error" ? "bg-red-700 text-white" : "bg-[var(--acton-navy)] text-white",
          )}
        >
          <span className="min-w-0">{toast.text}</span>
          <button type="button" aria-label="Dismiss" onClick={clearToast}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
