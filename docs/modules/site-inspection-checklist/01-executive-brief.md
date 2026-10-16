# Site Inspection Checklist — Executive Brief

Acton ADU · Baxter module documentation

---

## Objective

The Site Inspection Checklist module lets an Acton field inspector run a structured site visit from a phone, capture photos and video against each checklist step, and have the resulting video transcribed and summarised automatically. It is a function of the Baxter platform, not a separate application.

It was built to replace **Company Cam**, which cost roughly **$50 per user per month**. Beyond the licence cost, Company Cam gave Acton photos organised by project but not by checklist step, no structured answers, no transcription, and no connection to the rest of Acton's systems.

## What it produces

For each site visit:

- A **completed checklist** — every step marked done or not, with the inspector's typed notes and structured answers to sub-questions
- **Photos and video filed against the specific checklist step** they belong to, not dumped into a project folder
- A **transcript of every video**, with timestamps
- An **AI summary per checklist item that has video**, grounded strictly in what was said aloud and typed — it is forbidden from inventing findings
- A **cover image**, either the designated cover photo or a Street View image of the address fetched automatically
- **Exports** — a zip of all media named by section and item, and a PDF report

## How it works

An inspector opens Baxter on their phone, picks a project and a checklist template, and starts. The app can be installed to the home screen and runs full-screen like a native app.

For each step they see the step title, internal guidance written for inspectors, a completion checkbox, a notes field, any sub-questions, and buttons to take a photo, record video, or attach a file.

**Capture never waits for upload.** A photo or video is copied into on-device storage the moment it is taken and queued. Uploads run one at a time in the background. They survive a page reload, the phone locking, the app being backgrounded, and losing signal — a resumable upload continues from where it stopped rather than restarting. The inspector keeps working.

When the inspection is marked complete, a background job extracts the audio from each video, transcribes it, and writes a short summary for every checklist item that has video. The inspector does not wait for this; they see progress and can leave.

## What it depends on

Supabase for data and file storage, OpenAI for transcription and summaries, Google Street View for cover images, and ffmpeg for audio extraction and video conversion. Everything runs inside Baxter's existing authentication and background job queue.

## What was hard

The honest answer is **uploading large video from a job site**, and the history is instructive. The current design is the result of fixing a sequence of real field failures: a duplicated authorisation header, a storage permission that rejected the inspector's own session, a project-wide upload size limit that rejected large files, a race where a late write resurrected a finished upload at zero per cent, and a resume identifier collision that could let two same-sized videos resume into each other.

Each fix is recorded as a decision in the [ADRs](./05-adrs.md). The reason to read them before changing the upload path is that most of the obvious simplifications were tried and failed in the field.

The second hard problem was **video that would not play**. iPhone video often lands in a container format that Safari plays and Chrome refuses, showing a grey player. Videos are now converted on the server without re-encoding, so quality is unchanged and they play everywhere.

## What it costs

Transcription and summarisation run once per completed inspection. Audio is extracted and compressed before transcription, so the cost scales with how much video was recorded rather than its file size. Summaries use a small, inexpensive model.

**No cost is currently monitored.** See below.

## What must be resolved

The full list with severity is in the [Specification](./02-specification.md#gaps-to-resolve).

**1. No owner is named.** Nobody is accountable for the checklist content, the AI summary quality, the cost, or the gaps below. This blocks the rest, because every other item needs someone to own it.

**2. Any signed-in Baxter user can complete or delete any inspection.** There is no role check on either. A field inspection represents a site visit that cannot be repeated without sending someone back to the property, and deletion is available to everyone with a login.

**3. There is no storage size limit.** The cap was deliberately removed so large field videos would stop being rejected, which was the right call for the field. The consequence is that nothing now bounds how much any user can upload. Storage growth is not monitored and there is no retention policy — deleted inspections are hidden, not purged, and their video stays.

**4. AI summary quality is unmeasured.** The summaries are explicitly instructed to use only what was said and written, and the module detects and repairs one specific known failure. But nobody has compared a set of summaries against what an inspector would have written. The summaries are presented as read-only reference, which limits the risk, but the accuracy is unknown.

**5. Nothing is monitored.** Upload failure rate, transcription failure rate, AI job failures, and storage growth are all recorded in the database and none of them alert. The [Runbook](./08-runbook.md) has the queries to check them by hand.

**6. The module depends on ffmpeg being present at runtime.** Audio extraction and video conversion both shell out to it. If it is unavailable in a deployment, transcription fails and some videos stay unplayable in Chrome. This is not currently checked at startup or surfaced in diagnostics.

---

The complete specification, with every behaviour and every gap marked in place, is in the companion document.
