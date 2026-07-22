// PIN hashing + verification for the barback web-link flow.
//
// Algorithm: PBKDF2-HMAC-SHA-256 with 100 000 iterations.
// Salt: 16 random bytes per PIN, base64url-encoded, stored alongside.
// Output: base64url-encoded 32-byte derived key.
//
// Rationale:
//   - Deno standard runtime exposes crypto.subtle.deriveBits with
//     PBKDF2 out of the box; no external dep needed.
//   - 4-6 digit PIN space (10k - 1M) is small, so the hashing cost is
//     load-bearing. 100k PBKDF2 rounds (~75 ms on the Edge runtime) is
//     painful enough that brute-forcing on the server matters.
//   - The rate-limit (5 fails → 5 min lock) does the heavy lifting;
//     this hash is mainly to protect against DB exfiltration.

const ENC = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  // btoa expects a binary string
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return base64url(salt);
}

export async function hashPin(pin: string, saltB64u: string): Promise<string> {
  const saltBytes = fromBase64url(saltB64u);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ENC.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as BufferSource,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return base64url(new Uint8Array(bits));
}

/**
 * Constant-time compare to prevent timing attacks. Both strings must be
 * base64url derived keys of the same length (43 chars = 32 bytes).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyPin(
  pin: string,
  storedHash: string,
  saltB64u: string,
): Promise<boolean> {
  const computed = await hashPin(pin, saltB64u);
  return constantTimeEqual(computed, storedHash);
}

/**
 * Generate a fresh random PIN. Returns a 4-digit numeric string by
 * default. Use length 6 for higher-entropy contexts.
 */
export function generateRandomPin(length = 4): string {
  if (length < 4 || length > 8) throw new Error("PIN length must be 4-8");
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Map each byte to a digit. Bias is acceptable for a 4-digit PIN —
  // we're not generating cryptographic secrets here, just shared codes.
  let out = "";
  for (const b of bytes) out += String(b % 10);
  return out;
}
