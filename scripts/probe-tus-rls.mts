/**
 * Probe site-inspection-media TUS create with service-role vs a real user JWT.
 *
 * 1. Apply supabase/migrations/054_site_inspection_media_tus_rls.sql in the Baxter project.
 * 2. npx tsx scripts/probe-tus-rls.mts
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("Missing Supabase env");
  process.exit(1);
}

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

async function tusCreate(input: {
  accessToken: string;
  apikey: string;
  objectName: string;
}): Promise<{ status: number; location: string | null; body: string }> {
  const endpoint = resumableEndpoint(url!);
  const metadata = [
    `bucketName ${b64("site-inspection-media")}`,
    `objectName ${b64(input.objectName)}`,
    `contentType ${b64("video/mp4")}`,
    `cacheControl ${b64("3600")}`,
  ].join(",");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      apikey: input.apikey,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": "32",
      "Upload-Metadata": metadata,
      "x-upsert": "true",
    },
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), body: text.slice(0, 400) };
}

console.log("TUS endpoint", resumableEndpoint(url));

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `tus-probe-${Date.now()}@actonadu.invalid`;
const password = `Probe-${Date.now()}!aA1`;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error || !created.data.user) {
  console.error("createUser failed", created.error?.message);
  process.exit(1);
}
const uid = created.data.user.id;
console.log("probe user", uid);

try {
  const serviceResult = await tusCreate({
    accessToken: service,
    apikey: service,
    objectName: `${uid}/probe/service-${randomUUID()}.mp4`,
  });
  console.log("service-role create", serviceResult);

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await userClient.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session?.access_token) {
    console.error("signIn failed", signed.error?.message);
    process.exit(1);
  }
  const userResult = await tusCreate({
    accessToken: signed.data.session.access_token,
    apikey: anon,
    objectName: `${uid}/probe/user-${randomUUID()}.mp4`,
  });
  console.log("user-jwt create", userResult);

  if (userResult.status >= 200 && userResult.status < 300) {
    console.log("OK — user JWT accepted for resumable create");
    process.exitCode = 0;
  } else {
    console.error(
      "FAIL — user JWT blocked. Apply supabase/migrations/054_site_inspection_media_tus_rls.sql on project rinsdxyfxgfvrpvkbxlm",
    );
    process.exitCode = 2;
  }
} finally {
  await admin.auth.admin.deleteUser(uid);
}
