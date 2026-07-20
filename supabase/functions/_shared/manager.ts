// Manager identity helpers used by `barback-create-session` /
// `barback-revoke-session` / `barback-extend-session` /
// `barback-rotate-pin`.
//
// Phase 4 hardening replaces the previous `const isManager = true`
// placeholder with a real check against the project's
// venue_members / has_venue_access infrastructure (see
// 20260505_department_access_phase_a.sql §3 and earlier migrations).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env.ts";

export interface ManagerContext {
  userId: string;          // auth.users.id
  staffId: string | null;  // public.staff.id if linked, else null
  email: string | null;
  userClient: SupabaseClient;  // JWT-attached client for downstream RLS-aware queries
}

/**
 * Authenticate the caller using the Authorization header. The caller
 * must hold a valid Supabase JWT issued by the project's auth.users
 * pipeline (a real manager signed into the manager UI).
 *
 * Looks up the linked staff row via `staff.auth_user_id`. Does NOT
 * gate on a role here — call `requireVenueManager(ctx, venue_id)`
 * separately for the venue-specific permission check, since "is this
 * a manager?" only makes sense per-venue.
 */
export async function authenticateManager(
  req: Request,
  serviceClient: SupabaseClient,
): Promise<ManagerContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new ManagerAuthError("missing Authorization header", 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw new ManagerAuthError("empty bearer token", 401);

  // SAFE token-meta logging — length and dot-count only, NEVER contents.
  // Helps distinguish 401 root causes (env-missing vs real expiry) in
  // Edge Function logs without ever exposing the access_token.
  try {
    console.log("[authenticateManager] token meta", {
      length: token.length,
      dot_count: (token.match(/\./g) || []).length,
    });
  } catch (_) { /* ignore */ }

  // Resolve env via helpers — supports legacy SUPABASE_ANON_KEY and
  // newer SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEYS forms.
  // Without a valid anon/publishable key the apikey header on the
  // /auth/v1/user call is empty and GoTrue rejects the request → 401.
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    try {
      console.warn("[authenticateManager] env not configured", {
        url_set: !!url,
        anon_key_set: !!anonKey,
      });
    } catch (_) { /* ignore */ }
    throw new ManagerAuthError(
      "server not configured: SUPABASE_URL or anon/publishable key missing",
      500,
    );
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pass the token explicitly to getUser(token) — the cleanest server-side
  // validation pattern. Doesn't depend on global.headers Authorization
  // being honored by the supabase-js client's internal auth pipeline.
  const { data: userResp, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userResp?.user) {
    try {
      console.warn("[authenticateManager] getUser failed", {
        error_message: userErr?.message ?? null,
        has_user: !!userResp?.user,
      });
    } catch (_) { /* ignore */ }
    throw new ManagerAuthError("invalid or expired manager JWT", 401);
  }
  const user = userResp.user;

  let staffId: string | null = null;
  try {
    const { data: srow } = await serviceClient
      .from("staff")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    staffId = srow?.id ?? null;
  } catch (_) {
    staffId = null;
  }

  return { userId: user.id, staffId, email: user.email ?? null, userClient };
}

/**
 * Real manager role check, scoped to a venue.
 *
 * Strategy (in order; the first that returns true wins):
 *   1. `has_venue_access(venue_id, 'manager')` via the user's JWT —
 *      this is the canonical RLS helper in this project. It returns
 *      true for manager / admin / owner roles.
 *   2. `venue_members` direct read via the service-role client.
 *      Fallback in case the RPC is not exposed through PostgREST,
 *      or named-parameter conventions don't match.
 *
 * Throws `ManagerAuthError(403)` if neither path confirms manager-or-better
 * access. Calls this once per request, immediately after authenticateManager().
 */
export async function requireVenueManager(
  ctx: ManagerContext,
  serviceClient: SupabaseClient,
  venueId: string,
): Promise<void> {
  if (!venueId) {
    throw new ManagerAuthError("venue_id required for role check", 400);
  }

  // Strategy 1: RPC against the user-scoped client.
  // The project's has_venue_access likely uses p_venue_id/p_min_role
  // OR venue_id/min_role parameter naming — try both.
  for (const params of [
    { p_venue_id: venueId, p_min_role: "manager" },
    { venue_id: venueId, min_role: "manager" },
  ]) {
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (ctx.userClient as any).rpc("has_venue_access", params);
      if (!error && data === true) return;
    } catch (_) { /* try next signature */ }
  }

  // Strategy 2: direct venue_members read via service_role (bypasses RLS).
  // Roles considered manager-or-better: manager, admin, owner.
  try {
    const { data: row } = await serviceClient
      .from("venue_members")
      .select("role")
      .eq("user_id", ctx.userId)
      .eq("venue_id", venueId)
      .in("role", ["manager", "admin", "owner"])
      .maybeSingle();
    if (row && row.role) return;
  } catch (_) { /* table may not exist — fall through */ }

  // Both strategies failed → reject.
  throw new ManagerAuthError(
    "insufficient role: must be manager+ for this venue",
    403,
  );
}

export class ManagerAuthError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

/**
 * Best-effort IP + UA extractor for the audit log.
 */
export function clientMeta(req: Request): { ip: string | null; ua: string | null } {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff?.split(",")[0]?.trim() || null) ??
             req.headers.get("x-real-ip");
  const ua = req.headers.get("user-agent");
  return { ip: ip ?? null, ua: ua ?? null };
}
