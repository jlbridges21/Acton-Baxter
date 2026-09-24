/**
 * Drive tus-js-client the same way the queue does, against live Baxter storage.
 * 12MB = two 6MB chunks. Logs every progress ratio.
 */
import { Upload } from "tus-js-client";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m?.[1]) continue;
    if (!process.env[m[1]]) process.env[m[1]] = (m[2] ?? "").replace(/^"|"$/g, "");
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CHUNK = 6 * 1024 * 1024;

async function main() {
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `tuslib-${Date.now()}@actonadu.invalid`;
  const password = `Probe-${Date.now()}!aA1`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.data.user) throw new Error(created.error?.message ?? "create failed");
  const uid = created.data.user.id;
  try {
    const user = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await user.auth.signInWithPassword({ email, password });
    const token = signed.data.session!.access_token;
    const endpoint =
      url.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";
    const objectName = `${uid}/${randomUUID()}/${randomUUID()}.mp4`;
    const blob = Buffer.alloc(CHUNK * 2, 7);
    const seen: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(blob, {
        endpoint,
        retryDelays: [0, 1000],
        headers: { apikey: anon, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: false,
        chunkSize: CHUNK,
        metadata: {
          bucketName: "site-inspection-media",
          objectName,
          contentType: "video/mp4",
          cacheControl: "3600",
        },
        onBeforeRequest: (req) => {
          req.setHeader("Authorization", `Bearer ${token}`);
          req.setHeader("apikey", anon);
          req.setHeader("x-upsert", "true");
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const ratio = bytesUploaded / bytesTotal;
          seen.push(ratio);
          console.log("progress", ratio.toFixed(3), "bytes", bytesUploaded, "/", bytesTotal);
        },
        onError: (err) => {
          console.error("tus error", err.message);
          reject(err);
        },
        onSuccess: () => {
          console.log("success ratios", seen.map((n) => n.toFixed(3)).join(","));
          resolve();
        },
      });
      upload.start();
    });
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
