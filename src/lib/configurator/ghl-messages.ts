/**
 * Reading GoHighLevel embedded-form messages (client-safe, no imports).
 *
 * When a LeadConnector form inside an iframe is submitted, it posts
 *   ["set-sticky-contacts", "_ud", "<json of the submitted contact>", locationId, fingerprint]
 * to the parent page (GHL's form_embed.js stores it as localStorage `_ud`). That message is
 * the submit signal here. Resize messages ("[iFrameSizer]…") carry the form height.
 *
 * The legacy site treated *any* array or any string containing "form" as a submit, which
 * fired on unrelated messages; this parser only accepts the sticky-contact message (plus an
 * explicit `{event: "submitted"}` object, kept for compatibility).
 */

export type GhlSubmission = {
  contactId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
};

const GHL_HOSTS = ["leadconnectorhq.com", "msgsndr.com"];

export function isGhlOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return GHL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = str(obj[key]);
    if (direct) return direct;
  }
  return "";
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function submissionFromUserData(data: Record<string, unknown>): GhlSubmission {
  const nested = [
    data,
    parseJson(data.contact),
    parseJson(data.formData),
    parseJson(data.inputs),
  ].filter((x): x is Record<string, unknown> => Boolean(x));
  const get = (keys: string[]) => {
    for (const obj of nested) {
      const v = pick(obj, keys);
      if (v) return v;
    }
    return "";
  };
  const fullName = get(["full_name", "name"]);
  const [first = "", ...rest] = fullName.split(" ");
  return {
    contactId: get(["contactId", "contact_id", "customer_id", "id"]) || null,
    firstName: get(["first_name", "firstName"]) || first,
    lastName: get(["last_name", "lastName"]) || rest.join(" "),
    email: get(["email"]),
    phone: get(["phone", "phoneNumber", "phone_number"]),
    address: get(["address1", "address", "full_address", "street_address"]),
    city: get(["city"]),
    state: get(["state"]),
    postalCode: get(["postal_code", "postalCode", "zip", "zip_code"]),
  };
}

export type GhlMessage =
  | { type: "submitted"; submission: GhlSubmission }
  | { type: "resize"; height: number }
  | { type: "other" };

export function parseGhlMessage(data: unknown): GhlMessage {
  if (Array.isArray(data)) {
    if (data[0] === "set-sticky-contacts") {
      const payload = parseJson(data[2]);
      if (payload) return { type: "submitted", submission: submissionFromUserData(payload) };
    }
    return { type: "other" };
  }
  if (typeof data === "string") {
    if (data.includes("[iFrameSizer]")) {
      const height = Number(data.split(":")[1]);
      return Number.isFinite(height) && height > 0 ? { type: "resize", height } : { type: "other" };
    }
    return { type: "other" };
  }
  const obj = parseJson(data);
  if (obj) {
    if (obj.event === "submitted" || obj.type === "form-submitted")
      return { type: "submitted", submission: submissionFromUserData(obj) };
    if (typeof obj.height === "number" && obj.height > 0)
      return { type: "resize", height: obj.height };
  }
  return { type: "other" };
}

/** Query string that prefills GHL form fields (same keys the legacy site used). */
export function ghlPrefillQuery(p: Partial<GhlSubmission>): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | undefined) => {
    if (v) q.set(k, v);
  };
  set("first_name", p.firstName);
  set("last_name", p.lastName);
  set("phone", p.phone);
  set("phoneNumber", p.phone);
  set("email", p.email);
  set("address1", p.address);
  set("address", p.address);
  set("full_address", p.address);
  set("city", p.city);
  set("state", p.state);
  set("postal_code", p.postalCode);
  if ([...q.keys()].length) q.set("prefill", "true");
  return q.toString();
}
