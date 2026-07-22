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
  action: "list" | "status" | "confirm";
  destination_id?: unknown;
  item_id?: unknown;
  received_quantity?: unknown;
  expected_quantity?: unknown;
  qty?: unknown;
  session_id?: unknown;
  staff_id?: unknown;
}

interface OpeningParItem {
  item_id: string;
  qty: number;
}

interface ReceiptRow {
  session_id: string;
  destination_id: string;
  staff_id: string;
  item_id: string;
  expected_quantity: number;
  received_quantity: string;
  confirmed_at: string;
}

interface CompletionRow {
  session_id: string;
  staff_id: string;
  completed_at: string;
  completed_by: string;
  confirmed_row_count: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalWholeQuantity(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) return null;
    return String(raw);
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  return BigInt(text).toString();
}

function safeReceipt(row: ReceiptRow) {
  const received = canonicalWholeQuantity(row.received_quantity);
  if (received == null) {
    throw new Error("persisted Received quantity is invalid");
  }
  const variance = BigInt(received) - BigInt(row.expected_quantity);
  return {
    destination_id: row.destination_id,
    staff_id: row.staff_id,
    item_id: row.item_id,
    expected_quantity: row.expected_quantity,
    received_quantity: received,
    variance: variance.toString(),
    variance_status: variance === 0n
      ? "match"
      : variance < 0n
      ? "short"
      : "over",
    confirmed_at: row.confirmed_at,
  };
}

function safeCompletion(row: CompletionRow | null) {
  if (!row) return null;
  return {
    staff_id: row.staff_id,
    completed_by: row.completed_by,
    completed_at: row.completed_at,
    confirmed_row_count: row.confirmed_row_count,
  };
}

function normalizeConfig(
  raw: unknown,
): { enabled: boolean; items: OpeningParItem[] } {
  if (raw == null) return { enabled: false, items: [] };
  if (!raw || typeof raw !== "object") {
    throw new Error("Opening PAR configuration is malformed");
  }
  const config = raw as {
    enabled?: unknown;
    version?: unknown;
    items?: unknown;
  };
  if (
    config.enabled !== true || config.version !== 1 ||
    !Array.isArray(config.items)
  ) {
    throw new Error("Opening PAR configuration is malformed");
  }
  const seen = new Set<string>();
  const items: OpeningParItem[] = [];
  for (const rawItem of config.items) {
    const item = rawItem as { item_id?: unknown; qty?: unknown };
    if (
      !item || typeof item.item_id !== "string" ||
      !UUID_RE.test(item.item_id) ||
      typeof item.qty !== "number" || !Number.isInteger(item.qty) ||
      item.qty <= 0 ||
      seen.has(item.item_id)
    ) throw new Error("Opening PAR configuration is malformed");
    seen.add(item.item_id);
    items.push({ item_id: item.item_id, qty: item.qty });
  }
  if (!items.length) {
    throw new Error("Opening PAR configuration has no required items");
  }
  return { enabled: true, items };
}

