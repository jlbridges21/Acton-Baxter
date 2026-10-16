/** JSON fetch for survey routes. Throws the server's message on failure. */
export async function surveyFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;
  if (!res.ok || !json) {
    throw new Error(json?.error?.message ?? "Something went wrong. Try again.");
  }
  return json;
}
