# Partnership Evaluation Meeting NEAT — Architecture Decision Records

An ADR is a short note recording a significant decision and why it was made, so that someone later can tell the difference between a deliberate choice and an accident.

These records were reconstructed from the implementation, its comments, and product direction given during development. Where the original reasoning was not recorded anywhere, that is stated rather than guessed at.

---

## ADR-001 — Multi-stage pipeline instead of one large prompt

**Status:** Accepted · Evident from the implementation

**Context.** A PEM NEAT must produce sales intelligence, a twelve-category assessment, a customer email, project intelligence, and a BuilderTrend scaffold from one transcript. The obvious approach is a single prompt returning one large JSON document.

**Decision.** Six separate stages, each a distinct model call with its own prompt, token budget, reasoning effort, and strictly validated output schema.

**Why.** A single call has to hold every rule in attention at once, and the failure mode is total: one malformed field and the whole result is unusable. Separate stages fail independently, each can be retried or corrected on its own, each gets a budget matched to its difficulty — the email needs 6,000 tokens at medium effort, the fact ledger needs 24,000 at high — and intermediate outputs can be persisted so a failure resumes rather than restarting.

**Consequences.** Six to twenty-eight model calls instead of one, so higher cost and longer wall-clock time: minutes, not seconds. That is why generation is a background job rather than a request-response. In exchange, a stage failure is recoverable and each stage is independently testable.

---

## ADR-002 — The fact ledger is the spine

**Status:** Accepted · Evident from the implementation

**Context.** The central risk in summarising a sales meeting is fabrication. A model asked to describe a customer's budget will produce a confident number whether or not one was discussed.

**Decision.** Stage A extracts a structured fact ledger — every evidenced fact, in eleven categories, attributed to customer, advisor, or unknown. Every later stage works from the ledger, not from the raw transcript.

**Why.** It separates extraction from interpretation. Extraction is checkable: a fact is in the transcript or it is not. Interpretation is then constrained to facts that survived extraction. The ledger also holds provenance, so later stages do not need to re-derive who said what, and budget statements are captured separately — an ideal figure, a stretch figure, and a competitor's quote are three facts, and collapsing them into one number loses the meaning.

**Consequences.** An extra stage on every generation. A poor ledger degrades everything downstream, which is why a near-empty ledger triggers a recovery pass. The recovery prompt says explicitly that it is an extraction retry and not permission to invent.

---

## ADR-003 — The grading standard is editable in the web app, not in code

**Status:** Accepted · Explicit in the code comments

**Context.** Acton's PEM grading standard is a sales methodology. It changes as sales leadership refines how meetings should be run. Originally it lived in the system prompt in the codebase.

**Decision.** Split the standard into thirteen named sections stored in the governance surface and editable by an administrator in the web app. The section set and order stay fixed in code; only the text is editable. Compiled defaults, byte-identical to the original prompt, remain as fallback.

**Why.** The grading standard is a sales artifact, not an engineering one. Requiring a developer and a deploy to change the definition of Type 1 Pain puts an engineer in the path of a sales decision. Fixing the section set in code keeps the contract stable while the content moves.

