/** Redirect back to Sam Operations → Integrations with a short, non-secret result message. */
export function oauthResultRedirect(request: Request, params: Record<string, string>): Response {
  const dest = new URL("/ai/operations", request.url);
  dest.searchParams.set("tab", "integrations");
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  return Response.redirect(dest, 302);
}
