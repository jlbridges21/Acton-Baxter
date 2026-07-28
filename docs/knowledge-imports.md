# Knowledge document imports

Administrators can upload documents into Baxter at **`/admin/knowledge/upload`**.

## Supported types

| Extension           | Behavior                                                      |
| ------------------- | ------------------------------------------------------------- |
| `.md` / `.markdown` | Preserve Markdown text                                        |
| `.txt`              | Preserve plain text                                           |
| `.pdf`              | Extract selectable text via `unpdf` (server) — **no OCR yet** |
| `.docx`             | Extract paragraphs/lists as text via Mammoth                  |
| `.csv`              | Headers + row boundaries as readable text                     |
| `.xlsx`             | Sheet names, headers, rows (displayed values)                 |

`.doc` (legacy Word) is **not** supported.

## Limits

| Variable                              | Default  | Purpose                 |
| ------------------------------------- | -------- | ----------------------- |
| `KNOWLEDGE_UPLOAD_MAX_MB`             | `20`     | Per-file max size       |
| `KNOWLEDGE_IMPORT_MAX_CHARACTERS`     | `200000` | Truncate extracted text |
| `KNOWLEDGE_IMPORT_MAX_ROWS`           | `500`    | CSV/XLSX row cap        |
| `KNOWLEDGE_IMPORT_MAX_SHEETS`         | `10`     | XLSX sheet cap          |
| `KNOWLEDGE_PDF_MAX_PAGES`             | `200`    | Max PDF pages to parse  |
| `KNOWLEDGE_PDF_EXTRACTION_TIMEOUT_MS` | `45000`  | PDF parse timeout       |

## Workflow

1. Select or drop files.
2. **Preview extraction** (server-side parse; no Knowledge Base write yet).
3. Adjust titles / draft vs approve / optional category & tags.
4. **Import**.
5. Open the created entry.

Empty / scanned PDF (valid file, no text layer) shows:

> This appears to be a scanned or image-only PDF. Baxter couldn't find a readable text layer.

Parser failures (corrupt, password-protected, runtime errors) are separate from empty text and never surface raw messages like `DOMMatrix is not defined` in the upload UI.

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
| Scanned PDF empty                | Expected — OCR for PDF page rasters not enabled yet           |
| Password-protected PDF           | Upload an unlocked copy                                       |
| DOMMatrix / PDF parse crash      | Fixed via `unpdf` serverless extractor on Node runtime        |
| Unsupported type                 | Use listed extensions only                                    |