**Consequences.** Grading behaviour can change without a code change, which is the point and also the risk: an edit takes effect on the next generation with no staging and no review gate. Each generation records the governance version it used, so a result can be traced to its standard. **The live text is database content and is not in version control** — it must be exported deliberately, which is why that is a standing item in the [Module Record](./04-module-record.md#review).

---

## ADR-004 — Generation is a durable background job

**Status:** Accepted · Evident from the implementation

**Context.** A generation makes six or more high-effort model calls and can take fifteen minutes. HTTP requests and serverless invocations do not last that long.

**Decision.** The API saves the transcript, enqueues a durable job, and returns immediately. The browser polls a status endpoint. In environments using the in-memory job store, such as tests and E2E, the job runs inline instead.

**Why.** The advisor should be able to close the tab. The transcript must survive a generation failure, so it is saved before generation starts — a failed analysis is an inconvenience, a lost transcript is lost work. Stage progress is persisted so the library can show real progress rather than a spinner.

**Consequences.** More moving parts: a queue, a status endpoint, progress persistence, and a concurrency lock. The lock expires rather than resolving, so a job that dies mid-flight leaves the record in `generating` indefinitely. That is gap 5 in the [Specification](./02-specification.md#gaps-to-resolve).

---

## ADR-005 — Every generation is kept

**Status:** Accepted · Evident from the schema

**Context.** Regeneration is common: the transcript gets corrected, the grading standard changes, or a result looks wrong.

**Decision.** `pem_neat_generations` is append-only. Every attempt, successful or failed, is kept with its model, latency, tokens, diagnostics, and failed stage. The parent row holds the current result; history holds everything.

**Why.** Regrading is consequential — these are employee performance assessments. An advisor who is graded differently on a second run deserves both records to exist. Failed generations keep their diagnostics, which is what makes debugging possible after the fact.

**Consequences.** Storage grows with every regeneration, and each row holds a full structured result. No pruning exists. At current volume this is immaterial; it is worth revisiting if volume grows substantially.

---

## ADR-006 — Code owns the keys, the model owns the values

**Status:** Accepted · Explicit in the prompts

**Context.** Models drift on structure. Asked for twelve categories, a model will sometimes return eleven, rename one, or return `"8/10"` where a number was required.

**Decision.** The twelve assessment category keys, every enum, and the BuilderTrend field names are fixed in code. The prompts state this outright: _"Code owns the 12 category keys"_, _"Code owns all BuilderTrend field KEYS — fill VALUES."_ Output is parsed with Zod, and stages B and C have structure-only correction prompts for when validation fails.

**Why.** A stable contract. Downstream consumers — the UI, the PDF export, the Baxter chat data layer — can rely on the shape. Missing categories are merged in as `NOT_DETERMINABLE` rather than silently vanishing, so an incomplete answer is visible instead of invisible.

**Consequences.** Adding a category is a code change plus a prompt change plus a migration consideration for existing rows. Correction passes cost extra calls when they fire.

---

## ADR-007 — PEM NEAT does not trigger New Project Setup

**Status:** Accepted · Explicit product direction

**Context.** A meeting classified `YES` is a won deal, and New Project Setup exists to create the project, the Drive folder, the Slack channel, and the charter. Wiring them together is the obvious automation.

**Decision.** They stay disconnected. Project setup is triggered manually.

**Why.** This was an explicit instruction during development: keep the two features separate and require manual triggering. A meeting outcome is a model's reading of a conversation, and an incorrect `YES` would create a real project, a real Slack channel, and real customer-facing artifacts. The cost of a false positive is far higher than the cost of a human clicking a button.

**Consequences.** A manual step on every won deal. Revisit only once outcome classification has a measured accuracy rate — which requires the evaluation set that does not yet exist. See the [Test Plan](./06-test-plan-and-eval.md#proposed-evaluation-set).

---

## ADR-008 — The module prepares, humans send

**Status:** Accepted · Evident from the implementation

**Context.** The module produces a customer follow-up email and a BuilderTrend handoff scaffold. Both have an obvious automation: send the email, write the fields.

**Decision.** Neither happens. The module writes content into the record; a human reviews, edits, and acts.

**Why.** Consistent with ADR-007 and with the module's identity as an analysis tool. An email to a homeowner is a customer relationship; a wrong one is not recoverable with an undo. The email prompt forbids inventing promises, but the real safeguard is that an advisor reads it first.

**Consequences.** The module saves drafting time, not sending time. That is the intended trade.

---

## ADR-009 — Transcripts under 180,000 characters are sent whole

**Status:** Accepted · Evident from the implementation

**Context.** Chunking a transcript risks losing cross-references, and naive head-and-tail chunking loses the middle of the meeting entirely — which is where budget and decision process are usually discussed.

**Decision.** Send the whole transcript when it fits in 180,000 characters. Above that, split into paragraph-aware chunks of about 28,000 characters with a 2,000-character overlap, labelled beginning, middle, and end, and merge the resulting ledgers in a dedicated stage. Every chunk is processed; the module never takes only head and tail.

**Why.** Whole is better when it fits. The file comment states the constraint plainly: _"Never head+tail-only."_ A PEM is a structured conversation and the middle carries the substance.

**Consequences.** Long transcripts cost an extra merge stage and more calls. The 180,000 threshold is tied to current model context and should be revisited when the model changes.

---

## ADR-010 — Advisor display name is denormalised

**Status:** Accepted · Evident from the schema

**Context.** `salesperson_user_id` references `profiles` and is set null on delete.

**Decision.** Store `salesperson_display_name` as text on the record as well. The update route explicitly permits keeping a historical advisor who has left the Sales department.

**Why.** A PEM NEAT is a historical record of a meeting that a specific person ran. If that person leaves, the record must still say who ran the meeting. A foreign key alone would lose that.

**Consequences.** The name can drift from the profile if someone is renamed. For a historical record this is the correct trade: the record should say what was true at the time.

---

## Decisions not recorded

Honest gaps in this file. Where the reasoning was not captured anywhere, these are the questions a future engineer will ask and this folder cannot answer:

- Why OpenAI rather than Anthropic, when Baxter supports both elsewhere.
- Why temperature 0.25 specifically.
- How the per-stage token budgets were chosen — measured, or estimated.
- Why 180,000 characters is the full-transcript threshold.
- Why the twelve assessment categories are those twelve. This is the most consequential undocumented decision in the module, since it is Acton's sales methodology encoded as a schema. It should be recorded by whoever owns the grading standard.
