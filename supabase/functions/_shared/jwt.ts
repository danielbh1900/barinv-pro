// HS256 JWT signing for the barback web-link flow.
//
// The JWT is signed with SUPABASE_JWT_SECRET (the same secret PostgREST
// uses to verify auth tokens). Setting `role: 'barback_user'` makes
// PostgREST switch into the custom postgres role created by the schema
// migration. Custom claims are read by RLS policies via
// `auth.jwt() ->> 'claim_name'`.
//
// We deliberately do NOT use the standard supabase-auth library here —
// this is a custom token, not an auth.users session. The token never
// gets refreshed and dies at `exp`.

const ENC = new TextEncoder();

function base64urlString(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? ENC.encode(input) : input;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface BarbackJwtClaims {
  aud: "authenticated";
  iss: "barinv-barback";
  // Synthesised: we use session_id as the sub so this JWT never
  // collides with a real auth.users principal.
  sub: string;
  role: "barback_user";
  exp: number;
  iat: number;

  // custom claims — read by RLS
  barback_role: "barback";
  session_id: string;     // barback_sessions.id
  venue_id: string;       // uuid
  night_id: string;       // uuid
  bar_id: string | "";    // uuid or "" if multi-bar session
  allowed_bars: string;   // comma-separated UUIDs (postgres array literal-safe)
  staff_id: string;       // uuid

  // non-security metadata
  staff_name?: string;
  nickname?: string;
  issuer?: string;
}

export async function signBarbackJwt(
  claims: BarbackJwtClaims,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64urlString(JSON.stringify(header));
  const payloadB64 = base64urlString(JSON.stringify(claims));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(data));
  const sigB64 = base64urlString(new Uint8Array(sig));
  return `${data}.${sigB64}`;
}

/**
 * Decode (and optionally verify) a JWT. If `secret` is provided, the
 * signature must verify. Returns the payload, or throws.
 */
export async function decodeJwt(
  jwt: string,
  secret?: string,
): Promise<Record<string, unknown>> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [headerB64, payloadB64, sigB64] = parts;

  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      ENC.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    // Re-base64url-decode the signature
    const sig = (() => {
      let s = sigB64.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    })();
    const data = ENC.encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!ok) throw new Error("signature mismatch");
  }

  // payload may contain padding-less base64url
  let p = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
  while (p.length % 4 !== 0) p += "=";
  const json = atob(p);
  return JSON.parse(json);
}

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ════════════════════════════════════════════════════════════════════
// BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 — signed barback session tokens.
// 2026-05-20.
// ────────────────────────────────────────────────────────────────────
// The session token in the URL/QR (NOT the auth JWT) was historically a
// single-part base64url(JSON) value with no integrity protection — the
// confidentiality of the contained session_id was the only barrier to
// session takeover. Phase 2A H-2A-5 flagged this.
//
// This module adds two helpers:
//   • signBarbackSessionToken(payload, secret)
//       Produces "<payload_b64u>.<sig_b64u>" where sig is HMAC-SHA256 over
//       the payload_b64u text, signed with SUPABASE_JWT_SECRET. Stamps the
//       payload's `v` field to 2 so verifiers can distinguish from legacy.
//
//   • verifyBarbackSessionToken(token, secret)
//       Accepts:
//         - single-part v1 (legacy unsigned) → returns {ok, payload, version: 1}
//         - two-part v2 (signed)             → verifies HMAC; on match
//                                                returns {ok, payload, version: 2}
//       Rejects with {ok:false, reason: …} on any malformation.
//
// Backward-compatibility: v1 acceptance is TEMPORARY. Once all in-flight
// tokens are confirmed v2 (or revoked), the v1 branch can be removed.
// ════════════════════════════════════════════════════════════════════

function _base64urlToBytes(s: string): Uint8Array {
  let v = s.replace(/-/g, "+").replace(/_/g, "/");
  while (v.length % 4 !== 0) v += "=";
  const bin = atob(v);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signBarbackSessionToken(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("signBarbackSessionToken: secret required");
  // Stamp v=2 explicitly — verifiers use this to log which version was
  // accepted, and operators can grep audit logs once v1 is fully retired.
  const stamped = { ...payload, v: 2 };
  const payloadB64 = base64urlString(JSON.stringify(stamped));
  const key = await crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(payloadB64));
  const sigB64 = base64urlString(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

export type BarbackSessionTokenVerifyResult =
  | { ok: true; payload: Record<string, unknown>; version: 1 | 2 }
  | { ok: false; reason: string };

export async function verifyBarbackSessionToken(
  token: string,
  secret: string,
): Promise<BarbackSessionTokenVerifyResult> {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "empty token" };
  }
  const parts = token.split(".");

  // ── v1 legacy: single-part base64url(JSON), NO signature ─────────
  // Accepted temporarily so existing URL/QR tokens in the field keep
  // working through the migration window.
  if (parts.length === 1) {
    try {
      let p = parts[0].replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4 !== 0) p += "=";
      const payload = JSON.parse(atob(p));
      if (!payload || typeof payload !== "object") {
        return { ok: false, reason: "malformed v1 payload" };
      }
      return { ok: true, payload: payload as Record<string, unknown>, version: 1 };
    } catch {
      return { ok: false, reason: "malformed v1 token" };
    }
  }

  // ── v2 signed: exactly two parts ─────────────────────────────────
  if (parts.length !== 2) {
    return { ok: false, reason: "expected 1 or 2 token parts, got " + parts.length };
  }
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) {
    return { ok: false, reason: "empty token part" };
  }

  // Verify HMAC — never decode payload before signature passes.
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      ENC.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = _base64urlToBytes(sigB64);
    const sigOk = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      ENC.encode(payloadB64),
    );
    if (!sigOk) return { ok: false, reason: "signature mismatch" };
  } catch (_) {
    return { ok: false, reason: "signature verify error" };
  }

  // Signature verified — decode payload.
  try {
    let p = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    while (p.length % 4 !== 0) p += "=";
    const payload = JSON.parse(atob(p));
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "malformed v2 payload" };
    }
    return { ok: true, payload: payload as Record<string, unknown>, version: 2 };
  } catch {
    return { ok: false, reason: "malformed v2 payload" };
  }
}
