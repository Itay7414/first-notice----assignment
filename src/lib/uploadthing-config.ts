// Server-only: reads `process.env.UPLOADTHING_TOKEN`, so this must never be
// imported from client components.
const PLACEHOLDER_TOKEN_PATTERNS = [
  /placeholder/i,
  /your[-_]?token/i,
  /changeme/i,
  /^todo$/i,
  /^xxx+$/i,
  /^sk_live_xxx/i,
];

/**
 * Whether a real UploadThing token is configured for this environment.
 * Missing/empty values and common placeholder strings (e.g. left over from
 * `.env.example`) are treated as "not configured", so local evaluation can
 * fall back to the mock upload flow (`claim.simulateDocumentUpload`)
 * instead of hitting a live 500 from UploadThing's API.
 */
export function isUploadThingConfigured(): boolean {
  const token = process.env.UPLOADTHING_TOKEN?.trim();
  if (!token) return false;
  return !PLACEHOLDER_TOKEN_PATTERNS.some((pattern) => pattern.test(token));
}
