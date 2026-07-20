// Shared CORS helpers for the barback Edge Functions.
// All three functions (`barback-create-session`, `barback-login`,
// `barback-revoke-session`) live on the same origin and are called from
// `barback.html` / `barback_manager.html` — which may be served from a
// different origin during local development, so CORS is required.

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-barback-debug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  return null;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(message: string, status = 400, code?: string): Response {
  return jsonResponse({ error: message, code: code ?? null }, status);
}
