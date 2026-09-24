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

async function main() {
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `hdr-${Date.now()}@actonadu.invalid`;
  const password = `Probe-${Date.now()}!aA1`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.data.user) throw new Error(created.error?.message ?? "no user");
  const uid = created.data.user.id;
  try {
    const user = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await user.auth.signInWithPassword({ email, password });
    const token = signed.data.session!.access_token;
    const endpoint =
      url.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const objectName = `${uid}/probe/${randomUUID()}.mp4`;
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
        apikey: anon,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "16",
        "Upload-Metadata": metadata,
        "x-upsert": "true",
        Origin: "https://app.actonadu.com",
      },
    });
    console.log("status", res.status);
    const names = [...res.headers.keys()].sort();
    console.log("header names", names.join(", "));
    for (const k of names) {
      if (/access-control|upload-|location|tus-/i.test(k)) {
        console.log(`${k}: ${res.headers.get(k)}`);
      }
    }
  } finally {
    await admin.auth.admin.deleteUser(uid);
  }
}

main();
