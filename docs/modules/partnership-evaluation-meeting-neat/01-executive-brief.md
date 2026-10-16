# Partnership Evaluation Meeting NEAT — Executive Brief

Acton ADU · Baxter module documentation · Version 1.0.0

---

## Objective

The Partnership Evaluation Meeting NEAT module turns the transcript of a sales meeting into four structured work products, automatically, in roughly five to fifteen minutes. It is a function of the Baxter platform, not a separate application.

A Partnership Evaluation Meeting, or PEM, is Acton's structured first sales conversation with a homeowner considering an ADU. NEAT is what the module produces from it:

| Letter             | Output                                                                                             | Who it is for                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **N** — Notes      | Internal opportunity notes, project intelligence facts, and a filled BuilderTrend handoff scaffold | The advisor, and production staff who inherit the project |
| **E** — Email      | A customer-ready follow-up email, written in the customer's own terms                              | The advisor, to send to the homeowner                     |
| **A** — Assessment | A twelve-category grade of how the advisor ran the meeting, with evidence and coaching             | The advisor and their sales manager                       |
| **T** — Transcript | The source transcript, stored, hashed, and permanently attached to the record                      | Everyone, as the evidence behind every other output       |

The module is an analysis tool, not a system of record for sales decisions. It reports what was said in the meeting and grades how the meeting was run. It does not decide whether to pursue a customer, and it does not write to BuilderTrend or to any customer-facing system on its own.

## Why it exists

Before this module, the intelligence in a PEM lived in one advisor's memory and a set of private notes. Three costs followed from that. Follow-up emails were slow and inconsistent. Project details were re-gathered later by production staff who had not been in the room. And sales coaching depended on a manager happening to sit in on a meeting.

The module addresses all three from a single input the advisor already has.

## How it works

An advisor opens PEM NEAT in Baxter, names the prospect, selects themselves as the advisor, pastes the meeting transcript, and submits. From Slack, `/pem` returns a link to that same screen.

The transcript is saved immediately, and generation runs in the background as a durable job. The advisor can close the tab. The library shows live progress through the stages, and the finished record appears when it is done.

Behind that single click, the transcript passes through six analysis stages, each a separate call to the language model with its own prompt and its own strictly validated output shape:

1. **Fact Ledger** — pulls every evidenced fact out of the transcript and classifies who said it: customer, advisor, or unknown. Nothing downstream may invent a fact that is not here.
2. **Sales Intelligence** — turns that ledger into business meaning: the customer's story, why they want to build, why they would choose a partner like Acton, budget, decision process, schedule, competition, next steps, meeting outcome, and a qualification level.
3. **Assessment** — grades the advisor against Acton's twelve-category PEM standard, with a score, a status, evidence, what worked, and coaching for each.
4. **Email** — drafts the customer follow-up, with internal language forbidden.
5. **Handoff** — fills the BuilderTrend field scaffold and writes the internal opportunity notes.
6. **Quality Review** — a separate reviewing pass that looks for unsupported numbers, misattributed statements, internal language leaking into the customer email, and assessments that contradict the evidence. Where it finds material problems, a correction pass applies them.

Deterministic checks then run in code, outside the model: quoted evidence longer than forty characters must actually appear in the transcript, stated budget figures must be traceable to it, and the BuilderTrend fields must not contain sales coaching language.

The result is saved, every prior generation is kept, and the record can be regenerated at any time.

## How it is assembled

**The grading standard is editable in the web app, not in code.** Acton's PEM standard lives in thirteen sections under Admin → Baxter Governance. A sales leader can change how Type 1 Pain is defined, or what a strong Budget conversation looks like, and the next generation uses the new wording. Compiled defaults in the codebase are the fallback if the database cannot be reached. This was deliberate: the grading standard is a sales artifact, and sales should not need an engineer to change it.

**Data lives in two Postgres tables.** `pem_neats` holds the record, the transcript, and the current result. `pem_neat_generations` holds every generation ever run, successful or failed, with its model, latency, token counts, and diagnostics. Nothing is overwritten, so a regeneration can always be compared against what it replaced.

**The model is OpenAI, configured per environment.** Token budgets, reasoning effort, and timeouts are set per stage. A fallback model is configured for when the primary is unavailable.

**Nothing writes outward.** The module does not push to BuilderTrend, GoHighLevel, or email. It prepares content a human sends. This was a deliberate choice and is recorded as a decision, not an oversight.

## What it costs

Each generation makes six model calls in the normal path, and up to twenty-eight in the worst case where every stage needs retry, recovery, and correction. Token counts and latency are recorded per generation in the database, so real cost per NEAT is measurable at any time.

**The cost per generation is not currently monitored or alerted on.** It is recorded but nobody is watching it. See the gap list below.

## What must be resolved

These are the issues a reader should know about before relying on this module. The full list, with severity and owner, is in the [Specification](./02-specification.md#gaps-to-resolve).

**1. No owner is named.** Nobody is formally accountable for the grading standard's accuracy, the review cadence, or the cost. This blocks everything else on this list, because every other item needs someone to own it.

**2. Every signed-in Baxter user can read every transcript.** The database read policy grants all authenticated users access to all PEM records, which includes full meeting transcripts containing customer names, financial circumstances, and candid remarks. It also includes every advisor's performance assessment. This is appropriate for a small team where everyone is trusted with everything; it should be a conscious decision rather than a default.

**3. Mock mode is on by default outside production.** Any environment not explicitly set to production returns a fabricated sample NEAT rather than analysing the real transcript. The fabricated result is not visibly labelled as fake in the user interface. Anyone evaluating the tool in a staging environment could reasonably believe they are looking at real analysis of their meeting.

**4. A generation that dies mid-flight stays "Generating" forever.** There is a lock that prevents double-starting within the timeout window, but no process that sweeps records whose background job never finished. The record sits in the library showing progress that will never complete until someone regenerates it by hand.

**5. The hard-fail safety mechanism is declared but not wired up.** The deterministic checks were designed so that certain failures would reject a result outright. The marker for those failures exists in the code's documentation but no check actually uses it, so today every result is saved regardless of what the checks find. The checks are advisory only.

**6. There is no accuracy baseline.** The module has extensive automated tests covering structure, contracts, and regressions. It has no evaluation set of real PEMs graded by a human sales leader against which the module's own grades are compared. Nobody can presently answer "how often does it grade a meeting the way a manager would?" with a number.

**7. Transcripts are never deleted.** Deletion is a soft delete that hides the record. The transcript, with its customer PII, remains in the database indefinitely. There is no retention policy.

---

The complete specification, with every behaviour and every gap marked in place, is in the companion document.
