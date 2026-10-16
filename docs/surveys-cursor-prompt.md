# Build the Surveys tool in Baxter

Add a new Baxter tool called **Surveys**: a Google Forms / BambooHR-style survey builder for internal feedback (meetings, processes, tools). Any Baxter user can create a survey, share a public link with anyone (inside or outside Acton ADU), and view analytics on the responses.

Before writing code, read `AGENTS.md`. This repo uses Next.js 16.2 with breaking changes, so check `node_modules/next/dist/docs/` for any API you use (route handlers, `params` as a Promise, middleware, server actions). Match existing patterns rather than inventing new ones. The closest references are:

- **Builder UX and drag-to-reorder:** `src/components/inspections/template-editor-client.tsx`, `templates-list-client.tsx`, `template-item-modal.tsx` (uses `@dnd-kit`)
- **API route style:** `src/app/api/inspections/**` (`requireActiveUser`, `jsonOk`/`jsonError`, zod schemas, `NotFoundError`/`ValidationError`)
- **PDF export:** `src/app/api/inspections/[id]/export-pdf/route.ts` and `src/lib/inspections/ai/export-pdf` (`@react-pdf/renderer`)
- **Public, unauthenticated pages:** `src/lib/tours/public-paths.ts`, `src/middleware.ts`, `src/app/tour/[slug]/page.tsx`
- **Tool registration and nav:** `src/lib/baxter/tools.ts`, `src/lib/baxter/app-nav-links.ts`
- **Roles:** `src/lib/auth/roles.ts` (`isAdminRole`), `src/lib/auth/session.ts`
- **Slack:** `src/lib/slack/client.ts` (`postSlackMessage`)
- **Migrations:** `supabase/migrations/` (the next file is `065_surveys.sql`)

---

## 1. Data model (Supabase migration `065_surveys.sql`)

Follow the conventions in existing migrations (uuid PKs, `created_at`/`updated_at`, RLS enabled, indexes on FKs).

**`surveys`**

- `id`, `title` (required), `description` (nullable)
- `public_token`: unique, unguessable (`nanoid`, ~21 chars), used in the share URL
- `display_mode`: `'all_on_one_page' | 'one_at_a_time'`, default `'all_on_one_page'`
- `identity_mode`: `'anonymous' | 'name_optional' | 'name_required'`, default `'name_optional'`
- `created_by` (FK profiles), `created_at`, `updated_at`, `deleted_at` (soft delete)

**`survey_questions`**

- `id`, `survey_id`, `position` (int), `prompt` (required), `help_text` (nullable)
- `type`: `'star_rating' | 'text' | 'dropdown' | 'multi_select'`
- `required` (bool, default false)
- `options`: jsonb array of `{ id: string, label: string }` (used for dropdown and multi-select). Answers reference option `id`, so renaming a label never orphans existing answers.
- `archived_at`: a question removed after it has responses is archived, not hard-deleted, so historical answers survive

**`survey_responses`**

- `id`, `survey_id`, `submitted_at`
- `respondent_user_id` (nullable FK profiles)
- `respondent_name`, `respondent_email` (nullable)
- For `anonymous` surveys, **never** store user id, name, or email, even when a logged-in Baxter user responds.

**`survey_answers`**

- `id`, `response_id`, `question_id`
- `rating_value` (int 1–5, nullable), `text_value` (nullable), `option_ids` (text[], nullable)
- Use a CHECK constraint so `rating_value` stays between 1 and 5

RLS: authenticated active users can read all non-deleted surveys, questions, responses, and answers. All anonymous public reads and writes go through server route handlers that use the service-role client. Do not open table access to `anon`.

## 2. Permissions

- **Any active Baxter user** can create a survey, view the list, view analytics and individual responses, export PDF/CSV, duplicate any survey, and share to Slack.
- **The creator or an admin** (`isAdminRole`) can edit a survey, delete a survey (soft delete), and delete individual responses. Enforce this on the server in every mutating route, and hide or disable those menu items in the UI for everyone else.
- **Anyone with the link** (no login) can open and submit the public survey.

## 3. Internal pages (authenticated)

### `/surveys`: list page

