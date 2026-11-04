type Header = { key: string; value: string };

const SHARED: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

function contentSecurityPolicy(frameAncestors: "'self'" | "*"): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.supabase.co https://maps.gstatic.com https://maps.googleapis.com https://*.googleusercontent.com",
    "media-src 'self' blob: https://*.supabase.co",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://places.googleapis.com",
    "frame-src 'self' https://drive.google.com https://*.google.com",
    "object-src 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Public Acton ADU configurator (`/design`, later design.actonadu.com). It embeds the
 * existing GoHighLevel forms (LeadConnector iframes + form_embed.js, Cloudflare Turnstile),
 * the Can I Build search widget (which loads Google Maps), and optionally the marketing GTM
 * container, so it needs a wider policy than the internal app.
 */
function configuratorContentSecurityPolicy(): string {
  const ghl = "https://*.leadconnectorhq.com https://*.msgsndr.com https://link.msgsndr.com";
  const canibuild = "https://*.canibuild.com";
  const tracking =
    "https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://*.clarity.ms https://*.hotjar.com https://*.hotjar.io https://js.adsrvr.org https://*.adsrvr.org https://*.doubleclick.net https://www.googleadservices.com https://*.google.com";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ghl} ${canibuild} https://challenges.cloudflare.com https://maps.googleapis.com https://maps.gstatic.com ${tracking}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${ghl} ${canibuild}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://*.supabase.co",
    `font-src 'self' data: https://fonts.gstatic.com ${ghl} ${canibuild}`,
    `connect-src 'self' https://*.supabase.co ${ghl} ${canibuild} https://maps.googleapis.com https://places.googleapis.com wss://*.hotjar.com ${tracking}`,
    `frame-src 'self' ${ghl} ${canibuild} https://challenges.cloudflare.com ${tracking}`,
    "object-src 'none'",
    "frame-ancestors 'self' https://actonadu.com https://*.actonadu.com",
    "base-uri 'self'",
    `form-action 'self' ${ghl} ${canibuild}`,
  ].join("; ");
}

const CONFIGURATOR_HEADERS: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(self "https://api.leadconnectorhq.com" "https://search-widget.canibuild.com")',
  },
  { key: "Content-Security-Policy", value: configuratorContentSecurityPolicy() },
];

function configuratorHost(): string {
  return (process.env.CONFIGURATOR_PUBLIC_HOST || "design.actonadu.com").toLowerCase();
}

type HostCondition = { type: "host"; value: string };

/**
 * `/embed` and the configurator are excluded from the global rule so they do not also
 * receive X-Frame-Options or `frame-ancestors 'self'`. Those two together block
 * cross-origin iframes, and a second CSP header is ANDed with the first.
 */

export function securityHeaderRules(): Array<{
  source: string;
  headers: Header[];
  has?: HostCondition[];
  missing?: HostCondition[];
}> {
  const host = configuratorHost();
  return [
    {
      source: "/embed/:path*",
      headers: [...SHARED, { key: "Content-Security-Policy", value: contentSecurityPolicy("*") }],
    },
    {
      source: "/((?!embed(?:/|$)|design(?:/|$)).*)",
      missing: [{ type: "host", value: host }],
      headers: [
        ...SHARED,
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: contentSecurityPolicy("'self'") },
      ],
    },
    { source: "/design", headers: CONFIGURATOR_HEADERS },
    { source: "/design/:path*", headers: CONFIGURATOR_HEADERS },
    {
      source: "/:path*",
      has: [{ type: "host", value: host }],
      headers: CONFIGURATOR_HEADERS,
    },
  ];
}
