# AI Workspace — administrator guide

Everything here is done in Baxter at **AI Workspace** (left menu, or go to `/ai`). No code, files, or GitHub access needed.

> **Who can do what?** Administrators can do everything below. Other people can do only what an administrator grants them on each agent's **Access** tab (for example, an HR lead can be given _Manage_ on Sam).

## See the AI organization

- **AI Office** — the animated office. Click an agent to see who they are and what they're doing right now. Agents only move when they have real work. Use **List** for a plain table, and **Reduce motion** to turn animation off.
- **Agents** — every agent, its department, who it reports to, its AI model, and an org chart.

## Edit Sam's instructions

1. **Agents → Sam → Instructions.**
2. Change any box (tone, responsibilities, rules, what Sam must not do, when to involve a person).
3. Click **Save draft**. A draft is _not live_ — employees still get the current version.
4. Click **Preview changes** to compare with what's live, or **Test draft** to try it.
5. Click **Publish**. It's live immediately in web chat and Slack.

The grey "Protected security rules" box can't be changed — those rules keep Sam from overriding permissions or approvals no matter what the instructions say. If you write something like "skip approval", Baxter will refuse to publish and explain why.

## Update onboarding procedures

1. **Onboarding → templates →** open a template.
2. Edit steps: title, who's responsible, due date (days before/after the start date), required document, "done when", what it depends on, and an optional message template. Use the arrows to reorder.
3. **Save template.** New onboardings use the new steps; ones already in progress keep theirs.
4. The template marked **Placeholder — not official** is a generic starting point. Once it matches Acton's approved SOP, click **Mark as official procedure**.

To track a new hire: **Onboarding → Start onboarding**, pick a template, enter the name, role, and start date. Mark steps done as you go. Sam reads this when someone asks "what's the status of our new hire's onboarding?"

## Add documents Sam can use

1. **Knowledge Hub → Upload.** PDF, Word, Markdown, text, CSV, or Excel.
2. Choose a category, who may see answers from it (**Internal**, **Confidential**, or **Restricted**), and which agents use it.
3. Use **See what an agent would find** to check that Sam finds the right passages.
4. To update a document, use the **Replace** button so Sam always uses the latest version. **Archive** removes it from Sam's answers without deleting it.

Sam only answers policy questions from documents here. If a document is missing, Sam says so instead of guessing.

## Change an agent's AI model

**Agents → (agent) → AI model.** Pick the provider and model. **Test connection** checks the provider without spending anything. Save a draft and publish. Baxter's default ("Deployment default") keeps the current, working setup.

If a provider isn't configured on the server, the agent reports an error rather than quietly switching. You can choose a **Backup model** for temporary outages.

## Replace an avatar

**Agents → (agent) → Overview → Replace portrait.** Choose a PNG, JPEG, or WebP, drag and zoom to crop, and save. **Use default** goes back to the original (Baxter's original portrait is never deleted).

## Test a delegation rule

**Agents → Sam → Delegation.**

- Edit what Sam specializes in, example requests Sam should handle, and similar requests Baxter should keep.
- In **Delegation tester**, type a request, choose the expected agent, and click **Test routing**. You'll see which agent was chosen, why, and whether a typical employee would be allowed.
- **Run all example checks** replays every example and lists any that route the wrong way. Run it after every change.

## Review task results

**Tasks** lists assignments you started or are allowed to review. Open one to see who asked, what Baxter assigned, the result and sources, and a step-by-step log. **Cancel** stops queued or running work; **Retry** re-runs a failed task.

**Mission Control** summarizes active and failed work, approvals waiting, and estimated AI cost by model.

## View approvals

**Approvals** shows drafts and review requests. You can edit a draft, **Approve** it (then copy it and send it yourself — Baxter does not send email yet), or **Reject** it.

## Control who can use Sam

**Agents → Sam → Access.** Grant a person, a department, or everyone:

| Permission           | Means                                 |
| -------------------- | ------------------------------------- |
| Ask through Baxter   | Baxter may hand their requests to Sam |
| Chat directly        | They can open Sam's own chat          |
| Restricted documents | Answers may use Restricted documents  |
| Review activity      | They can read Sam's task records      |
| Approve actions      | They can approve Sam's drafts         |
| Manage agent         | Everything above, plus editing Sam    |

Sam starts with **administrators only**. People without access who ask Baxter an HR question get a polite message.

## Add another agent

**Agents → New agent** walks through name and role, department and manager, responsibilities, instructions, model, knowledge and tools, delegation examples, and access. **Save as draft & test** keeps it switched off while you test it on its **Test** tab; **Create and activate** turns it on. New integrations (for example BambooHR) need engineering work before they appear as tools.

## Customize the office

**AI Office → Customize office:** layout, theme, room names, the meeting room, and the "future departments" space. Move an agent's desk from its **Overview** tab.

## Undo a change

**Agents → (agent) → History** lists every version. **Compare with live** shows what changed; **Restore** brings an old version back as the live one.
