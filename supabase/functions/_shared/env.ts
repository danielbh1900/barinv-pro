// Env helpers for barback Edge Functions.
//
// Supabase's hosted Edge runtime has been evolving its env-injection
// model: the legacy `SUPABASE_SERVICE_ROLE_KEY` is no longer guaranteed
// to be auto-injected on newer projects; some now expose
// `SUPABASE_SECRET_KEYS` (a JSON array of key objects) or
// `SUPABASE_SECRET_KEY` (a single key). These helpers resolve the
// service-role-equivalent secret across all three forms and also
// produce a precise diagnostic so the operator knows which env var to
// set when configuration is missing.
//
// SAFETY: this file MUST stay browser-unsafe. It reads service-role
// material. NEVER import this file from anything that ships to a
// public bundle (it only runs server-side in Edge Functions).

export function getSupabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

// Resolve the service-role-equivalent secret across legacy and new
// Supabase key formats. Order:
//   1. SUPABASE_SERVICE_ROLE_KEY (legacy; still set on most projects)
//   2. SUPABASE_SECRET_KEY (newer singular form)
//   3. SUPABASE_SECRET_KEYS (newest JSON form; pick first matching)
export function getSupabaseServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const singleSecret = Deno.env.get("SUPABASE_SECRET_KEY");
  if (singleSecret) return singleSecret;

  const keysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keysJson) {
    try {
      const parsed = JSON.parse(keysJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Prefer an explicit service-role-named entry.
        for (const entry of parsed) {
          if (entry && typeof entry === "object") {
            const role = entry.role ?? entry.name ?? entry.type;
            const key  = entry.key ?? entry.value ?? entry.secret;
            if (typeof key === "string" && key &&
                (role === "service_role" || role === "secret" || role === "service")) {
              return key;
            }
          }
        }
        // Fallback: first entry's key, whatever it is.
        const first = parsed[0];
        if (first && typeof first === "object") {
          const k = first.key ?? first.value ?? first.secret;
          if (typeof k === "string" && k) return k;
        }
      }
    } catch (_) {
      /* JSON parse failed — fall through to empty */
    }
  }

  return "";
}

// Reads the JWT-signing secret used to mint signed barback session
// tokens (HMAC-SHA256).
//
// Supabase rejects custom secrets whose name starts with the prefix
// `SUPABASE_`, so the canonical custom-secret name is BARINV_JWT_SECRET.
// SUPABASE_JWT_SECRET is kept as a read-only fallback for compatibility
// with any legacy deployment that may already have it set, but the
// configured custom secret going forward MUST be BARINV_JWT_SECRET.
export function getSupabaseJwtSecret(): string {
  const primary = Deno.env.get("BARINV_JWT_SECRET");
  if (primary) return primary;
  return Deno.env.get("SUPABASE_JWT_SECRET") ?? "";
}

// Resolves the anon/publishable client key used by user-scoped Supabase
// clients (for example, the one inside `authenticateManager` that calls
// `auth.getUser(token)`). Newer Supabase projects no longer auto-inject
// `SUPABASE_ANON_KEY`; they expose `SUPABASE_PUBLISHABLE_KEY` (singular)
// or `SUPABASE_PUBLISHABLE_KEYS` (JSON array) instead. When this returns
// "", the `apikey` header on `/auth/v1/user` calls is empty and GoTrue
// rejects the request — the symptom the operator sees is a 401
// "invalid or expired manager JWT" no matter how fresh the Bearer token
// actually is.
//
// Order:
//   1. SUPABASE_ANON_KEY                (legacy; still on most projects)
//   2. SUPABASE_PUBLISHABLE_KEY         (newer singular form)
//   3. SUPABASE_PUBLISHABLE_KEYS        (newest JSON array form; pick
//                                        first entry whose role/name/
//                                        type is anon|publishable,
//                                        otherwise the first entry)
export function getSupabaseAnonKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;

  const singlePub = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (singlePub) return singlePub;

  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keysJson) {
    try {
      const parsed = JSON.parse(keysJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const entry of parsed) {
          if (entry && typeof entry === "object") {
            const role = entry.role ?? entry.name ?? entry.type;
            const key  = entry.key ?? entry.value;
            if (typeof key === "string" && key &&
                (role === "anon" || role === "publishable")) {
              return key;
            }
          }
        }
        // Fallback: first entry's key, whatever it is.
        const first = parsed[0];
        if (first && typeof first === "object") {
          const k = first.key ?? first.value;
          if (typeof k === "string" && k) return k;
        }
      }
    } catch (_) {
      /* JSON parse failed — fall through to empty */
    }
  }

  return "";
}

// Returns a comma-separated string listing which expected env vars are
// missing, or "" when everything resolves. Pass `needJwtSecret: true`
// for functions that sign barback session tokens (currently only
// barback-create-session).
export function diagnoseMissingEnv(
  opts: { needJwtSecret?: boolean } = {},
): string {
  const missing: string[] = [];
  if (!getSupabaseUrl()) missing.push("SUPABASE_URL");
  if (!getSupabaseServiceKey()) {
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS)",
    );
  }
  if (opts.needJwtSecret === true && !getSupabaseJwtSecret()) {
    missing.push("BARINV_JWT_SECRET");
  }
  return missing.join(", ");
}