- Header reads "Surveys", with a primary **New Survey** button in the top right.
- The table or list shows title, creator, response count, last response date, and created date. Sort newest first. Add a simple search by title.
- Each row has a **pencil icon** (edit; shown only to the creator or an admin) and a **three-dot menu** with:
  - **Responses & Analytics** → `/surveys/[id]/responses`
  - **Copy link** (copies the public URL and shows a toast)
  - **Open survey** (opens the public link in a new tab)
  - **Share to Slack**
  - **Duplicate** (copies the survey settings and active questions, with new option ids, a new token, the title "Copy of …", and the current user as creator, then opens the editor)
  - **Delete** (creator/admin only, with a confirm dialog that warns the responses will be hidden)
- Show an empty state that offers to create a first survey.

### New Survey flow

Clicking **New Survey** opens a dialog that asks for a title (required) and a description (optional). On create, go to `/surveys/[id]/edit`.

### `/surveys/[id]/edit`: builder

- Editable title and description at the top.
- A **Settings** panel with:
  - **Display:** "All questions on one page" or "One question at a time"
  - **Responses:** "Anonymous", "Ask for name (optional)", or "Require name"
- A question list with drag-to-reorder (`@dnd-kit`, matching the inspection template editor). Each question card has:
  - The prompt, optional help text, a type selector (1–5 Star Rating, Open Text, Dropdown, Multi-select), and a **Required** toggle
  - For Dropdown and Multi-select, an options editor where you can add, rename, reorder, and remove options. Dropdown gets a **"Yes / No / N/A" quick-fill** button.
  - Duplicate-question and delete-question actions
- **Add question** button at the bottom.
- A **Preview** button that renders the public respondent view in a new tab or modal.
- After the first save, show a **share bar** with the full public URL, a **Copy link** button, and **Share to Slack**.
- Save behavior: an explicit **Save** button with an unsaved-changes guard, or autosave matching `src/lib/inspections/client-autosave.ts`. Pick whichever matches the template editor.
- **Editing after responses exist:** allow it, but show a banner that says "This survey has N responses. Changes apply to new responses." Removing a question that has answers archives it. Changing a question's type when answers exist must be blocked, with a message telling the user to add a new question instead.
- Validation (zod, shared by client and server): title required; each question needs a prompt; dropdown and multi-select need at least 2 options with non-empty, unique labels; a survey needs at least 1 question before the link is usable.

### `/surveys/[id]/responses`: analytics

Show a header with the title, response count, and the actions **Download PDF**, **Download Excel**, **Copy link**, and **Edit** (creator/admin only).

The page has two tabs, **Summary** and **Individual**.

**Summary tab:** one card per question, in order. Archived questions that have answers go in a "Removed questions" section at the bottom.

- **Star rating:** a large average (one decimal) with stars, the answer count, a 1–5 distribution bar chart with count and %, and an expandable list of individual ratings. Each rating shows the respondent name and date unless the survey is anonymous.
- **Open text:** a scrollable list of all answers, each with the respondent (unless anonymous) and date.
- **Dropdown:** a horizontal bar chart of count and % per option, sorted by survey option order, plus "No answer" when the question is optional.
- **Multi-select:** a horizontal bar chart of count per option, with % of respondents and a note that percentages can exceed 100%.
- Build charts as simple accessible SVG/CSS bars (no new chart dependency) using the app's existing Tailwind tokens, so they work in light and dark mode.

**Individual tab:** step through responses one at a time with Prev/Next and "Response 3 of 27". Show the respondent (or "Anonymous") and submitted date, then every question with its answer. Creators and admins get a **Delete response** button with a confirm dialog.

### Exports

- **PDF:** `GET /api/surveys/[id]/export-pdf`, built with `@react-pdf/renderer` and modeled on the inspection export. Include the title, description, generated date, and response count, then each question's summary (average and distribution for stars, counts and bars for choice questions, all text answers). Then add an appendix of individual responses. Omit names when the survey is anonymous. Filename: `<safe-title>-survey-results.pdf`.
- **Excel:** `GET /api/surveys/[id]/export-xlsx`, built with the existing `xlsx` dependency. Write one row per response with the columns Submitted At, Respondent (omitted when anonymous), then one column per question. Multi-select values are joined with "; ".

### Share to Slack

This is a dialog where the user picks a channel and adds an optional message, then posts the survey title, description, and link through `postSlackMessage`. Reuse whatever channel-listing or channel-picker pattern already exists in `src/lib/slack` or the admin Slack pages. If none exists, add a minimal `conversations.list` helper in `src/lib/slack/client.ts` that lists only channels the bot can post to. Handle the "Slack not configured" case gracefully by hiding the option or showing a clear error.

