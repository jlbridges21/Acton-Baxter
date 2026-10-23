# Baxter Global Search

A permission-aware search and command palette for Baxter. Open it with the magnifying-glass
button at the far right of the header, or with **⌘K** (macOS) / **Ctrl+K** (Windows, Linux).

The interaction model follows GoHighLevel's Global Search V2: one floating modal, category
pills, grouped results, and keyboard navigation. It is built from scratch in Baxter's own
design system and uses no GoHighLevel code or assets.

| Document                                   | What it covers                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Request flow, components, ranking, the result contract                              |
| [providers.md](providers.md)               | The provider contract and the registration convention                               |
| [adding-providers.md](adding-providers.md) | Step-by-step guide for a new domain                                                 |
| [indexed-data.md](indexed-data.md)         | What is (and is never) stored in `global_search_index`                              |
| [external-sources.md](external-sources.md) | GoHighLevel, JobTread, and BambooHR behavior                                        |
| [authorization.md](authorization.md)       | Security model, per-provider rules, leakage controls                                |
| [sync.md](sync.md)                         | Index lifecycle: initial build, refresh, deletions, permission changes, disconnects |
| [performance.md](performance.md)           | Debounce, cancellation, timeouts, limits, and measured latency                      |
| [admin.md](admin.md)                       | The `/admin/search` page                                                            |
| [deployment.md](deployment.md)             | Migration, env vars, and rollout steps                                              |
| [test-results.md](test-results.md)         | What the test suites cover and the latest results                                   |
| [limitations.md](limitations.md)           | Known gaps and honest caveats                                                       |
