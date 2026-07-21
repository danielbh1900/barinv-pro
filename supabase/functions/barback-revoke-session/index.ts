import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsPreflight, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  authenticateManager,
  clientMeta,
  ManagerAuthError,
  requireVenueManager,
} from "../_shared/manager.ts";
import {
  diagnoseMissingEnv,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from "../_shared/env.ts";

interface RevokeBody {
  venue_id: string;
  session_id: string;
  reason?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const missing = diagnoseMissingEnv();
  if (missing) {
    return errorResponse("server not configured: missing " + missing, 500);
  }
  const svc = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let manager;
  try {
    manager = await authenticateManager(req, svc);
  } catch (error) {
    if (error instanceof ManagerAuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("manager authentication failed", 500);
  }

  let body: RevokeBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  if (!body?.venue_id || !UUID_RE.test(body.venue_id)) {
    return errorResponse("valid venue_id required", 400);
  }
  if (!body?.session_id || !UUID_RE.test(body.session_id)) {
    return errorResponse("valid exact session_id required", 400);
  }

  try {
    await requireVenueManager(manager, svc, body.venue_id);
  } catch (error) {
    if (error instanceof ManagerAuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("venue authorization failed", 500);
  }
  if (!manager.staffId) {
    return errorResponse("manager is not linked to a staff record", 403);
  }

  const { data: current, error: lookupError } = await svc.from(
    "barback_sessions",
  )
    .select("id, venue_id, night_id, revoked_at")
    .eq("id", body.session_id)
    .eq("venue_id", body.venue_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (lookupError) {
    return errorResponse("session lookup failed: " + lookupError.message, 500);
  }
  if (!current) {
    return errorResponse("session not found in venue or already revoked", 409);
  }

  const revokedAt = new Date().toISOString();
  const { data: revoked, error: revokeError } = await svc.from(
    "barback_sessions",
  )
    .update({ revoked_at: revokedAt, revoked_by: manager.staffId })
    .eq("id", body.session_id)
    .eq("venue_id", body.venue_id)
    .is("revoked_at", null)
    .select("id, revoked_at")
    .maybeSingle();
  if (revokeError) {
    return errorResponse("session revoke failed: " + revokeError.message, 500);
  }
  if (!revoked) {
    return errorResponse(
      "session changed before revocation; no row modified",
      409,
    );
  }

  const reason = typeof body.reason === "string"
    ? body.reason.trim().slice(0, 300)
    : "";
  const { ip, ua } = clientMeta(req);
  const { error: auditError } = await svc.from("barback_audit_log").insert({
    session_id: current.id,
    staff_id: manager.staffId,
    action: "session_revoked",
    ip,
    user_agent: ua,
    detail: { reason: reason || null, exact_session: true },
  });
  if (auditError) {
    const { data: rolledBack, error: rollbackError } = await svc.from(
      "barback_sessions",
    )
      .update({ revoked_at: null, revoked_by: null })
      .eq("id", body.session_id)
      .eq("venue_id", body.venue_id)
      .eq("revoked_at", revokedAt)
      .select("id")
      .maybeSingle();
    if (rollbackError || !rolledBack) {
      return errorResponse(
        "session audit failed and automatic revoke rollback failed",
        500,
      );
    }
    return errorResponse("session audit failed; revocation rolled back", 500);
  }

  return jsonResponse({
    session_id: revoked.id,
    revoked_at: revoked.revoked_at,
  });
});
