# Site Inspection Checklist — Operations Runbook

For whoever is on call, and for the module owner's monthly health review.

> **Nothing in this module is monitored or alerted.** Every check below is manual. Automating them is gap 5 in the [Specification](./02-specification.md#gaps-to-resolve).

> **Field-first rule.** Most reports about this module come from an inspector on a job site. Before debugging, ask three questions: which phone, cell signal or wifi, and was the app installed to the home screen or opened in a browser. The answer usually narrows it immediately.

---

## Quick reference

| Symptom                                        | Most likely cause                                  | Go to                                           |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Upload stuck at 0% or not progressing          | Signal, stall timeout, or a wedged queue           | [§1](#1-an-upload-is-stuck)                     |
| Upload reached 100% then restarted             | The resurrection race — should be fixed            | [§2](#2-an-upload-restarted-after-reaching-100) |
| "Sign in again to upload video"                | Session token malformed or expired                 | [§3](#3-sign-in-again-to-upload-video)          |
| Video shows a grey player at 0:00              | QuickTime container, remux did not run             | [§4](#4-a-video-will-not-play)                  |
| No transcripts after completing                | AI job failed, or ffmpeg or the API key is missing | [§5](#5-no-transcripts-or-summaries)            |
| Summary says "no spoken content" but there was | Premature-empty summary                            | [§6](#6-a-summary-claims-nothing-was-said)      |
| Grey tile on a list card                       | Street View metadata check bypassed                | [§7](#7-a-card-shows-a-grey-tile)               |
| Zip export fails or omits video                | Over the 200 MB threshold                          | [§8](#8-zip-export-problems)                    |
| Inspection deleted by mistake                  | Soft delete — recoverable                          | [§9](#9-an-inspection-was-deleted)              |

---

## 1. An upload is stuck

**First, establish whether it is actually stuck.** One upload runs at a time by design, so a queue of videos drains serially. A 500 MB video on weak cell signal legitimately takes a long time.

**On the device.** The upload bar shows per-item progress. After 3 minutes with no progress the interface surfaces a stall and offers **Retry all** — that is the first thing to try, and it resumes from the server's offset rather than restarting.

**Server side:**

```sql
select id, inspection_id, snapshot_item_id, media_type, upload_status,
       upload_progress, byte_size, created_at,
       now() - created_at as age
from public.site_inspection_media
where upload_status in ('pending', 'uploading')
  and created_at < now() - interval '1 hour'
order by created_at;
```

**Rows that are old and still `pending` or `uploading` are usually orphans** — the device that created them is gone. The bytes are not recoverable; the inspector must retake that media. Note which checklist step so you can tell them exactly what to retake; the step label is in the snapshot.

**If it is widespread**, check Supabase storage health and whether the project-wide upload limit was changed. That limit lives in the Supabase dashboard, not in a migration, and has caused this before.

---

## 2. An upload restarted after reaching 100%

**This is a known bug class that should be fixed.** If it recurs, treat it as a regression, not a one-off.

The cause was a progress callback snapshotting a queue row, awaiting IndexedDB, and committing that stale snapshot after finalize had deleted the row. Three defences now prevent it: a per-entry write lock, a generation counter bumped by Retry all, and a cancelled-identifier set. See [ADR-005](./05-adrs.md#adr-005).

**If you see it again:** capture which device and whether Retry all or a cancel was involved, then run

```bash
npx vitest run tests/unit/site-inspection-upload-restart.test.ts \
               tests/unit/site-inspection-media-queue-resilience.test.ts
```

Those suites exist specifically for this failure. A passing suite with a live recurrence means a new path bypasses one of the three defences.

---

## 3. "Sign in again to upload video"

The token normaliser rejected the session token: it was not three dot-separated segments after stripping any `Bearer` prefix.

**Usual cause:** an expired session in the installed app. On iOS the standalone app has its own cookie jar separate from Safari, so signing in to Safari does **not** fix the installed app. The inspector must sign in inside the installed app.

**Do not log the token.** `redactAuthorizationForLog` and `redactApiKeyForLog` report structure only — prefix count, segment count, length — which is what you need to diagnose this and all you should ever record.

---

## 4. A video will not play

**Grey player, 0:00, disabled play button, in desktop Chrome** is the QuickTime container case. iPhone H.264 often lands in a `qt  ` brand container that Safari plays and Chrome refuses.

Videos should be remuxed to MP4 with stream copy on the server. If one was not:

```sql
select id, inspection_id, storage_path, mime_type, byte_size, created_at
from public.site_inspection_media
where media_type = 'video'
  and (storage_path ilike '%.mov' or mime_type ilike '%quicktime%')
order by created_at desc limit 50;
```

**Check ffmpeg is available in the deployment.** Remuxing shells out to it, and if the binary is missing the remux silently cannot run. This is gap 6 — availability is not verified at startup or surfaced anywhere.

**Black thumbnail rather than a grey player** is a missing poster, which is cosmetic. Posters live at `…/id.poster.jpg` beside the video.

---

## 5. No transcripts or summaries

**Check the inspection's AI state:**

```sql
select id, project_name, ai_processing_status, ai_processing_phase,
       ai_processing_message,
       ai_processing_videos_done || '/' || ai_processing_videos_total as videos,
       ai_processing_summaries_done || '/' || ai_processing_summaries_total as summaries,
       ai_processing_started_at, ai_processing_finished_at
from public.site_inspections
where id = '<uuid>';
```

| State                       | Meaning                                     |
| --------------------------- | ------------------------------------------- |
| `idle`                      | Never completed. The job runs on completion |
| `queued`                    | Enqueued, not started                       |
| `processing` + recent start | Working normally                            |
| `processing` + old start    | **Job died. No sweeper exists** — gap 7     |
| `failed`                    | See `ai_processing_message`                 |
| `complete`                  | Finished                                    |

**Per-video detail:**

```sql
select id, transcript_status, transcript_error, byte_size,
       length(transcript_text) as transcript_chars
from public.site_inspection_media
where inspection_id = '<uuid>' and media_type = 'video'
order by created_at;
```

| `transcript_status`                   | Meaning                          | Action             |
| ------------------------------------- | -------------------------------- | ------------------ |
| `complete`                            | Worked                           | —                  |
| `no_speech_detected`                  | **Success.** Genuinely no speech | None. Do not retry |
| `failed`                              | See `transcript_error`           | Below              |
| `pending`/`processing` + job finished | Job died mid-flight              | Re-trigger         |

**Common `transcript_error` values:**

- `OPENAI_API_KEY is not configured` — environment
- `ffmpeg binary unavailable` — gap 6
- `Video has no audio track` — expected for silent recordings
- `Audio still exceeds 25165824 bytes after compression` — a recording roughly over two hours. Not currently recoverable; split the video and re-upload

**To re-trigger:** regenerating a summary re-runs the needed work for that item. The job is idempotent — completed transcripts and matching fingerprints are skipped, so re-running costs nothing and loses nothing.

**Why summaries might be absent while transcripts succeeded:** summaries are gated on **every** video for an item reaching a terminal state. One video still processing holds back that item's summary. That gating is deliberate — see [ADR-011](./05-adrs.md#adr-011).

---

## 6. A summary claims nothing was said

If the summary reads "no spoken content or notes were available" but the video has speech, it is a **premature-empty summary** — generated before transcripts were ready, and stuck because its fingerprint legitimately matches the empty snapshot it came from.

The module detects this regardless of fingerprint and the repair is to regenerate; the regeneration prompt carries a flag explicitly forbidding that phrasing. See [ADR-012](./05-adrs.md#adr-012).

**Find affected summaries:**

```sql
select s.id, s.inspection_id, s.snapshot_item_id, s.summary_text, s.generated_at
from public.site_inspection_item_summaries s
where s.status = 'complete'
  and s.summary_text ilike '%no spoken content%'
order by s.generated_at desc;
```

Cross-check each against whether its item's videos actually have transcript text. If this appears on **recently generated** summaries, the gate is not working and that is a regression worth investigating rather than repairing one by one.

---

## 7. A card shows a grey tile

Street View returns a grey tile rather than an error when there is no coverage, which is why the metadata endpoint is checked first. A grey tile on a card means that check was bypassed or the stored object is bad.

```sql
select id, project_name, address, street_view_status,
       street_view_storage_path, street_view_captured_on,
       latitude, longitude
from public.site_inspections
where deleted_at is null
order by created_at desc limit 20;
```

`street_view_status` should be `available` or `unavailable`, never null for a recent inspection. **`unavailable` is correct behaviour** for an address with no coverage — the card falls back rather than showing a tile.

Covers are fetched once per address at create time and again if the address changes. List cards read the stored object and never call Google, so a grey tile is not a quota problem. Check `GOOGLE_MAPS_SERVER_API_KEY` if covers stop being fetched for new inspections.

---

## 8. Zip export problems

Above **200 MB** the export offers photos only rather than failing mid-stream. An inspection with substantial video will hit this routinely — gap 8.

```sql
select inspection_id,
       count(*) filter (where media_type = 'photo') as photos,
       count(*) filter (where media_type = 'video') as videos,
       pg_size_pretty(sum(byte_size)::bigint) as total
from public.site_inspection_media
where inspection_id = '<uuid>' and upload_status = 'ready'
group by inspection_id;
```

There is no chunked export path. An inspector needing full video must fetch items individually.

**If the export errors rather than degrading:** `archiver` v8 exports `ZipArchive` as a class, not a callable factory. Calling the old factory throws a `TypeError` that surfaces as a generic unexpected error. The route has a comment about this because it happened.

---

## 9. An inspection was deleted

**It is recoverable.** Deletion is a soft delete.

```sql
select id, project_name, address, deleted_at, created_by, created_at
from public.site_inspections
where deleted_at is not null
order by deleted_at desc limit 20;
```

Restore by clearing `deleted_at`. Media rows and storage objects are untouched by a soft delete.

> **Any signed-in Baxter user can delete any inspection — there is no role check.** This is gap 2. A site inspection records a visit that cannot be repeated without sending someone back to the property, so this is the gap most likely to cause real loss. Until it is fixed, the soft delete is the only thing standing between a mis-click and a lost site visit.

---

## Monthly health review

**1. Upload health.**

```sql
select date_trunc('week', created_at) as week,
       count(*) filter (where upload_status = 'ready') as ready,
       count(*) filter (where upload_status = 'failed') as failed,
       count(*) filter (where upload_status in ('pending','uploading')) as stuck
from public.site_inspection_media
where created_at > now() - interval '90 days'
group by 1 order by 1 desc;
```

`stuck` should fall to near zero for any week older than a day.

**2. Storage growth — the one with no ceiling.**

```sql
select date_trunc('month', created_at) as month,
       count(*) as files,
       pg_size_pretty(sum(byte_size)::bigint) as bytes,
       pg_size_pretty(sum(byte_size) filter (where media_type = 'video')::bigint) as video_bytes
from public.site_inspection_media
where upload_status = 'ready'
group by 1 order by 1 desc;
```

There is no size limit and no retention policy, so this only ever grows. Compare against the Supabase plan's storage allowance and the cost per gigabyte. **This is the number most likely to produce an unwelcome surprise.**

**3. Transcription health.**

```sql
select transcript_status, count(*)
from public.site_inspection_media
where media_type = 'video' and created_at > now() - interval '90 days'
group by 1 order by 2 desc;
```

`no_speech_detected` is a success. A rising `failed` count warrants reading the errors.

**4. Stuck AI jobs.**

```sql
select id, project_name, ai_processing_status, ai_processing_phase,
       ai_processing_started_at, now() - ai_processing_started_at as stuck_for
from public.site_inspections
where ai_processing_status in ('queued','processing')
  and ai_processing_started_at < now() - interval '2 hours'
order by ai_processing_started_at;
```

Should be empty. No sweeper exists — gap 7.

**5. Premature-empty summaries.** Query in §6. Should be zero and stay zero.

**6. Export the live templates** to this folder. They are editable database rows and are not in version control. The query is in the [Code Reference](./03-code.md#extracting-a-complete-current-bundle).

---

## Incident severity

| Severity   | Example                                                                                                              | Response                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **High**   | Field media lost or unrecoverable; an inspection deleted and not recoverable; uploads failing company-wide mid-visit | Stop field use of the affected path and tell inspectors to keep media on their device. Postmortem required |
| **Medium** | Transcription failing for all inspections; video unplayable in Chrome; storage approaching plan limits               | Fix within the working day                                                                                 |
| **Low**    | One stuck upload; one failed transcript; a missing poster                                                            | Fix when convenient. Note if it recurs                                                                     |

A high-severity incident gets a blameless postmortem. For this module, the postmortem should always answer one extra question: **did any inspector lose work, and did anyone have to return to a site?** That is the real cost, and it is the one worth preventing.
