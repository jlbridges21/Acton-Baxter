import { getEnv } from "@/lib/env";
import { AppError, NotFoundError, logServerError } from "@/lib/errors";
import { RESEARCH_STAGES } from "./constants";
import { runMockPropertyResearch } from "./mock-research-provider";
import { runLivePropertyResearch } from "./live/run-live-property-research";
import { getReportStore } from "./report-store";
import type { ResearchProgress } from "./db-types";

const stageProgress = new Map<string, number>();
const inFlight = new Set<string>();

export function getResearchStage(reportId: string, status: string): ResearchProgress {
  const stageIndex =
    status === "complete"
      ? RESEARCH_STAGES.length - 1
      : status === "failed"
        ? Math.min(stageProgress.get(reportId) ?? 0, RESEARCH_STAGES.length - 1)
        : (stageProgress.get(reportId) ?? 0);

  return {
    reportId,
    status: status as ResearchProgress["status"],
    stageIndex,
    stageLabel: RESEARCH_STAGES[stageIndex] ?? RESEARCH_STAGES[0]!,
    errorMessage: null,
  };
}

export async function runPropertyResearch(
  reportId: string,
  options?: { forceRefresh?: boolean },
): Promise<void> {
  if (inFlight.has(reportId)) {
    return;
  }

  const store = getReportStore();
  const report = await store.getReport(reportId);
  if (!report) {
    throw new NotFoundError("Report not found");
  }

  if (report.status === "complete" && !options?.forceRefresh) {
    return;
  }

  const env = getEnv();
  inFlight.add(reportId);
  stageProgress.set(reportId, 0);

  try {
    if (options?.forceRefresh) {
      await store.clearResearchChildren(reportId);
    }

    await store.updateReportStatus(reportId, "researching", {
      startedAt: new Date().toISOString(),
      errorMessage: null,
    });

    const stageTimer = setInterval(() => {
      const current = stageProgress.get(reportId) ?? 0;
      if (current < RESEARCH_STAGES.length - 1) {
        stageProgress.set(reportId, current + 1);
      }
    }, 400);

    let result;
    try {
      if (env.ENABLE_MOCK_RESEARCH) {
        result = await runMockPropertyResearch(report.input_address);
      } else {
        result = await runLivePropertyResearch(report.input_address, {
          latitude: report.latitude,
          longitude: report.longitude,
          placeId: report.google_place_id,
        });
      }
    } finally {
      clearInterval(stageTimer);
      stageProgress.set(reportId, RESEARCH_STAGES.length - 1);
    }

    await store.saveResearchResult(reportId, result);
    stageProgress.delete(reportId);
  } catch (error) {
    logServerError("runPropertyResearch", error);
    const message =
      error instanceof AppError
        ? error.message
        : "Property research failed. Please retry this report.";
    await store.updateReportStatus(reportId, "failed", {
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });
    stageProgress.delete(reportId);
    throw error;
  } finally {
    inFlight.delete(reportId);
  }
}

export async function retryPropertyResearch(reportId: string): Promise<void> {
  const store = getReportStore();
  const report = await store.getReport(reportId);
  if (!report) {
    throw new NotFoundError("Report not found");
  }

  await store.clearResearchChildren(reportId);
  await store.updateReportStatus(reportId, "queued", {
    errorMessage: null,
    startedAt: null,
    completedAt: null,
  });

  await runPropertyResearch(reportId);
}

export async function refreshLivePropertyResearch(reportId: string): Promise<void> {
  await runPropertyResearch(reportId, { forceRefresh: true });
}
