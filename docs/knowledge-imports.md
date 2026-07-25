# Knowledge document imports

Administrators can upload documents into Baxter at **`/admin/knowledge/upload`**.

## Supported types

| Extension           | Behavior                                      |
| ------------------- | --------------------------------------------- |
| `.md` / `.markdown` | Preserve Markdown text                        |
| `.txt`              | Preserve plain text                           |
| `.pdf`              | Extract selectable text only — **no OCR**     |
| `.docx`             | Extract paragraphs/lists as text via Mammoth  |
| `.csv`              | Headers + row boundaries as readable text     |
| `.xlsx`             | Sheet names, headers, rows (displayed values) |

`.doc` (legacy Word) is **not** supported.

## Limits

| Variable                          | Default  | Purpose                 |
| --------------------------------- | -------- | ----------------------- |
| `KNOWLEDGE_UPLOAD_MAX_MB`         | `20`     | Per-file max size       |
| `KNOWLEDGE_IMPORT_MAX_CHARACTERS` | `200000` | Truncate extracted text |
| `KNOWLEDGE_IMPORT_MAX_ROWS`       | `500`    | CSV/XLSX row cap        |
| `KNOWLEDGE_IMPORT_MAX_SHEETS`     | `10`     | XLSX sheet cap          |

## Workflow

1. Select or drop files.
2. **Preview extraction** (server-side parse; no Knowledge Base write yet).
3. Adjust titles / draft vs approve / optional category & tags.
4. **Import**.
5. Open the created entry.

Empty PDF extractions text shows:

> No selectable text was found. This may be a scanned PDF. OCR is not currently supported.

## Duplicates

Baxter hashes file bytes (`sha256`). Exact duplicates are rejected with an option to open the existing entry.

## Storage

- Private Supabase bucket: `knowledge-uploads`
- Admin-only storage policies
- Service-role upload from API
- Original filename stored in `knowledge_uploads`
- Unique storage path: `{userId}/{uploadId}-{safeFilename}`

## Migration

Apply **`012_knowledge_uploads.sql`**:

- Creates `knowledge_uploads`
- Creates `knowledge-uploads` bucket + RLS
- Changes `baxter_message_sources.knowledge_entry_id` to **ON DELETE SET NULL** (nullable) so unused entries can be deleted after citation checks

## Manual vs uploaded vs Google

| Badge    | Meaning                           |
| -------- | --------------------------------- |
| Manual   | Typed in Baxter                   |
| Uploaded | Imported from a file              |
| Google   | Managed by Google Drive connector |

Google browsing/auth redesign is **Prompt 2**.

## Troubleshooting

| Issue                            | Fix                                                           |
| -------------------------------- | ------------------------------------------------------------- |
| Upload storage failed            | Confirm migration 012 / bucket `knowledge-uploads` exists     |
| Unexpected delete error (legacy) | Apply 012; cited entries should be archived, not hard-deleted |
| Scanned PDF empty                | Expected without OCR                                          |
| Unsupported type                 | Use listed extensions only                                    |
