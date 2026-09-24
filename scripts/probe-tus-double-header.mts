/**
 * Reproduce the browser XHR bug: setRequestHeader twice concatenates values.
 * tus-js-client sets `headers` first, then onBeforeRequest setHeader again.
 * Node overwrites; the browser sends "apikey: key, key" and "x-upsert: true, true".
 *
 * npx tsx scripts/probe-tus-double-header.mts
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
  console.log(
    JSON.stringify(
      {
        step: label,
        status: res.status,
        uploadOffset: res.headers.get("upload-offset"),
        uploadLength: res.headers.get("upload-length"),
        location: res.headers.get("location"),
        body: body.slice(0, 800),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const endpoint = resumableEndpoint(url);
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `tus-dup-${Date.now()}@actonadu.invalid`;
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
    const doubledApikey = `${anon}, ${anon}`;
    const doubledUpsert = "true, true";

    async function tusPost(label: string, apikey: string, upsert: string) {
      const objectName = `${uid}/${randomUUID()}/${randomUUID()}.mp4`;
      const metadata = [
        `bucketName ${b64("site-inspection-media")}`,
        `objectName ${b64(objectName)}`,
        `contentType ${b64("video/mp4")}`,
        `cacheControl ${b64("3600")}`,
      ].join(",");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": "32",
          "Upload-Metadata": metadata,
          "Content-Type": "application/offset+octet-stream",
          "x-upsert": upsert,
        },
        body: Buffer.alloc(32, 7),
      });
      const body = await res.text();
      dump(label, res, body);
      return res.status;
    }

    const both = await tusPost(
      "POST 32B concatenated apikey AND x-upsert",
      doubledApikey,
      doubledUpsert,
    );
    const apikeyOnly = await tusPost("POST 32B concatenated apikey only", doubledApikey, "true");
    const upsertOnly = await tusPost("POST 32B concatenated x-upsert only", anon, doubledUpsert);
    console.log(JSON.stringify({ both, apikeyOnly, upsertOnly }));
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
