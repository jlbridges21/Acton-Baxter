/**
 * Capture a real multi-chunk TUS exchange against Baxter storage.
 * Path matches production: {auth.uid()}/{inspectionId}/{clientMediaId}.mp4
 *
 * npx tsx scripts/probe-tus-chunks.mts
 */
import { createClient } from "@supabase/supabase-js";
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

function resumableEndpoint(supabaseUrl: string): string {
  const u = new URL(supabaseUrl);
  if (u.hostname.endsWith(".supabase.co") && !u.hostname.includes(".storage.")) {
    u.hostname = u.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  return `${u.origin.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function dump(label: string, res: Response, body: string) {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/upload-|tus-|location|content-type|x-error/i.test(k) || k.toLowerCase() === "location") {
      headers[k] = v;
    }
  });
  console.log(
    JSON.stringify(
      {
        step: label,
        status: res.status,
        uploadOffset: res.headers.get("upload-offset"),
        uploadLength: res.headers.get("upload-length"),
        location: res.headers.get("location"),
        headers,
        body: body.slice(0, 500),
      },
      null,
      2,
    ),
  );
}

const CHUNK = 6 * 1024 * 1024;
const TOTAL = CHUNK * 2; // two chunks → ~50% after first, 100% after second

async function main() {
  const endpoint = resumableEndpoint(url);
  console.log("endpoint", endpoint);
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `tus-chunk-${Date.now()}@actonadu.invalid`;
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
    if (signed.error || !signed.data.session) {
      console.error("signin", signed.error?.message);
      process.exit(1);
    }
    const token = signed.data.session.access_token;
    const inspectionId = randomUUID();
    const clientMediaId = randomUUID();
    const objectName = `${uid}/${inspectionId}/${clientMediaId}.mp4`;
    console.log("objectName", objectName);

    const metadata = [
      `bucketName ${b64("site-inspection-media")}`,
      `objectName ${b64(objectName)}`,
      `contentType ${b64("video/mp4")}`,
      `cacheControl ${b64("3600")}`,
    ].join(",");

    const chunk1 = Buffer.alloc(CHUNK, 1);
    const post = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(TOTAL),
        "Upload-Metadata": metadata,
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
        "x-upsert": "true",
      },
      body: chunk1,
    });
    const postBody = await post.text();
    dump("POST create+chunk1", post, postBody);
    const location = post.headers.get("location");
    if (!location || post.status >= 300) {
      console.log("STOP — first failing request is POST");
      process.exitCode = 2;
      return;
    }

    const head1 = await fetch(location, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
      },
    });
    dump("HEAD after chunk1", head1, "");

    const chunk2 = Buffer.alloc(CHUNK, 2);
    const offset = post.headers.get("upload-offset") ?? String(CHUNK);
    const patch = await fetch(location, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": offset,
        "Content-Type": "application/offset+octet-stream",
        "x-upsert": "true",
      },
      body: chunk2,
    });
    const patchBody = await patch.text();
    dump("PATCH chunk2", patch, patchBody);

    const head2 = await fetch(location, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
      },
    });
    dump("HEAD after chunk2", head2, "");
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
