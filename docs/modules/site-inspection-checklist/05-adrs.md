# Site Inspection Checklist — Architecture Decision Records

An ADR records a significant decision and why it was made, so someone later can tell a deliberate choice from an accident.

**This module's ADRs are unusually important.** Most of the upload pipeline's design exists because a simpler version failed in the field, and the simplifications are tempting precisely because the reasons are not visible in the code's shape. Several of these are reconstructed from migration comments and code comments written at the time of the fix, which makes them unusually well evidenced.

---

## ADR-001 — Each inspection freezes its own copy of the checklist

**Status:** Accepted · Explicit in the database comments

**Context.** Templates are editable and inspections are historical. Reading structure from the live template at display time is the obvious approach.

**Decision.** At create time, deep-copy the entire template into the inspection's `snapshot_json` with **fresh identifiers**. Responses, media, and summaries all key off snapshot identifiers. The original template identifiers are kept as provenance and never used for lookup.

**Why.** The migration comment is unambiguous: structure lives in the snapshot _"so template edits cannot mutate past visits."_ Without it, adding a checklist item in November would make a September inspection appear incomplete, and rewording an item would change what a past inspector appeared to have answered. A site inspection is evidence of what was checked on a particular day.

**Consequences.** Templates can be edited and archived freely. An existing inspection cannot pick up a template improvement. Structure is duplicated per inspection, which costs storage and is the correct trade for a historical record. Every lookup must be careful never to resolve a snapshot identifier against the live template.

---

## ADR-002 — Templates are archived, never deleted

**Status:** Accepted · Explicit in the database comments

**Decision.** `inspection_templates.archived_at` soft-deletes. The structure stays readable.

**Why.** Even with snapshots, a template's identity is referenced as provenance, and someone reviewing an old inspection may want to know what the template was called and how it has since changed. The comment says it directly: archive _"instead of hard-delete so past inspections stay meaningful."_

**Consequences.** The template list must filter archived rows everywhere. Names are unique only among active templates.

---

## ADR-003 — The upload queue persists Blobs in IndexedDB, not ArrayBuffers and not File handles

**Status:** Accepted · Two field bugs, both recorded in code comments

**Context.** An inspector captures several large videos on a phone, then the page reloads, the phone locks, or the app is backgrounded.

**Decision.** On capture, copy the file **once** into a fresh Blob, detaching from the input element, and persist that Blob in IndexedDB. Do not keep the intermediate ArrayBuffer on the queue entry.

**Why — two separate failures:**

1. **The live `File` handle went stale on iOS.** Holding the handle from the input element and uploading later failed with no useful error. Copying once at capture time fixes it.
2. **Resident ArrayBuffers pinned hundreds of megabytes in memory** and triggered Safari IndexedDB connection reclaim under several large videos. Safari keeps IndexedDB Blobs disk-backed, so storing Blobs keeps the bytes off the JavaScript heap.

**Consequences.** One full copy of every captured file at capture time, which is the cost of durability. Legacy queue rows carrying `bytes` are migrated on read. Anyone "optimising" this back to an ArrayBuffer will reintroduce the memory failure, and it will only show up on a phone with several large videos.

---

## ADR-004 — One upload at a time

**Status:** Accepted · Explicit in `media-limits.ts`

**Decision.** `MEDIA_UPLOAD_CONCURRENCY = 1`.

**Why.** Two reasons, both stated in the code. Parallel transfers on a phone share one connection and were **slower in the field**. And overlapping progress writes **could resurrect a finished upload at 0%**.

**Consequences.** A backlog of videos uploads serially. On a job site that is the right trade — the inspector keeps working and the queue drains in the background.

---

## ADR-005 — Three separate concurrency defences in the queue

**Status:** Accepted · Each from an observed failure

**Context.** Progress callbacks fire frequently, IndexedDB writes are asynchronous, and the user can cancel or retry mid-flight.

**Decision.** Three mechanisms, each addressing a different race:

