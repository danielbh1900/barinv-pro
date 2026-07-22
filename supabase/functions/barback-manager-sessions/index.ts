import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsPreflight, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  authenticateManager,
  ManagerAuthError,
  requireVenueManager,
} from "../_shared/manager.ts";
import {
  diagnoseMissingEnv,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from "../_shared/env.ts";

interface ListBody {
  venue_id: string;
  include_history?: boolean;
  limit?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function openingParItemCount(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return 0;
  return items.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const qty = (row as { qty?: unknown }).qty;
    return typeof qty === "number" && Number.isInteger(qty) && qty > 0;
  }).length;
}

function wholeQuantityText(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error("invalid persisted Opening PAR quantity");
  }
  return BigInt(text).toString();
}

function varianceStatus(
  expected: string,
  received: string,
): "match" | "short" | "over" {
  return BigInt(received) === BigInt(expected)
    ? "match"
    : BigInt(received) < BigInt(expected)
    ? "short"
    : "over";
}

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

  let body: ListBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  if (!body?.venue_id || !UUID_RE.test(body.venue_id)) {
    return errorResponse("valid venue_id required", 400);
  }

  try {
    await requireVenueManager(manager, svc, body.venue_id);
  } catch (error) {
    if (error instanceof ManagerAuthError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("venue authorization failed", 500);
  }

  const limit = Math.max(
    1,
    Math.min(200, Number.isInteger(body.limit) ? Number(body.limit) : 200),
  );
  let query = svc.from("barback_sessions")
    .select(
      "id, venue_id, night_id, bar_id, allowed_bars, allowed_staff, nickname, issued_by, issued_at, expires_at, revoked_at, pilot_mode, rehearsal_mode, opening_par_config",
    )
    .eq("venue_id", body.venue_id)
    .order("issued_at", { ascending: false })
    .limit(limit);
  if (body.include_history !== true) {
    query = query.is("revoked_at", null).gt(
      "expires_at",
      new Date().toISOString(),
    );
  }
  const { data, error } = await query;
  if (error) return errorResponse("session list failed: " + error.message, 500);

  const sessionIds = (data ?? []).map((row) => row.id);
  let receiptRows: Array<Record<string, unknown>> = [];
  let completionRows: Array<Record<string, unknown>> = [];
  if (sessionIds.length) {
    const [receiptResult, completionResult] = await Promise.all([
      svc.from("barback_opening_par_receipts")
        .select(
          "session_id, destination_id, staff_id, item_id, expected_quantity, received_quantity:received_quantity::text, confirmed_at",
        )
        .in("session_id", sessionIds),
      svc.from("barback_opening_par_completions")
        .select(
          "session_id, staff_id, completed_by, completed_at, confirmed_row_count",
        )
        .in("session_id", sessionIds),
    ]);
    if (receiptResult.error) {
      return errorResponse(
        "Opening PAR reporting failed: " + receiptResult.error.message,
        500,
      );
    }
    if (completionResult.error) {
      return errorResponse(
        "Opening PAR completion reporting failed: " +
          completionResult.error.message,
        500,
      );
    }
    receiptRows = (receiptResult.data ?? []) as Array<Record<string, unknown>>;
    completionRows = (completionResult.data ?? []) as Array<
      Record<string, unknown>
    >;
  }

  const receiptsBySession = new Map<string, Array<Record<string, unknown>>>();
  for (const receipt of receiptRows) {
    const id = String(receipt.session_id || "");
    if (!receiptsBySession.has(id)) receiptsBySession.set(id, []);
    receiptsBySession.get(id)?.push(receipt);
  }
  const completionsBySession = new Map<
    string,
    Array<Record<string, unknown>>
  >();
  for (const completion of completionRows) {
    const id = String(completion.session_id || "");
    if (!completionsBySession.has(id)) completionsBySession.set(id, []);
    completionsBySession.get(id)?.push(completion);
  }

  const now = Date.now();
  const sessions = (data ?? []).map((row) => {
    const destinations = new Set<string>();
    if (row.bar_id) destinations.add(row.bar_id);
    for (const id of Array.isArray(row.allowed_bars) ? row.allowed_bars : []) {
      if (typeof id === "string" && id) destinations.add(id);
    }
    const status = row.revoked_at
      ? "revoked"
      : (+new Date(row.expires_at) <= now ? "expired" : "active");
    const openingParCount = openingParItemCount(row.opening_par_config);
    const sessionReceipts = receiptsBySession.get(row.id) ?? [];
    const sessionCompletions = completionsBySession.get(row.id) ?? [];
    const varianceCounts = { match: 0, short: 0, over: 0 };
    const varianceRows = sessionReceipts.map((receipt) => {
      const expected = wholeQuantityText(receipt.expected_quantity);
      const received = wholeQuantityText(receipt.received_quantity);
      const variance = (BigInt(received) - BigInt(expected)).toString();
      const variance_status = varianceStatus(expected, received);
      varianceCounts[variance_status] += 1;
      return {
        destination_id: receipt.destination_id,
        staff_id: receipt.staff_id,
        item_id: receipt.item_id,
        expected_quantity: expected,
        received_quantity: received,
        variance,
        variance_status,
        confirmed_at: receipt.confirmed_at,
      };
    }).filter((receipt) => receipt.variance !== "0");
    return {
      session_id: row.id,
      venue_id: row.venue_id,
      night_id: row.night_id,
      primary_destination_id: row.bar_id ?? null,
      nickname: row.nickname ?? null,
      issued_by: row.issued_by ?? null,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at ?? null,
      status,
      allowed_staff_count: Array.isArray(row.allowed_staff)
        ? row.allowed_staff.length
        : 0,
      destination_count: destinations.size,
      opening_par_item_count: openingParCount,
      opening_par_required_per_staff: openingParCount * destinations.size,
      opening_par_progress: {
        confirmed_count: sessionReceipts.length,
        completed_staff_count: sessionCompletions.length,
        match_count: varianceCounts.match,
        short_count: varianceCounts.short,
        over_count: varianceCounts.over,
        variance_rows: varianceRows,
        completions: sessionCompletions.map((completion) => ({
          staff_id: completion.staff_id,
          completed_by: completion.completed_by,
          completed_at: completion.completed_at,
          confirmed_row_count: completion.confirmed_row_count,
        })),
      },
      pilot_mode: row.pilot_mode === true,
      rehearsal_mode: row.rehearsal_mode === true,
    };
  });

  return jsonResponse({ sessions });
});
