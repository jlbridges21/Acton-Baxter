/**
 * Human-readable presentation helpers for GoHighLevel CRM UI.
 * Never expose raw TYPE_* enums, opaque IDs, or giant email bodies as primary UI.
 */

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  TYPE_EMAIL: "Email",
  TYPE_SMS: "SMS",
  TYPE_CALL: "Call",
  TYPE_VOICEMAIL: "Voicemail",
  TYPE_FB: "Facebook",
  TYPE_IG: "Instagram",
  TYPE_WHATSAPP: "WhatsApp",
  TYPE_LIVE_CHAT: "Live chat",
  TYPE_CUSTOM_SMS: "SMS",
  TYPE_CUSTOM_EMAIL: "Email",
  TYPE_CAMPAIGN_EMAIL: "Campaign email",
  TYPE_CAMPAIGN_SMS: "Campaign SMS",
  email: "Email",
  sms: "SMS",
  call: "Call",
};

export function formatGhlCurrency(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatGhlDateTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let date: Date;
  if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (/^\d+$/.test(value.trim())) {
    const n = Number(value);
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatGhlDateRelative(value: string | number | null | undefined): string | null {
  const absolute = formatGhlDateTime(value);
  if (!absolute || value === null || value === undefined) return absolute;
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : /^\d+$/.test(String(value).trim())
        ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
        : new Date(String(value));
  if (Number.isNaN(date.getTime())) return absolute;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMsg = new Date(date);
  startOfMsg.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86400000);
  const time = date.toLocaleTimeString(undefined, { timeStyle: "short" });
  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  return absolute;
}

export function labelMessageType(type: string | null | undefined): string {
  if (!type) return "Other";
  return MESSAGE_TYPE_LABELS[type] ?? MESSAGE_TYPE_LABELS[type.toUpperCase()] ?? "Other";
}

export function stripHtmlToText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Compact conversation list preview — not a full message archive.
 */
export function sanitizeMessagePreview(raw: string | null | undefined, maxLength = 140): string {
  if (!raw) return "";
  let text = stripHtmlToText(raw);
  // Drop quoted email chains / forwarded headers where practical
  text = text.replace(/^>.*$/gm, " ");
  text = text.replace(/On .+ wrote:/gi, " ");
  text = text.replace(/From:\s*.+/gi, " ");
  text = text.replace(/Sent:\s*.+/gi, " ");
  text = text.replace(/Subject:\s*.+/gi, " ");
  // Collapse URL-only lines and tracking-looking URLs
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/\s+/g, " ").trim();
  // Common signature markers — cut after them
  const sigIdx = text.search(/\b(Best regards|Thanks,|Thank you,|Sincerely,|Sent from my)/i);
  if (sigIdx > 40) text = text.slice(0, sigIdx).trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function displayContactName(input: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const composed = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  return input.name?.trim() || composed || input.email?.trim() || "Unknown contact";
}

export function formatPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}
