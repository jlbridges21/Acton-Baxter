/**
 * Load Master Project Log from the configured Project Charter Master spreadsheet.
 * Reads spreadsheet ID + tab from project_setup_settings (never hardcoded).
 */

import "server-only";

import { getProjectSetupSettings } from "@/lib/project-setup/store";
import { readSheetValues } from "@/lib/connectors/google/writes";
import { parseMasterProjectLogGrid } from "./parse";
import { getCachedProjectLog, setCachedProjectLog } from "./cache";
import type { ProjectLogRow, ProjectRegistryLoadResult } from "./types";

export type LoadProjectRegistryDeps = {
  getSettings?: typeof getProjectSetupSettings;
  readSheet?: typeof readSheetValues;
  /** Inject rows for unit tests (skips Google). */
  rowsOverride?: ProjectLogRow[] | null;
  ttlMs?: number;
};

let loadDepsForTests: LoadProjectRegistryDeps | null = null;

/** Test inject for Master Project Log rows / settings (shared by registry + Slack derive). */
export function setProjectRegistryLoadDepsForTests(deps: LoadProjectRegistryDeps | null): void {
  loadDepsForTests = deps;
}

/**
 * Live/short-cached read of the Master Project Log.
 * Prefer this over Knowledge Base structured index for project facts so new
 * Project Setup rows are visible within the TTL (KB Drive sync can lag).
 */
export async function loadMasterProjectLog(
  deps: LoadProjectRegistryDeps = {},
): Promise<ProjectRegistryLoadResult> {
  const effective = { ...(loadDepsForTests ?? {}), ...deps };
  if (effective.rowsOverride != null) {
    return {
      rows: effective.rowsOverride,
      spreadsheetId: "test-sheet",
      tabName: "Master Project Log",
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  }

  // Unit tests must inject rowsOverride — never hang on live Supabase/Google.
  if (process.env.VITEST === "true" && !loadDepsForTests) {
    return {
      rows: [],
      spreadsheetId: "",
      tabName: "",
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  }

  const getSettings = effective.getSettings ?? getProjectSetupSettings;
  const settings = await getSettings();
  const spreadsheetId = settings.masterCharterSpreadsheetId?.trim() || "";
  const tabName = settings.masterLogTabName?.trim() || "";
  if (!spreadsheetId || !tabName) {
    return {
      rows: [],
      spreadsheetId,
      tabName,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
  }

  const cached = getCachedProjectLog({ spreadsheetId, tabName });
  if (cached) {
    return {
      rows: cached.rows,
      spreadsheetId,
      tabName,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    };
  }

  const readSheet = effective.readSheet ?? readSheetValues;
  const grid = await readSheet({
    spreadsheetId,
    tabName,
    rangeA1: "A:I",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = parseMasterProjectLogGrid(grid);
  setCachedProjectLog({
    rows,
    spreadsheetId,
    tabName,
    ttlMs: effective.ttlMs,
  });

  return {
    rows,
    spreadsheetId,
    tabName,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
}
