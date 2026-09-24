/**
 * Cross-user storage access for site-inspection-media.
 * User A creates an object under {uidA}/…. User B HEADs the TUS URL and GETs the object.
 * Before migration 055 this is 403. After 055 both should be 2xx.
 *
 * npx tsx scripts/probe-tus-cross-user.mts
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

async function makeUser(admin: ReturnType<typeof createClient>, label: string) {
  const email = `tus-${label}-${Date.now()}@actonadu.invalid`;
  const password = `Probe-${Date.now()}!aA1`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "createUser");
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw new Error(signed.error?.message ?? "signin");
  return {
    id: created.data.user.id,
    token: signed.data.session.access_token,
    client,
  };
}

async function main() {
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const a = await makeUser(admin, "a");
  const b = await makeUser(admin, "b");
  try {
    const endpoint = resumableEndpoint(url);
    const objectName = `${a.id}/${randomUUID()}/${randomUUID()}.mp4`;
    const metadata = [
      `bucketName ${b64("site-inspection-media")}`,
      `objectName ${b64(objectName)}`,
      `contentType ${b64("video/mp4")}`,
      `cacheControl ${b64("3600")}`,
    ].join(",");
    const post = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "32",
        "Upload-Metadata": metadata,
        "Content-Type": "application/offset+octet-stream",
        "x-upsert": "true",
      },
      body: Buffer.alloc(32, 4),
    });
    const location = post.headers.get("location");
    console.log(
      JSON.stringify({
        step: "user A POST",
        status: post.status,
        uploadOffset: post.headers.get("upload-offset"),
        objectName,
        hasLocation: Boolean(location),
      }),
    );
    if (!location || post.status >= 300) {
      console.log(await post.text());
      process.exitCode = 2;
      return;
    }

    const headB = await fetch(location, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${b.token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
      },
    });
    console.log(
      JSON.stringify({
        step: "user B HEAD user A upload",
        status: headB.status,
        uploadOffset: headB.headers.get("upload-offset"),
        uploadLength: headB.headers.get("upload-length"),
        body: headB.status >= 300 ? await headB.text() : "",
      }),
    );

    const objectUrl = `${url}/storage/v1/object/site-inspection-media/${objectName}`;
    for (const who of [
      { label: "user A", token: a.token },
      { label: "user B", token: b.token },
      { label: "service", token: service },
    ]) {
      const get = await fetch(objectUrl, {
        headers: {
          Authorization: `Bearer ${who.token}`,
          apikey: who.token === service ? service : anon,
        },
      });
      const body =
        get.status >= 300
          ? (await get.text()).slice(0, 300)
          : `bytes ${get.headers.get("content-length")}`;
      console.log(JSON.stringify({ step: `${who.label} GET object`, status: get.status, body }));
    }

    const listA = await a.client.storage.from("site-inspection-media").list(a.id, { limit: 10 });
    console.log(
      JSON.stringify({
        step: "user A list own folder",
        error: listA.error?.message ?? null,
        count: listA.data?.length ?? 0,
        names: (listA.data ?? []).map((row) => row.name),
      }),
    );

    const listB = await b.client.storage.from("site-inspection-media").list(a.id, { limit: 10 });
    console.log(
      JSON.stringify({
        step: "user B list user A folder",
        error: listB.error?.message ?? null,
        count: listB.data?.length ?? 0,
      }),
    );

    const partialName = `${a.id}/${randomUUID()}/${randomUUID()}.mp4`;
    const partialMeta = [
      `bucketName ${b64("site-inspection-media")}`,
      `objectName ${b64(partialName)}`,
      `contentType ${b64("video/mp4")}`,
      `cacheControl ${b64("3600")}`,
    ].join(",");
    const partial = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.token}`,
        apikey: anon,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "64",
        "Upload-Metadata": partialMeta,
        "Content-Type": "application/offset+octet-stream",
        "x-upsert": "true",
      },
      body: Buffer.alloc(32, 1),
    });
    const partialLoc = partial.headers.get("location");
    const patchB = partialLoc
      ? await fetch(partialLoc, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${b.token}`,
            apikey: anon,
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": partial.headers.get("upload-offset") ?? "32",
            "Content-Type": "application/offset+octet-stream",
            "x-upsert": "true",
          },
          body: Buffer.alloc(32, 2),
        })
      : null;
    console.log(
      JSON.stringify({
        step: "user B PATCH user A upload",
        postStatus: partial.status,
        postOffset: partial.headers.get("upload-offset"),
        patchStatus: patchB?.status ?? null,
        patchOffset: patchB?.headers.get("upload-offset") ?? null,
        patchBody: patchB && patchB.status >= 300 ? (await patchB.text()).slice(0, 400) : "",
      }),
    );
  } finally {
    await admin.auth.admin.deleteUser(a.id);
    await admin.auth.admin.deleteUser(b.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
