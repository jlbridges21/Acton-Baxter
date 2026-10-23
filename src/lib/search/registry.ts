/**
 * Global Search provider registry — the one place providers are registered.
 *
 * To add a provider: create src/lib/search/providers/<domain>.ts exporting a SearchProvider,
 * then add it to PROVIDERS below. Order here is display order inside a category.
 * See docs/global-search/adding-providers.md.
 */

import "server-only";

import { agentsProvider } from "./providers/agents";
import { bambooEmployeesProvider } from "./providers/bamboohr";
import { ghlContactsProvider, ghlOpportunitiesProvider } from "./providers/ghl";
import { inspectionsProvider, inventoryProvider, knowledgeProvider } from "./providers/internal";
import { jobtreadJobsProvider } from "./providers/jobtread";
import { settingsProvider, toolsProvider } from "./providers/navigation";
import { reportsProvider } from "./providers/reports";
import { tasksProvider } from "./providers/tasks";
import type { SearchProvider } from "./provider";

const PROVIDERS: SearchProvider[] = [
  toolsProvider,
  settingsProvider,
  agentsProvider,
  reportsProvider,
  ghlContactsProvider,
  ghlOpportunitiesProvider,
  jobtreadJobsProvider,
  bambooEmployeesProvider,
  knowledgeProvider,
  inventoryProvider,
  inspectionsProvider,
  tasksProvider,
];

let override: SearchProvider[] | null = null;

export function listSearchProviders(): SearchProvider[] {
  return override ?? PROVIDERS;
}

export function getSearchProvider(id: string): SearchProvider | undefined {
  return listSearchProviders().find((p) => p.id === id);
}

/** Tests only: swap in fake providers (timeouts, failures, out-of-order). */
export function setSearchProvidersForTests(providers: SearchProvider[] | null) {
  override = providers;
}
