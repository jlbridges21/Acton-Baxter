/**
 * Interrupt a real two-chunk TUS upload after chunk 1 and resume at that offset.
 * Mirrors the fixed client: Authorization only in onBeforeRequest; apikey once.
 *
 * npx tsx scripts/probe-tus-interrupt.mts
 */
import { createClient } from "@supabase/supabase-js";
import { Upload } from "tus-js-client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (!key) continue;
      let v = m[2] ?? "";
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = v;
    }
  } catch {
    /* ignore */
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CHUNK = 6 * 1024 * 1024;

function resumableEndpoint(supabaseUrl: string): string {
  const u = new URL(supabaseUrl);
  if (u.hostname.endsWith(".supabase.co") && !u.hostname.includes(".storage.")) {
    u.hostname = u.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return `${u.origin.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

function startUpload(input: {
  file: Buffer;
  endpoint: string;
  token: string;
  objectName: string;
  uploadUrl?: string;
  onChunkComplete?: (bytesAccepted: number) => void;
  onProgress?: (bytesUploaded: number) => void;
}): Promise<{ upload: Upload; done: Promise<void> }> {
  const upload = new Upload(input.file, {
    endpoint: input.endpoint,
    ...(input.uploadUrl ? { uploadUrl: input.uploadUrl } : {}),
    chunkSize: CHUNK,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: false,
    retryDelays: [0, 1000],
    headers: {
      apikey: anon,
      "x-upsert": "true",
    },
    metadata: {
      bucketName: "site-inspection-media",
      objectName: input.objectName,
      contentType: "video/mp4",
      cacheControl: "3600",
    },
    onBeforeRequest: (req) => {
      req.setHeader("Authorization", `Bearer ${input.token}`);
    },
    onChunkComplete: (_chunkSize, bytesAccepted) => {
      input.onChunkComplete?.(bytesAccepted);
    },
    onProgress: (bytesUploaded) => {
      input.onProgress?.(bytesUploaded);
    },
  });
  const done = new Promise<void>((resolve, reject) => {
    upload.options.onSuccess = () => resolve();
    upload.options.onError = (error) => reject(error);
  });
  return Promise.resolve({ upload, done });
}

async function main() {
  const endpoint = resumableEndpoint(url);
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `tus-resume-${Date.now()}@actonadu.invalid`;
  const password = `Probe-${Date.now()}!aA1`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    console.error("createUser", created.error?.message);
    process.exit(1);
  }
  const uid = created.data.user.id;
  try {
    const userClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await userClient.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw new Error(signed.error?.message ?? "signin");
    const token = signed.data.session.access_token;
    const objectName = `${uid}/${randomUUID()}/${randomUUID()}.mp4`;
    const file = Buffer.alloc(CHUNK * 2, 3);

    let location = "";
    let interrupted = false;
    let firstUpload: Upload | null = null;
    const first = await startUpload({
      file,
      endpoint,
      token,
      objectName,
      onChunkComplete: (bytesAccepted) => {
        console.log(JSON.stringify({ step: "chunk-complete", bytesAccepted }));
        if (!interrupted && bytesAccepted === CHUNK) {
          interrupted = true;
          location = firstUpload?.url ?? "";
          console.log(JSON.stringify({ step: "interrupt-after-chunk-1", location, bytesAccepted }));
          firstUpload?.abort(false);
        }
      },
    });
    firstUpload = first.upload;
    firstUpload.start();
    await Promise.race([
      first.done.catch((error: Error) => {
        console.log(JSON.stringify({ step: "first-ended", message: error.message }));
      }),
      new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (interrupted) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      }),
    ]);

    if (!location) location = firstUpload.url ?? "";
    console.log(JSON.stringify({ step: "stored-upload-url", location }));
    if (!location) {
      console.error("No upload URL after chunk 1");
      process.exitCode = 2;
      return;
    }

    const head = await fetch(location, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
      },
    });
    console.log(
      JSON.stringify({
        step: "HEAD before resume",
        status: head.status,
        uploadOffset: head.headers.get("upload-offset"),
        uploadLength: head.headers.get("upload-length"),
      }),
    );

    let firstResumeBytes: number | null = null;
    const second = await startUpload({
      file,
      endpoint,
      token,
      objectName,
      uploadUrl: location,
      onProgress: (bytesUploaded) => {
        if (firstResumeBytes == null) {
          firstResumeBytes = bytesUploaded;
          console.log(JSON.stringify({ step: "resume-first-progress", bytesUploaded }));
        }
      },
    });
    second.upload.start();
    await second.done;
    console.log(
      JSON.stringify({
        step: "resume-complete",
        firstResumeBytes,
        expectedOffset: CHUNK,
        resumedAtChunk1: firstResumeBytes != null && firstResumeBytes >= CHUNK,
      }),
    );
    if (firstResumeBytes == null || firstResumeBytes < CHUNK) {
      process.exitCode = 2;
    }
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
