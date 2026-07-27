# Baxter Governance Document v1.1

Baxter Governance Document v1.1
Companion to the Baxter Runtime System Prompt v1.1 | July 23, 2026 | Author: James Parks | Revised for the Claude Tag path assessment
This document holds everything that governs Baxter but does not belong in his runtime instructions: open decisions, deployment configuration, design risks, ownership, and change control. Items in red require a decision or carry a risk. Nothing red ships unresolved.

## 1. Document Split

Baxter is governed by two documents:
The Runtime System Prompt contains only behavior: precedence order, culture distillation, evidence standard, scope, style, and worked examples. It is what gets deployed. Every token in it competes for the model's attention, so nothing else lives there.
This Governance Document contains everything else: configuration values the prompt needs before deployment, flagged design decisions, risks, roles, and the change control procedure.

## 2. Deployment Configuration (required before launch)

The runtime prompt contains bracketed values that must be filled before deployment. Each is a team decision, not a technical detail.
PLACEHOLDER: Confirmation loop owner. Who confirms and writes teammate-asserted facts into the system of record? Current default is Jackson Bridges for all record types. Open question: whether customer facts should route to the customer's Responsible party per the RACI matrix, with Jackson owning only system integrity. As drafted, Jackson is the human bottleneck for every fact in the company, which may not survive past pilot volume.
PLACEHOLDER: Alert routing. DM vs. channel post, per alert type. Undefined.
PLACEHOLDER: Acknowledgment definition. What counts as acknowledged: emoji react, threaded reply, or something else. Escalation cannot function until this is defined.
PLACEHOLDER: Escalation window and chain. How long before an unacknowledged alert escalates to the Accountable party, and whether Milan is the terminal escalation.
PLACEHOLDER: False-positive default during pilot. When Baxter is uncertain, does he suppress and log, or flag to a review channel instead of the responsible party?
PLACEHOLDER: Pilot scope. One project type and a named pilot group for Phase 1b soft launch.
PLACEHOLDER: Correction and feedback mechanism. Where corrections get logged: a #baxter-feedback channel, emoji react capture, or other.
PLACEHOLDER: Conflict arbiters. When two humans give contradicting corrections: suggested Maxx for process content, Milan for judgment calls. Unconfirmed.
PLACEHOLDER: Data discipline pattern recipient. Who receives pattern observations about consistently missing data entry. Suggested Maxx. Unconfirmed.
PLACEHOLDER: Customer data channel restrictions. Whether any Slack channels or contexts are off limits for customer-specific information.
PLACEHOLDER: Quiet hours and alert batching. Whether Baxter pings outside working hours, and whether multi-issue sync results arrive as a digest or as individual alerts. Twelve separate pings on a Monday morning is how Baxter gets muted in week one.
PLACEHOLDER: Internal permissions. As drafted, every teammate has equal access to everything Baxter knows, including full GHL customer histories. Probably fine at current size, but it should be a deliberate yes from Milan, not a default.
PLACEHOLDER: Estimating owner, code verification owner, and other RACI named roles referenced in the runtime prompt examples. Fill from the finalized RACI matrix.
PLACEHOLDER: Surface path selection (new, from the Claude Tag assessment). L2: Tag as-is with Baxter-as-persona under the @Claude handle, vs. custom Slack app. L3: Tag standing instructions and scheduled tasks vs. external orchestrator vs. hybrid. Pending Jackson's validation, especially the schedule fidelity test.
PLACEHOLDER: Plan and licensing (new). Tag requires Claude Enterprise or Team (reported 10-seat Team minimum); channel usage reportedly bills to the org. Confirm Acton's plan, upgrade cost, and a steady-state monthly estimate for daily monitoring plus team Q&A.
PLACEHOLDER: Legacy migration (new, time-sensitive). Old Claude in Slack app retires August 3, 2026; a secondary source reports the credited opt-in window closed July 23. Confirm status against Anthropic's support article and record the outcome.
PLACEHOLDER: GoHighLevel connector path (new). Not on Tag's published connector list. Custom MCP server vs. generic API configuration via Agent Identity. Jackson to scope.

## 3. Red Flags (design risks, ranked)

