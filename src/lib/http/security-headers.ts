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
 * `/embed` is excluded from the global rule so it does not also receive
 * X-Frame-Options or `frame-ancestors 'self'`. Those two together block
 * cross-origin iframes, and a second CSP header is ANDed with the first.
 */
export function securityHeaderRules(): Array<{ source: string; headers: Header[] }> {
  return [
    {
      source: "/embed/:path*",
      headers: [...SHARED, { key: "Content-Security-Policy", value: contentSecurityPolicy("*") }],
    },
    {
      source: "/((?!embed(?:/|$)).*)",
      headers: [
        ...SHARED,
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: contentSecurityPolicy("'self'") },
      ],
    },
  ];
}