1. **A per-entry write lock.** A progress callback snapshots a row, then awaits IndexedDB. Without the lock that stale snapshot commits _after_ finalize deleted the row, **resurrecting a finished upload at 0%**. The code carries a test seam that deliberately delays the commit to reproduce this.
2. **A generation counter**, bumped by Retry all, so superseded handlers cannot corrupt state.
3. **A cancelled-identifier set**, so a cancelled upload is not re-queued or marked failed by a handler already in flight.

**Why.** Each was a real bug. The first is the one users noticed: an upload reaching 100% and then restarting at 0%.

**Consequences.** The queue is harder to read than it looks like it should be. All three must survive any refactor. The tests that cover them — the resilience, scope, and restart suites — are the ones to run first after touching this file.

---

## ADR-006 — Signed URLs for video, after resumable uploads failed on authorisation

**Status:** Accepted, then partially reversed · Explicit in migration 049

**Context.** Large field video needs resumable upload. The first implementation used TUS with the user's session token.

**Decision, as recorded in migration 049:** switch video to signed URLs, the same path as photos, _"because TUS Authorization is unreliable in this client (Invalid Compact JWS)."_ The same migration **removed the bucket size limit** so field videos would stop being rejected, and **deleted orphaned `pending` and `uploading` rows** that had been created at enqueue time before bytes landed, which showed as phantom "Uploading 0%" on other devices.