function progress(
  requiredCount: number,
  confirmedCount: number,
  completion: CompletionRow | null,
) {
  return {
    required_count: requiredCount,
    confirmed_count: confirmedCount,
    remaining_count: Math.max(requiredCount - confirmedCount, 0),
    completed: !!completion,
    completion: safeCompletion(completion),
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
  if (body?.session_id !== undefined || body?.staff_id !== undefined) {
    return errorResponse(
      "session and staff are derived from authorization",
      400,
    );
  }
  if (body?.qty !== undefined || body?.expected_quantity !== undefined) {
    return errorResponse("Expected PAR is read-only", 400);
  }
  if (
    body?.action !== "list" && body?.action !== "status" &&
    body?.action !== "confirm"
  ) {
    return errorResponse("action must be status or confirm", 400);
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

  const [
    { data: night, error: nightError },
    { data: staff, error: staffError },
  ] = await Promise.all([
    svc.from("nights").select("id, active").eq("id", nightId).eq(
      "venue_id",
      venueId,
    ).maybeSingle(),
    svc.from("staff").select("id, active").eq("id", staffId).eq(
      "venue_id",
      venueId,
    ).maybeSingle(),
  ]);
  if (nightError) {
    return errorResponse("night validation failed: " + nightError.message, 500);
  }
  if (staffError) {
    return errorResponse("staff validation failed: " + staffError.message, 500);
  }
  if (!night || night.active === false) {
    return errorResponse("This night is closed.", 403);
  }
  if (!staff || staff.active === false) {
    return errorResponse("staff is inactive", 403);
  }

  const { data: runtimeEnabled, error: runtimeError } = await svc.rpc(
    "barback_opening_par_runtime_enabled",
    { p_venue_id: venueId },
  );
  if (runtimeError) {
    return errorResponse("Opening PAR gate verification failed", 503);
  }
  if (runtimeEnabled !== true) {
    return jsonResponse({
      runtime_enabled: false,
      required: false,
      receipts: [],
      ...progress(0, 0, null),
    });
  }

  let config: { enabled: boolean; items: OpeningParItem[] };
  try {
    config = normalizeConfig(session.opening_par_config);
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Opening PAR configuration is malformed",
      500,
    );
  }
  if (!config.enabled) {
    return jsonResponse({
      runtime_enabled: true,
      required: false,
      receipts: [],
      ...progress(0, 0, null),
    });
  }

  const allowedDestinationIds = new Set<string>();
  if (typeof session.bar_id === "string" && UUID_RE.test(session.bar_id)) {
    allowedDestinationIds.add(session.bar_id);
  }
  for (
    const id of Array.isArray(session.allowed_bars) ? session.allowed_bars : []
  ) {
    if (typeof id === "string" && UUID_RE.test(id)) {
      allowedDestinationIds.add(id);
    }
  }
  const destinationIds = Array.from(allowedDestinationIds);
  if (!destinationIds.length) {
    return errorResponse("Opening PAR has no authorized destinations", 500);
  }

  const itemIds = config.items.map((item) => item.item_id);
  const [
    { data: destinations, error: destinationError },
    { data: nightDestinations, error: nightDestinationError },
    { data: items, error: itemError },
  ] = await Promise.all([
    svc.from("bars").select("id").eq("venue_id", venueId).eq("active", true).in(
      "id",
      destinationIds,
    ),
    svc.from("night_bars").select("bar_id").eq("night_id", nightId).in(
      "bar_id",
      destinationIds,
    ),
    svc.from("items").select("id").eq("venue_id", venueId).eq("active", true)
      .in("id", itemIds),
  ]);
  if (destinationError || nightDestinationError || itemError) {
    return errorResponse("Opening PAR scope verification failed", 503);
  }
  if (
    new Set((destinations ?? []).map((row) => row.id)).size !==
      destinationIds.length ||
    new Set((nightDestinations ?? []).map((row) => row.bar_id)).size !==
      destinationIds.length ||
    new Set((items ?? []).map((row) => row.id)).size !== itemIds.length
  ) return errorResponse("Opening PAR scope is no longer valid", 403);

  const requiredCount = destinationIds.length * itemIds.length;
  if (body.action === "list" || body.action === "status") {
    const [
      { data: receiptData, error: receiptError },
      { data: completionData, error: completionError },
    ] = await Promise.all([
      svc.from("barback_opening_par_receipts")
        .select(
          "session_id, destination_id, staff_id, item_id, expected_quantity, received_quantity:received_quantity::text, confirmed_at",
        )
        .eq("session_id", sessionId).eq("staff_id", staffId).order(
          "confirmed_at",
          { ascending: true },
        ),
      svc.from("barback_opening_par_completions")
        .select(
          "session_id, staff_id, completed_at, completed_by, confirmed_row_count",
        )
        .eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle(),
    ]);
    if (receiptError) {
      return errorResponse(
        "checklist load failed: " + receiptError.message,
        500,
      );
    }
    if (completionError) {
      return errorResponse(
        "checklist completion load failed: " + completionError.message,
        500,
      );
    }
    const receipts = (receiptData ?? []).filter((row) =>
      allowedDestinationIds.has(row.destination_id) &&
      itemIds.includes(row.item_id)
    ) as ReceiptRow[];
    const completion = (completionData ?? null) as CompletionRow | null;
    if (completion && receipts.length !== requiredCount) {
      return errorResponse(
        "Opening PAR completion integrity check failed",
        500,
      );
    }
    return jsonResponse({
      runtime_enabled: true,
      required: true,
      receipts: receipts.map(safeReceipt),
      ...progress(requiredCount, receipts.length, completion),
    });
  }

  if (
    typeof body.destination_id !== "string" ||
    !UUID_RE.test(body.destination_id)
  ) {
    return errorResponse("valid destination_id required", 400);
  }
  if (typeof body.item_id !== "string" || !UUID_RE.test(body.item_id)) {
    return errorResponse("valid item_id required", 400);
  }
  const receivedQuantity = canonicalWholeQuantity(body.received_quantity);
  if (receivedQuantity == null) {
    return errorResponse(
      "Received quantity must be a whole number greater than or equal to zero",
      400,
    );
  }
  if (!allowedDestinationIds.has(body.destination_id)) {
    return errorResponse("destination is outside this session", 403);
  }
  if (!itemIds.includes(body.item_id)) {
    return errorResponse("item is outside this Opening PAR snapshot", 403);
  }

  const { ip, ua } = clientMeta(req);
  const { data: confirmationData, error: confirmationError } = await svc.rpc(
    "barback_confirm_opening_par",
    {
      p_session_id: sessionId,
      p_venue_id: venueId,
      p_night_id: nightId,
      p_staff_id: staffId,
      p_destination_id: body.destination_id,
      p_item_id: body.item_id,
      p_received_quantity: receivedQuantity,
      p_ip: ip,
      p_user_agent: ua,
    },
  );
  if (confirmationError) {
    const conflict = confirmationError.code === "23505";
    return errorResponse(
      conflict
        ? "This row was already confirmed with a different Received quantity"
        : "confirmation failed",
      conflict ? 409 : 500,
    );
  }
  const result = Array.isArray(confirmationData)
    ? confirmationData[0]
    : confirmationData;
  if (!result) return errorResponse("confirmation returned no result", 500);
  const receipt = safeReceipt({
    session_id: sessionId,
    destination_id: result.destination_id,
    staff_id: result.staff_id,
    item_id: result.item_id,
    expected_quantity: result.expected_quantity,
    received_quantity: result.received_quantity,
    confirmed_at: result.confirmed_at,
  });
  return jsonResponse({
    runtime_enabled: true,
    required: true,
    receipt,
    required_count: result.required_count,
    confirmed_count: result.confirmed_count,
    remaining_count: result.remaining_count,
    completed: result.completed === true,
    completion: result.completed
      ? {
        staff_id: result.staff_id,
        completed_by: result.completed_by,
        completed_at: result.completed_at,
        confirmed_row_count: result.confirmed_count,
      }
      : null,
  });
});