RED FLAG: The RACI matrix is not machine-readable and the conversion has no owner. This is the critical path for the entire project and where projects like this typically stall. Stage names must exactly match Buildertrend stage names, deadlines must be durations, required data must be named fields. Needs a named owner and version control from day one, because the selections overhaul will change the matrix within weeks of launch.
RED FLAG: The proactive trigger model does not exist. The runtime prompt covers reactive Q&A (DMs and @mentions) fully, but Phase 1b interjections (schedule maintenance, RACI step completion checks, skipped steps in Buildertrend and GHL, missing data fields) are orchestration-layer behaviors. Each trigger needs a defined condition, check cadence, and output destination. Sits with Jackson's build-vs-buy assessment. The prompt cannot be finalized for Phase 1b without it.
RED FLAG: A large share of the original brief describes orchestration, not prompting. The system prompt can only govern how Baxter responds when the orchestration layer hands him data. Checking GHL fields, running daily syncs, and detecting slippage are pipeline behaviors. Do not expect Phase 1a Baxter to do half of what the brief describes; set expectations with the team accordingly.
RED FLAG: Buildertrend access remains the biggest unknown, per the project brief. The decision ladder (official API, scheduled exports, managed adapter, browser automation last resort) stands. Any login-based pipeline requires its own health monitoring, Milan's explicit ToS sign-off, and least-privilege credentials.
RED FLAG: Garbage in, silence out. Baxter can only flag missing data if data entry discipline exists. If the team is not logging consistently today, Baxter is blind exactly where mistakes currently happen. This is a human process commitment and belongs in the internal comms plan in plain language.
RED FLAG: Alert fatigue kills adoption. False positives erode trust fast. The pilot group, tuning period, and a tracked false-positive metric are mandatory. If Baxter pings wrong or pings too much, the team mutes him within two weeks and the project dies regardless of architecture quality.
RED FLAG: Single-builder scope risk, reduced but live. Claude Tag removes most of the Slack presence and orchestration build, but Jackson still owns Buildertrend access, the GHL connector, the RACI structured-data pipeline, sweep skills, and pipeline health, alone.
RED FLAG: Ambient mode is ungoverned (new). Reporting indicates Tag's proactive ambient behavior has no built-in human approval step and exercises its own judgment about what to flag. If monitoring runs ambient rather than as explicit scheduled instructions with the sweep skill as guardrails, the false-positive rate is uncontrolled. The schedule fidelity test decides whether the Tag L3 path is viable.
RED FLAG: Standing-instruction drift (new). In Tag, anyone in a channel can steer the agent, including handing it standing behaviors. Without discipline, Baxter accumulates ad hoc standing orders that diverge from the approved instruction set. Mitigations now in the runtime prompt (route standing requests to change control; confirm running version on request) and in Tag's audit view, which lists every scheduled and one-time task for review.
RED FLAG: Beta volatility (new). Tag's capabilities, pricing, and behavior can change during beta. Mitigations: pilot channel isolation, nothing customer-facing, and unselected build paths documented as fallback rather than discarded.
RED FLAG: Budget and timeline are unscoped. Continuous monitoring has real per-token and per-service costs. A cost ceiling and a Phase 1a target date must be set before the build is scoped.
RED FLAG: Post-launch ownership is unassigned. Knowledge hygiene, alert tuning, and maintenance need a named owner, presumably Jackson. Make it explicit.
RED FLAG: Persona constraint (updated). Under the Tag path the bot displays as @Claude with no documented rename; Baxter exists as persona through channel instructions. If the display name is a hard requirement for the team, that forces the custom-app path and its full build cost. Decide with eyes open.

## 4. Roles

Jackson Bridges. Build lead. Technical assembly, integrations, build-vs-buy per layer, deployment.
James Parks. Prompt author and refinement. Internal comms plan. AI tooling strategy support.
Milan Romic. Vision owner. RACI review. ToS and security sign-off. Final approval.
Maxx Kimbler. RACI matrix owner. Data source inventory. Process change management.
PLACEHOLDER: RACI machine-readable conversion owner. Unassigned.
PLACEHOLDER: Baxter post-launch owner. Unassigned.

## 5. Instruction Change Control

PLACEHOLDER: Structure below is suggested and unconfirmed by the team.
Authorized updaters, by domain:
Milan Romic: final approval on any change to precedence order, scope boundaries, or confidentiality. No change to those sections ships without his sign-off.
Maxx Kimbler: process content, driven by RACI and data mapping changes. Selections overhaul is the first test.
Jackson Bridges: technical behavior, trigger conditions, alert mechanics, pipeline health rules.
James Parks: tone, persona, examples, communication formats, document structure.
Update procedure:
Proposer drafts the change as a marked-up copy of the runtime prompt with a one-line rationale.
Domain owner reviews. Cross-domain changes require both owners. Precedence, scope, or confidentiality changes require Milan.
Approved version gets a version number and date. Prior versions retained.
Jackson deploys (under the Tag path: updates the channel instructions, skills, and standing tasks). Baxter confirms in the ops channel which version he is running, and Tag's audit view is reviewed to verify no unapproved standing tasks exist.
No verbal updates, no Slack-message updates, no exceptions. If it is not in the versioned document, it is not an instruction.

## 6. Phase Gating

The runtime prompt is written to be valid across phases; monitoring behaviors simply have no data to act on until the orchestration layer feeds them. Gate order:
Phase 1a (Knowledge Teammate): under the Tag path, a private pilot channel with the runtime prompt as channel instructions and the knowledge base via the Drive connector. Reactive Q&A only. No Buildertrend dependency.
Phase 1b (Safety Net): activates when the schedule fidelity question is answered, the sweep skill exists, and the Buildertrend access question is resolved. Soft launch with the pilot group; tune the false-positive rate before going wide.
Phases 2 and 3 (Optimizer, Industry News) and shelved Phase 4 remain as scoped in the project brief. Each requires its own prompt additions through change control.

## 7. Success Metric

Zero preventable customer-facing mistake conversations. Measurable reduction in remediation calls and unplanned concessions. Baxter's own performance (alerts sent, acknowledged, acted on, disputed, false-positive rate) tracked via the Domo feedback loop.