**History worth knowing.** The route to that state included a duplicated `Authorization` header producing `Bearer x, Bearer x`, a storage RLS policy that rejected user tokens while the service role worked (fixed by migration 048's own-prefix policies), and a project-wide upload limit that had to be raised in the Supabase dashboard rather than in a migration. The token normaliser in `media-limits.ts`, which strips an accidental `Bearer` prefix and requires three JWT segments, is a direct descendant of that episode.

**Current state.** Resumable upload machinery remains — `tus-js-client`, the 6 MiB chunk size, and the stored resume location — and the queue keeps `tusUploadUrl` so a retry continues at the server's offset. The authorisation path is what changed.

**Consequences.** Anyone revisiting the upload transport should read this and migration 049 first. The constraint that Supabase requires **exactly** 6 MiB chunks is absolute; any other value fails.

---

## ADR-007 — Media type is inferred from the file, never from the button

**Status:** Accepted · Explicit in `media-limits.ts`

**Decision.** `inferInspectionMediaType` reads the MIME type first, then the extension. The code says: _"Do not infer from which button was pressed — Attach file accepts both."_

**Why.** The interface has separate Take photo, Record video, and Attach file controls. Attach file accepts either kind, so trusting the button would misfile anything attached, and a misfiled video is never transcribed.

**Consequences.** A file with no usable MIME type and an unrecognised extension is rejected rather than guessed at.

---

## ADR-008 — No size caps on upload

**Status:** Accepted · Explicit product direction

**Context.** Client-side caps on video size and duration rejected legitimate field recordings.

**Decision.** Remove them. The bucket limit was removed in migration 049; the client constants remain only as deprecated numbers so older call sites still read something. What is left is a **soft warning**, not a reject: large videos take a while on cell signal, keep the app open, it will resume.

**Why.** This was explicit direction during development: no size cap on uploads. A rejected recording means a wasted site visit, which costs far more than storage.

**Consequences.** Nothing bounds how much any user can upload, and nothing monitors storage growth. That is gap 3 in the [Specification](./02-specification.md#gaps-to-resolve). The decision is right for the field; the missing monitoring is the part to fix, not the cap.

---

## ADR-009 — QuickTime video is remuxed, never re-encoded

**Status:** Accepted · Explicit in `video-remux.ts`

**Context.** iPhone H.264 often lands in a classic QuickTime `qt  ` brand container. Safari plays it; **Chrome on desktop refuses** — grey player, 0:00, disabled play button.

**Decision.** Remux to MP4 with `-c copy` and `+faststart`. A container change only, with no re-encoding.

**Why.** Re-encoding would lose quality on footage that is site evidence, and would cost far more processing. Stream-copy fixes playback and leaves the video bit-identical.

**Consequences.** ffmpeg is required at runtime. `+faststart` also means the video starts playing before the whole file downloads, which matters for long recordings.

---

## ADR-010 — Audio is extracted before transcription

**Status:** Accepted · Explicit in `audio-extract.ts`

**Decision.** Extract mono 16 kHz MP3 with ffmpeg and send only that for transcription. If the result still exceeds the 25 MB limit, re-encode at 32 kbps and try again. If it is still too large, fail with an explicit message.

**Why.** The transcription upload limit is 25 MB. A field video easily exceeds that while its speech content is a fraction of the size. Extraction makes transcription possible at all, and makes the cost scale with recording duration rather than video resolution.

**Consequences.** ffmpeg is required. A video with no audio track is detected and marked, not retried. A recording long enough to exceed 25 MB even at 32 kbps — roughly two hours — cannot be transcribed.

---

## ADR-011 — Summaries are gated on terminal transcripts

**Status:** Accepted · Explicit in `transcript-gate.ts`

**Context.** Summaries are generated per checklist item after transcription. Transcription is per video and finishes at different times.

**Decision.** An item is summarised only when **every** one of its videos has reached a terminal transcript state: `complete`, `no_speech_detected`, or `failed`. All three are terminal — a video with no speech is a legitimate result, not a retry condition.

**Why.** A summary written while a transcript was still processing would say nothing was said, and then persist as though that were true.

**Consequences.** Summarisation waits for the slowest video on each item. The specific failure this prevents happened anyway, before the gate existed, which is why ADR-012 exists.

---

## ADR-012 — The premature-empty summary repair is permanent machinery

**Status:** Accepted · Explicit in `transcript-gate.ts`

**Context.** Summaries generated before the gate existed say _"no spoken content or notes were available"_ and **stay wrong**, because the fingerprint may legitimately match the empty snapshot they were generated from. The normal staleness mechanism cannot see them.

**Decision.** Detect a summary whose text matches that boilerplate while at least one of the item's videos has usable speech, and treat it as stuck **regardless of fingerprint**. On regeneration, pass a flag that explicitly forbids the empty-input phrasing.

**Why.** The failure is invisible to a user who does not know the transcript exists. Fingerprint-based staleness is the right general mechanism and genuinely cannot catch this case.

**Consequences.** A bug fix carried as permanent machinery, including boilerplate-matching regular expressions that will need updating if the model's phrasing changes. It is correct to keep: the check is cheap and the failure is silent. It is worth knowing it is there, and worth deleting once no affected summaries remain.

---

## ADR-013 — Street View metadata is checked before the image is requested

**Status:** Accepted · Explicit in `street-view-cover.ts`

**Decision.** Query the metadata endpoint first. Only request the image when coverage exists. Cache the JPEG once per address. List cards read the stored object and **never call Google**.

**Why.** The image endpoint returns a grey tile rather than an error when there is no coverage, and _"we never want that on a card."_ Caching also keeps a list of fifty inspections from making fifty API calls.

**Consequences.** Two calls at create time instead of one. Coordinates from autocomplete are preferred over the address string, avoiding a geocoding round trip. A background backfill job exists for inspections created before covers did.

---

## ADR-014 — The PWA manifest is scoped to `/inspections`

**Status:** Accepted · Explicit in the manifest route

**Decision.** Serve a manifest whose `scope` and `start_url` are `/inspections`, linked only from the inspections layout.

**Why.** Installing from the inspections page should launch standalone into inspections _"without hijacking the rest of Baxter."_ An inspector wants a field tool on their home screen, not the whole platform.

**Consequences.** On iOS a standalone app has its own cookie jar separate from Safari, so the inspector signs in once inside the installed app. Other Baxter tools can install their own scoped manifests independently — Receipt Log follows the same pattern.

---

## Decisions not recorded

Honest gaps. Questions a future engineer will ask that this folder cannot answer:

- Why 8 upload attempts, and why those specific stall timeouts. They look like reasonable field-tuned values; whether they were measured or estimated is not recorded.
- Why the zip export threshold is 200 MB. The code acknowledges large videos will hit it often, so it reads as provisional.
- Why `gpt-4o-mini` is the hardcoded summary fallback rather than Baxter's configured default.
- Whether the twelve sections and thirty-one items of the Detached ADU checklist were derived from an existing paper form. **This is the most consequential undocumented decision in the module** — it is Acton's field methodology encoded as a schema, and it should be recorded by whoever owns the checklist content.
