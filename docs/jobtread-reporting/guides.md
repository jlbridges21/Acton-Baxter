# Guides

## 12. Admin user guide

**Reports → Data settings** (`/reports/settings`, admins only):

- **JobTread connection:** status, organization, grant name and expiry, last test. _Test
  connection_ re-verifies the grant. A warning appears if the grant has no action
  restrictions or expires within 21 days.
- **Sync:** cached job/model counts, last runs (records, API calls, duration, errors), _Sync
  now_, and the schedule interval (applies when `JOBTREAD_SYNC_ENABLED=true`).
- **Business fields:** map each business term (Phase, Project Manager, Recommended BR Model,
  Electrical, …) to a JobTread field. Templates and Dexter use these names. Choosing "Not
  mapped" sticks — syncs won't re-map it.
- **JobTread fields & access:** every synced field with its target, type, fill rate, and
  access category. Mark sensitive fields Customer / Financial / Internal, or Excluded.

**Access:** AI Workspace → Agents → Dexter → Access. Grant "Customer details (Reports)" and
"Financial figures (Reports)" to people or departments who need them. Pause Dexter in AI Studio
to stop delegation without taking Reports offline.

**Templates:** open a template and use _Edit layout_ (admins and Dexter managers) to change
it for everyone; employees use _Make a copy_ / _Use template_ to get their own version.

## 13. End-user reporting guide

1. Open **Reports** in the navigation.
2. Start from a template (**Design Handoff**, **Product Library**, **Active Projects**), a
   **Blank report**, or **Create with Dexter**. An empty report offers **Ask Dexter to build
   it** and **Add a widget** (new reports come with two data sources: all JobTread jobs and
   Product Library models).
3. Use the filter bar (phase, project manager, search, ranges, project picker). Filters are in
   the link, so you can bookmark or send a filtered view.
4. Hover charts for exact values; click a bar, slice, or KPI to see the records behind it;
   click a table row for details and **Open in JobTread**.
5. **ⓘ** explains how any number is calculated and which JobTread fields it uses.
6. **Download CSV** on any widget; **Print** for PDF.
7. **Edit layout** to drag, resize, rename, hide, or add widgets; **Save** creates a new
   version. **History** restores any earlier version (nothing is lost).
8. **Share** with people, departments, or roles (view or edit), or with everyone. Each person
   still sees only the data their own access allows. **Pin** keeps a report at the top of your
   Reports page.

## 14. Creating reports conversationally

Open **Create with Dexter** (or ask Baxter in Slack/web: "Have Dexter build a dashboard of
active projects by phase"). Describe what you want in plain language:

- "Show active projects by phase and project manager, with a table I can filter."
- "Compare the ADU models in the Product Library by base price and margin."
- "For one project, show the model, site conditions, utilities, milestones, and documents."

Dexter looks up the available fields, builds the report, checks it against the data, and saves
it as a **private** report that opens automatically. If something you asked for isn't in
JobTread (for example design hours), Dexter tells you instead of inventing it.

## 15. Editing reports conversationally

Open a report and click **Ask Dexter** (bottom right; expand for more room). Dexter knows
which report you're looking at:

- "Change the PM chart to a bar chart and make it full width."
- "Add a filter for city." · "Only show projects in permitting."
- "Add a table of models with square footage." · "Remove the average margin card."
- "Why does this say 4 projects?" (Dexter explains using the report's real calculations.)

Each Dexter change is a new version titled with what changed; undo it from **History**. Dexter
can only edit reports you can edit — on a view-only report he'll offer to make you a copy.
Save or cancel manual layout edits before asking Dexter to change the report. Use the ↺
(**New conversation**) button in the chat header to start fresh — Dexter reads recent turns as
context, so clearing an old thread avoids stale answers.
