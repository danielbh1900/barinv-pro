import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsPreflight, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { clientMeta } from "../_shared/manager.ts";
import { decodeJwt } from "../_shared/jwt.ts";
import {
  diagnoseMissingEnv,
  getSupabaseJwtSecret,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from "../_shared/env.ts";

interface ChecklistBody {
  action: "list" | "confirm";
  destination_id?: string;
  item_id?: string;
  qty?: unknown;
  session_id?: unknown;
}

interface ReceiptRow {
  session_id: string;
  destination_id: string;
  item_id: string;
  status: "received";
  confirmed_at: string;
  confirmed_by: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeReceipt(row: ReceiptRow) {
  return {
    destination_id: row.destination_id,
    item_id: row.item_id,
    status: "received",
    confirmed_at: row.confirmed_at,
    confirmed_by: row.confirmed_by,
  };
}

Deno.serve(async (req: Request) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  const missing = diagnoseMissingEnv({ needJwtSecret: true });
  if (missing) {
    return errorResponse("server not configured: missing " + missing, 500);
  }
  const svc = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return errorResponse("missing Barback authorization", 401);
  }
  let claims: Record<string, unknown>;
  try {
    claims = await decodeJwt(
      authorization.slice(7).trim(),
      getSupabaseJwtSecret(),
    );
  } catch (_) {
    return errorResponse("invalid Barback authorization", 401);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionId = typeof claims.session_id === "string"
    ? claims.session_id
    : "";
  const venueId = typeof claims.venue_id === "string" ? claims.venue_id : "";
  const nightId = typeof claims.night_id === "string" ? claims.night_id : "";
  const staffId = typeof claims.staff_id === "string" ? claims.staff_id : "";
  if (
    claims.iss !== "barinv-barback" || claims.role !== "barback_user" ||
    claims.barback_role !== "barback" || claims.sub !== sessionId ||
    typeof claims.exp !== "number" || claims.exp <= nowSeconds ||
    !UUID_RE.test(sessionId) || !UUID_RE.test(venueId) ||
    !UUID_RE.test(nightId) || !UUID_RE.test(staffId)
  ) return errorResponse("expired or invalid Barback authorization", 401);

  let body: ChecklistBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  if (body?.session_id !== undefined) {
    return errorResponse("session_id is derived from authorization", 400);
  }
  if (body?.qty !== undefined) {
    return errorResponse("target quantity is read-only", 400);
  }
  if (body?.action !== "list" && body?.action !== "confirm") {
    return errorResponse("action must be list or confirm", 400);
  }

  const { data: session, error: sessionError } = await svc.from(
    "barback_sessions",
  )
    .select(
      "id, venue_id, night_id, bar_id, allowed_bars, allowed_staff, expires_at, revoked_at, opening_par_config",
    )
    .eq("id", sessionId).eq("venue_id", venueId).eq("night_id", nightId)
    .maybeSingle();
  if (sessionError) {
    return errorResponse(
      "session validation failed: " + sessionError.message,
      500,
    );
  }
  if (!session) return errorResponse("session not found", 404);
  if (session.revoked_at) return errorResponse("session revoked", 403);
  if (+new Date(session.expires_at) <= Date.now()) {
    return errorResponse("session expired", 403);
  }
  if (
    !Array.isArray(session.allowed_staff) ||
    !session.allowed_staff.includes(staffId)
  ) {
    return errorResponse("staff is outside this session", 403);
  }
  const { data: night, error: nightError } = await svc.from("nights")
    .select("id, active").eq("id", nightId).eq("venue_id", venueId)
    .maybeSingle();
  if (nightError) {
    return errorResponse("night validation failed: " + nightError.message, 500);
  }
  if (!night || night.active === false) {
    return errorResponse("This night is closed.", 403);
  }

  const config = session.opening_par_config as {
    enabled?: unknown;
    version?: unknown;
    items?: Array<{ item_id?: unknown; qty?: unknown }>;
  } | null;
  if (
    !config || config.enabled !== true || config.version !== 1 ||
    !Array.isArray(config.items)
  ) {
    return errorResponse("Opening PAR is unavailable for this session", 403);
  }
  const allowedItemIds = new Set(
    config.items.filter((row) =>
      row && typeof row.item_id === "string" && typeof row.qty === "number" &&
      Number.isInteger(row.qty) && row.qty > 0
    ).map((row) => row.item_id as string),
  );
  const allowedDestinationIds = new Set<string>();
  if (session.bar_id) allowedDestinationIds.add(session.bar_id);
  for (
    const id of Array.isArray(session.allowed_bars) ? session.allowed_bars : []
  ) {
    if (typeof id === "string" && id) allowedDestinationIds.add(id);
  }

  if (body.action === "list") {
    const { data, error } = await svc.from("barback_opening_par_receipts")
      .select(
        "session_id, destination_id, item_id, status, confirmed_at, confirmed_by",
      )
      .eq("session_id", sessionId).order("confirmed_at", { ascending: true });
    if (error) {
      return errorResponse("checklist load failed: " + error.message, 500);
    }
    return jsonResponse({
      receipts: (data ?? [])
        .filter((row) =>
          allowedDestinationIds.has(row.destination_id) &&
          allowedItemIds.has(row.item_id)
        )
        .map((row) => safeReceipt(row as ReceiptRow)),
    });
  }

  if (!body.destination_id || !UUID_RE.test(body.destination_id)) {
    return errorResponse("valid destination_id required", 400);
  }
  if (!body.item_id || !UUID_RE.test(body.item_id)) {
    return errorResponse("valid item_id required", 400);
  }
  if (!allowedDestinationIds.has(body.destination_id)) {
    return errorResponse("destination is outside this session", 403);
  }
  if (!allowedItemIds.has(body.item_id)) {
    return errorResponse("item is outside this Opening PAR snapshot", 403);
  }

  const [{ data: nightDestination }, { data: destination }] = await Promise.all(
    [
      svc.from("night_bars").select("bar_id").eq("night_id", nightId).eq(
        "bar_id",
        body.destination_id,
      ).maybeSingle(),
      svc.from("bars").select("id, active").eq("id", body.destination_id).eq(
        "venue_id",
        venueId,
      ).maybeSingle(),
    ],
  );
  if (!nightDestination || !destination || destination.active === false) {
    return errorResponse("destination is no longer active for this night", 403);
  }

  const insertedAt = new Date().toISOString();
  const receipt: ReceiptRow = {
    session_id: sessionId,
    destination_id: body.destination_id,
    item_id: body.item_id,
    status: "received",
    confirmed_at: insertedAt,
    confirmed_by: staffId,
  };
  const { data: inserted, error: insertError } = await svc.from(
    "barback_opening_par_receipts",
  )
    .insert(receipt)
    .select(
      "session_id, destination_id, item_id, status, confirmed_at, confirmed_by",
    )
    .maybeSingle();
  if (insertError && insertError.code !== "23505") {
    return errorResponse("confirmation failed: " + insertError.message, 500);
  }
  let persisted = inserted as ReceiptRow | null;
  if (!persisted) {
    const { data: existing, error: existingError } = await svc.from(
      "barback_opening_par_receipts",
    )
      .select(
        "session_id, destination_id, item_id, status, confirmed_at, confirmed_by",
      )
      .eq("session_id", sessionId).eq("destination_id", body.destination_id).eq(
        "item_id",
        body.item_id,
      )
      .maybeSingle();
    if (existingError || !existing) {
      return errorResponse(
        "confirmation retry could not be reconstructed",
        500,
      );
    }
    persisted = existing as ReceiptRow;
  } else {
    const { ip, ua } = clientMeta(req);
    await svc.from("barback_audit_log").insert({
      session_id: sessionId,
      staff_id: staffId,
      action: "opening_par_received",
      ip,
      user_agent: ua,
      detail: { destination_id: body.destination_id, item_id: body.item_id },
    });
  }

  return jsonResponse({ receipt: safeReceipt(persisted) });
});