## 4. Public respondent view (no login)

- Route: `/s/[token]` (a short, clean URL for Slack and email). Public API: `/api/public/surveys/[token]` (GET definition) and `/api/public/surveys/[token]/responses` (POST submit).
- Add `/s/` and `/api/public/surveys/` to the anonymous-path allowlist (generalize `isAnonymousTourPath` into a shared public-path helper rather than duplicating logic), and confirm in `src/middleware.ts` that logged-in users **and** pending-access users can open these paths too.
- This view looks different from the builder: no Baxter app shell or nav, a centered, clean, mobile-first card layout with light Acton ADU branding (reuse `src/lib/branding`), and the title and description at the top.
- **Identity:**
  - **Anonymous:** show a small "Your response is anonymous" note and store nothing identifying.
  - **Name optional / required:** show a Name field and an optional Email field. If the visitor is a logged-in Baxter user, prefill from their profile and store `respondent_user_id`.
- **Display modes:**
  - **All on one page:** every question stacked, with one Submit button.
  - **One at a time:** one question per screen with a progress bar ("Question 2 of 8"), Back/Next, and Submit on the last step. Required-field validation runs per step, and the name step (if any) comes first.
- **Inputs:**
  - Star rating is five large tappable stars with keyboard support (arrow keys) and aria labels.
  - Open text is an auto-growing textarea with a 5,000-character limit.
  - Dropdown is a native-feeling select.
  - Multi-select is a checkbox list.
- Required questions are marked with an asterisk and block submission with inline errors. The server re-validates everything: unknown question or option ids are rejected, ratings must be 1–5, and required answers must be present.
- After submit, show a thank-you screen ("Thanks! Your response was recorded."). Multiple submissions are allowed (no one-response limit in v1).
- An invalid or deleted token shows a friendly "This survey isn't available" page.
- Abuse protection on the public POST: rate-limit by IP with `src/lib/rate-limit.ts`, add a hidden honeypot field, and cap payload size.

## 5. Nav and registration

- Register Surveys in `src/lib/baxter/tools.ts` and `src/lib/baxter/app-nav-links.ts` with a lucide icon (e.g. `ClipboardList`) and a one-line description: "Create surveys, share a link, and see results."
- Add `loading.tsx` files for the new route segments, matching the other tools.

## 6. Code organization

- `src/lib/surveys/`
  - `types.ts`
  - `schemas.ts` (zod: survey, question, submission)
  - `store.ts` (Supabase CRUD)
  - `analytics.ts` (pure functions that turn questions and responses into summaries, shared by the page, PDF, and Excel)
  - `export-pdf.tsx`
  - `export-xlsx.ts`
  - `permissions.ts` (`canEditSurvey(user, survey)`)
- `src/components/surveys/` for the list, editor, question card, options editor, respondent form, analytics cards, and individual-response viewer.
- API routes go under `src/app/api/surveys/**` (authenticated) and `src/app/api/public/surveys/**` (anonymous).

## 7. Tests (vitest, in `tests/unit/`)

- `analytics.ts`: star average and distribution, dropdown and multi-select counts and percentages, "No answer" counts, archived questions, anonymous surveys hiding names, zero responses.
- `schemas.ts`: question validation rules, plus submission validation for required answers, bad option ids, and out-of-range ratings.
- `permissions.ts`: creator vs admin vs other user.
- Public submit route: anonymous survey never persists identity even for a logged-in user; honeypot rejects; unknown token returns 404.
- Excel export column layout.
- Add a Playwright e2e test if the existing e2e setup makes it straightforward. It should create a survey, open the public link, submit, and see the result on the analytics page.

## 8. Verification

Before finishing, run and fix everything until it passes:

```bash
npm run format && npm run lint && npm run typecheck && npm run test && npm run build
```

`npm run build` is required. Also manually verify:

1. Create a survey with all four question types.
2. Copy the link and open it in a private window (logged out), then submit in both display modes.
3. Submit as a logged-in user on an anonymous survey and confirm no identity is stored.
4. Check that the analytics, PDF, and Excel downloads are correct.
5. Confirm a non-creator, non-admin user cannot edit or delete.

## Out of scope for v1

Conditional/branching logic, close dates or open/closed toggles, one-response-per-person limits, file-upload questions, email notifications, and client-facing branding variants.
