// ════════════════════════════════════════════════════════════════════
// barback-login
// ────────────────────────────────────────────────────────────────────
// Called by `barback.html` after the barback enters their PIN.
//
// Input (POST JSON, anonymous — no Authorization header required):
//   {
//     token:    "base64url(json)",   // session_id + scope
//     staff_id: uuid,
//     pin:      "4-6 digit PIN",
//   }
//
// Verifies:
//   • token decodes, session exists, not revoked, not expired
//   • staff_id is allowed by the session
//   • PIN matches barback_pins.pin_hash, account not locked
//
// On success:
//   • Signs an HS256 JWT with SUPABASE_JWT_SECRET, role=barback_user
//   • Returns the JWT + a scoped bundle (items / bars / staff name)
//     so the barback page can operate fully even on a phone that has
//     never opened the production BARINV app.
//
// Rate limit:
//   barback_pins.failed_count + locked_until — 5 misses → 5 min lock.
// ════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsPreflight, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { clientMeta } from "../_shared/manager.ts";
import { verifyPin } from "../_shared/pin.ts";
import { signBarbackJwt, nowEpochSeconds, BarbackJwtClaims, verifyBarbackSessionToken } from "../_shared/jwt.ts";
import { diagnoseMissingEnv, getSupabaseJwtSecret, getSupabaseServiceKey, getSupabaseUrl } from "../_shared/env.ts";

const RATE_LIMIT_FAIL_THRESHOLD = 5;
const RATE_LIMIT_LOCK_MINUTES   = 5;
const JWT_TTL_HOURS_MAX         = 8;

// BARINV_SECURITY_PHASE2B_TRANCHE_B_F7 — per-IP login rate limit.
// Counts non-success login events from the same IP in the last
// IP_RATE_LIMIT_WINDOW_MIN minutes via barback_audit_log (no new schema).
// Successful logins (action='login_ok') do NOT count toward the limit, so
// a busy bar where the whole staff signs in once each is unaffected.
const IP_RATE_LIMIT_THRESHOLD  = 30;
const IP_RATE_LIMIT_WINDOW_MIN = 5;
const LEGACY_TOKEN_RETIRED_MESSAGE =
  "This barback link has expired or is no longer supported. Ask your manager for a new Staff Access link.";

interface LoginBody {
  token: string;
  staff_id: string;
  pin: string;
}

function fromBase64UrlToString(s: string): string {
  let v = s.replace(/-/g, "+").replace(/_/g, "/");
  while (v.length % 4 !== 0) v += "=";
  return atob(v);
}

// BARBACK_PIN_LOGIN_OPENING_PAR_NORMALIZER_START
const OPENING_PAR_LOGIN_REGULAR_MODES = ["regular_bar", "bar", "bar_only", "all_bars", "both"];

function normalizeSessionOpeningPar(
  raw: unknown,
  authorizedItems: Array<{ id: string; active?: boolean | null; service_mode?: string | null }>,
) {
  const disabled = () => ({
    value: { enabled: false, version: 1, items: [] as Array<{ item_id: string; qty: number }> },
    malformed: false,
  });
  if (raw == null) return disabled();
  if (!raw || typeof raw !== "object") return { ...disabled(), malformed: true };
  const config = raw as {
    enabled?: unknown;
    version?: unknown;
    configured_at?: unknown;
    items?: unknown;
  };
  if (
    config.enabled !== true || config.version !== 1 ||
    typeof config.configured_at !== "string" || !config.configured_at ||
    !Array.isArray(config.items) || !config.items.length
  ) return { ...disabled(), malformed: true };

  const allowedIds = new Set(
    (authorizedItems || []).filter((item) =>
      item && item.id && item.active !== false &&
      OPENING_PAR_LOGIN_REGULAR_MODES.includes(String(item.service_mode || "").toLowerCase().trim())
    ).map((item) => item.id)
  );
  const seen = new Set<string>();
  const items: Array<{ item_id: string; qty: number }> = [];
  for (const rawItem of config.items) {
    if (!rawItem || typeof rawItem !== "object") return { ...disabled(), malformed: true };
    const itemId = (rawItem as { item_id?: unknown }).item_id;
    const qty = (rawItem as { qty?: unknown }).qty;
    if (
      typeof itemId !== "string" || !itemId || seen.has(itemId) || !allowedIds.has(itemId) ||
      typeof qty !== "number" || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0
    ) return { ...disabled(), malformed: true };
    seen.add(itemId);
    items.push({ item_id: itemId, qty });
  }
  return { value: { enabled: true, version: 1, items }, malformed: false };
}
// BARBACK_PIN_LOGIN_OPENING_PAR_NORMALIZER_END

Deno.serve(async (req: Request) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // Granular env diagnostic — supports legacy SUPABASE_SERVICE_ROLE_KEY
  // and new SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS forms, and reads
  // the JWT signing secret from BARINV_JWT_SECRET (custom secret name —
  // Supabase rejects custom secrets prefixed SUPABASE_). See _shared/env.ts.
  const _envMissing = diagnoseMissingEnv({ needJwtSecret: true });
  if (_envMissing) {
    return errorResponse("server not configured: missing " + _envMissing, 500);
  }
  const SUPABASE_URL = getSupabaseUrl();
  const SERVICE_KEY  = getSupabaseServiceKey();
  const JWT_SECRET   = getSupabaseJwtSecret();
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { ip, ua } = clientMeta(req);

  // ── BARINV_SECURITY_PHASE2B_TRANCHE_B_F7 ─────────────────────────
  // Per-IP rate limit BEFORE any body parse or token decode so attackers
  // can't burn cycles on the server with garbage requests. We count
  // recent non-success login events from this IP via the existing
  // barback_audit_log table (no schema change).
  try {
    const since = new Date(Date.now() - IP_RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString();
    let limitQuery = svc.from("barback_audit_log")
      .select("*", { count: "exact", head: true })
      .like("action", "login_%")
      .neq("action", "login_ok")
      .gte("created_at", since);
    // Distinguish "known IP" from "no IP" — both are tracked, separately.
    limitQuery = ip ? limitQuery.eq("ip", ip) : limitQuery.is("ip", null);
    const { count: recentFails } = await limitQuery;
    if ((recentFails ?? 0) >= IP_RATE_LIMIT_THRESHOLD) {
      // Audit the rejected attempt so operators can see brute-force
      // patterns; never block on audit-write failure.
      try {
        await svc.from("barback_audit_log").insert({
          session_id: null, staff_id: null,
          action: "login_ip_rate_limited", ip, user_agent: ua,
          detail: {
            window_min: IP_RATE_LIMIT_WINDOW_MIN,
            recent_failures: recentFails,
            threshold: IP_RATE_LIMIT_THRESHOLD,
          },
        });
      } catch (_) { /* best-effort */ }
      return errorResponse(
        `too many login attempts from your network — try again in ${IP_RATE_LIMIT_WINDOW_MIN} minutes`,
        429,
        "ip_rate_limited",
      );
    }
  } catch (_e) {
    // If the rate-limit query itself fails (e.g. table missing / DB hiccup),
    // FAIL OPEN. The per-staff lockout (failed_count / locked_until) is the
    // pre-existing line of defence and is unaffected. We log to console so
    // observability picks up the audit-log read failure.
    console.warn("[barback-login] IP rate-limit query failed; falling open");
  }
  // ── BARINV_SECURITY_PHASE2B_TRANCHE_B_F7_END ─────────────────────

  let body: LoginBody;
  try { body = await req.json(); } catch { return errorResponse("invalid JSON", 400); }
  if (!body?.token || !body?.staff_id || !body?.pin) {
    return errorResponse("missing token / staff_id / pin", 400);
  }
  if (!/^[0-9]{4,8}$/.test(body.pin)) {
    return errorResponse("PIN must be 4-8 digits", 400);
  }

  // ── BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 ─────────────────────────
  // Verify the signed barback session token. The shared verifier still
  // understands v1 for migration/diagnostics, but this login boundary
  // intentionally rejects every unsigned single-part token. session_id is
  // read ONLY from the verified v2 payload (never from a raw decode).
  const verifyResult = await verifyBarbackSessionToken(body.token, JWT_SECRET);
  if (!verifyResult.ok) {
    try {
      await svc.from("barback_audit_log").insert({
        session_id: null, staff_id: body.staff_id,
        action: "login_token_invalid", ip, user_agent: ua,
        detail: { reason: verifyResult.reason },
      });
    } catch (_) { /* best-effort */ }
    return errorResponse("session token invalid or tampered", 401, "token_invalid");
  }
  const tokenPayload = verifyResult.payload;
  const tokenVersion = verifyResult.version;
  if (tokenVersion === 1) {
    // Retire unsigned v1 acceptance at the server boundary. Do not decode
    // or look up the embedded session_id, and do not proceed to PIN/session
    // authorization using an unsigned caller-supplied value.
    try {
      await svc.from("barback_audit_log").insert({
        session_id: null, staff_id: body.staff_id,
        action: "login_legacy_token_rejected", ip, user_agent: ua,
        detail: { token_version: 1 },
      });
    } catch (_) { /* best-effort */ }
    return errorResponse(LEGACY_TOKEN_RETIRED_MESSAGE, 410, "legacy_token_retired");
  }
  const sessionId = (tokenPayload?.session_id as string | undefined);
  if (!sessionId) return errorResponse("token missing session_id", 400);
  // ── BARINV_SECURITY_PHASE2B_TRANCHE_B_F6_END ─────────────────────

  // ── Load the session ─────────────────────────────────────────────
  const { data: session, error: sErr } = await svc
    .from("barback_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return errorResponse("session lookup failed: " + sErr.message, 500);
  if (!session) {
    await svc.from("barback_audit_log").insert({
      session_id: null, staff_id: body.staff_id,
      action: "login_unknown_session", ip, user_agent: ua,
      detail: { tried_session_id: sessionId },
    });
    return errorResponse("session not found", 404);
  }
  if (session.revoked_at) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_revoked_session", ip, user_agent: ua, detail: {},
    });
    return errorResponse("session revoked", 403, "revoked");
  }
  if (new Date(session.expires_at) <= new Date()) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_session_expired", ip, user_agent: ua,
      detail: { expires_at: session.expires_at },
    });
    return errorResponse("session expired", 403, "expired");
  }
  if (
    Array.isArray(session.allowed_staff) &&
    session.allowed_staff.length > 0 &&
    !session.allowed_staff.includes(body.staff_id)
  ) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_staff_not_allowed", ip, user_agent: ua, detail: {},
    });
    return errorResponse("staff not authorised for this session", 403);
  }

  // ── Verify PIN ───────────────────────────────────────────────────
  const { data: pinRow } = await svc
    .from("barback_pins")
    .select("*")
    .eq("staff_id", body.staff_id)
    .maybeSingle();
  if (!pinRow) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_no_pin_set", ip, user_agent: ua, detail: {},
    });
    return errorResponse("no PIN set for this staff member — ask manager to assign one", 403);
  }
  if (pinRow.locked_until && new Date(pinRow.locked_until) > new Date()) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_rate_limited", ip, user_agent: ua,
      detail: { locked_until: pinRow.locked_until },
    });
    return errorResponse("too many bad attempts — try again later", 429, "rate_limited");
  }

  const ok = await verifyPin(body.pin, pinRow.pin_hash, pinRow.pin_salt);
  if (!ok) {
    const newFails = (pinRow.failed_count ?? 0) + 1;
    const lockUntil = newFails >= RATE_LIMIT_FAIL_THRESHOLD
      ? new Date(Date.now() + RATE_LIMIT_LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await svc.from("barback_pins")
      .update({ failed_count: newFails, locked_until: lockUntil })
      .eq("staff_id", body.staff_id);
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_bad_pin", ip, user_agent: ua,
      detail: { failed_count: newFails, locked: !!lockUntil },
    });
    return errorResponse(
      lockUntil
        ? `wrong PIN — locked for ${RATE_LIMIT_LOCK_MINUTES} min`
        : "wrong PIN",
      403,
      lockUntil ? "rate_limited" : "wrong_pin",
    );
  }

  // PIN good — reset rate counter, mark last_used_at
  await svc.from("barback_pins")
    .update({ failed_count: 0, locked_until: null, last_used_at: new Date().toISOString() })
    .eq("staff_id", body.staff_id);

  // ── Mint the JWT ─────────────────────────────────────────────────
  const sessionExp = Math.floor(new Date(session.expires_at).getTime() / 1000);
  const maxExp = nowEpochSeconds() + JWT_TTL_HOURS_MAX * 3600;
  const exp = Math.min(sessionExp, maxExp);

  // Resolve staff name + role. PLAN-2026-06-11 — role is added so the
  // operator page can switch item scope (barback → bar items; server →
  // VIP-only). staff.role is a comma-separated label set; the frontend
  // derives a single operator mode from it. Display/scope use only — auth
  // is unchanged (JWT still barback_user, RLS unchanged).
  const { data: staffRow } = await svc
    .from("staff").select("id, name, role").eq("id", body.staff_id).maybeSingle();

  // BARBACK_STAFF_SCOPED_DESTINATIONS_START
  // A multi-staff link may include many destinations, but the signed Barback
  // JWT and returned bundle must be narrowed to the specific staff member who
  // entered their PIN. Otherwise Doshan can see Serjio's bars and vice versa.
  const sessionDestinationIds: string[] = [];
  const sessionDestinationSeen = new Set<string>();
  const addSessionDestination = (id: unknown) => {
    if (typeof id !== "string" || !id.trim() || sessionDestinationSeen.has(id)) return;
    sessionDestinationSeen.add(id);
    sessionDestinationIds.push(id);
  };
  addSessionDestination(session.bar_id);
  for (const id of Array.isArray(session.allowed_bars) ? session.allowed_bars : []) {
    addSessionDestination(id);
  }

  const { data: assignmentRow, error: assignmentError } = await svc
    .from("night_staff_assignments")
    .select("staff_id, role, allowed_bar_ids, revoked")
    .eq("night_id", session.night_id)
    .eq("staff_id", body.staff_id)
    .maybeSingle();

  if (assignmentError) {
    return errorResponse("staff assignment scope lookup failed: " + assignmentError.message, 500);
  }
  if (!assignmentRow || assignmentRow.revoked === true) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_staff_assignment_missing", ip, user_agent: ua, detail: {},
    });
    return errorResponse("staff is not assigned for this night", 403);
  }

  const staffDestinationSet = new Set(
    (Array.isArray(assignmentRow.allowed_bar_ids) ? assignmentRow.allowed_bar_ids : [])
      .filter((id: unknown): id is string => typeof id === "string" && !!id.trim()),
  );
  const scopedAllowedBars = sessionDestinationIds.filter((id) => staffDestinationSet.has(id));

  if (!scopedAllowedBars.length) {
    await svc.from("barback_audit_log").insert({
      session_id: session.id, staff_id: body.staff_id,
      action: "login_staff_no_session_destinations", ip, user_agent: ua,
      detail: { session_destination_count: sessionDestinationIds.length },
    });
    return errorResponse("staff has no assigned destination in this session", 403);
  }

  const scopedPrimaryBarId = scopedAllowedBars.includes(session.bar_id)
    ? session.bar_id
    : scopedAllowedBars[0];
  // BARBACK_STAFF_SCOPED_DESTINATIONS_END

  const claims: BarbackJwtClaims = {
    aud: "authenticated",
    iss: "barinv-barback",
    sub: session.id,            // JWT subject = session_id (never collides with auth.users)
    role: "barback_user",
    exp,
    iat: nowEpochSeconds(),
    barback_role: "barback",
    session_id:   session.id,
    venue_id:     session.venue_id,
    night_id:     session.night_id,
    bar_id:       scopedPrimaryBarId,
    allowed_bars: scopedAllowedBars.join(","),
    staff_id:     body.staff_id,
    staff_name:   staffRow?.name ?? undefined,
    nickname:     session.nickname ?? undefined,
  };
  const jwt = await signBarbackJwt(claims, JWT_SECRET);

  // ── Fetch scoped bundle the page needs to operate ────────────────
  // Items + bars + staff list. We do this server-side because the
  // barback role is forbidden from reading these tables directly.
  const venueId = session.venue_id;
  const [itemsRes, barsRes, staffRes, bartenderAssignmentsRes] = await Promise.all([
    svc.from("items")
       // PLAN-2026-06-04 — schema audit (read-only introspection) confirmed
       // public.items has columns: id, name, sku, category, unit, active,
       // unit_size, bottle_size_ml, venue_id (plus a number of telemetry/
       // pricing columns). The previous SELECT requested non-existent
       // `size`, `barcode`, `code` — PostgREST returned PGRST204 ("column
       // not found"), itemsRes.data was null, bundle.items defaulted to []
       // and the barback scanner had nothing to look up. sku is the de
       // facto barcode (UPC stored as 13-digit zero-padded text) — the
       // frontend's normalizeBarcodeLike() handles the UPC-A vs EAN-13
       // padding mismatch. Alias unit_size → size so the existing front
       // end (it.size) renders the bottle size unchanged.
       // PLAN-2026-06-11 — add service_mode so the barback page can hide
       // VIP/table-only stock (service_mode='vip_only') from barbacks. The
       // column already exists and is populated; this only surfaces it in
       // the bundle. No other change.
       // PLAN-2026-06-19 — add empty_bottle_weight_g / full_bottle_weight_g so the
       // barback page can use DB bottle-weight profiles (tare/full) for the
       // Remaining % estimate first, before any local override. Both columns
       // already exist and are populated for many items; this only surfaces
       // them in the bundle. Additive only — no auth/role/scope/JWT change.
       // BARBACK_OPENING_PAR_V1 — retain the existing default opening quantity
       // as a read-only bundle field. The Barback Opening editor is initialized
       // from opening_par_config below, never from this live Master PAR value.
       .select("id, name, sku, size:unit_size, bottle_size_ml, active, service_mode, empty_bottle_weight_g, full_bottle_weight_g, par_level, image_url")
       // Treat `active = TRUE` AND `active IS NULL` as eligible. Items
       // with explicit `active = FALSE` are excluded from the bundle so
       // the scanner / dropdown isn't bloated by discontinued lines.
       .or("active.is.true,active.is.null")
       .eq("venue_id", venueId)
       .order("name"),
    svc.from("bars")
       // PLAN-2026-06-11 — add bar_type so the operator page can detect a
       // TABLE/VIP session (bar_type='table') vs a BAR session and pick the
       // correct item scope, independent of the staff member's role labels.
       .select("id, name, bar_type")
       .eq("venue_id", venueId)
       .in("id", scopedAllowedBars)
       .order("name"),
    svc.from("staff")
       .select("id, name")
       .eq("venue_id", venueId)
       .order("name"),
    svc.from("night_staff_assignments")
       .select("staff_id, role, allowed_bar_ids, revoked")
       .eq("night_id", session.night_id),
  ]);

  // BARBACK_BARTENDER_BAR_LABELS_START
  // UI-only decoration: show the bartender assigned to each scoped bar.
  // Auth/scope still comes from scopedAllowedBars and JWT claims above.
  const staffNameById = new Map(
    (staffRes.data ?? []).map((staff) => [staff.id, staff.name || ""]),
  );
  const scopedBarIdSet = new Set(scopedAllowedBars);
  const bartenderNamesByBarId = new Map<string, string[]>();

  const hasRoleToken = (role: unknown, token: string) =>
    String(role || "")
      .toLowerCase()
      .split(/[,;|/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .includes(token);

  if (bartenderAssignmentsRes.error) {
    console.warn("[barback-login] bartender bar label lookup failed", {
      code: bartenderAssignmentsRes.error.code,
      message: bartenderAssignmentsRes.error.message,
    });
  } else {
    for (const row of bartenderAssignmentsRes.data ?? []) {
      if (row.revoked === true || !hasRoleToken(row.role, "bartender")) continue;
      const staffName = staffNameById.get(row.staff_id);
      if (!staffName) continue;

      for (const barId of Array.isArray(row.allowed_bar_ids) ? row.allowed_bar_ids : []) {
        if (!scopedBarIdSet.has(barId)) continue;
        const names = bartenderNamesByBarId.get(barId) ?? [];
        if (!names.includes(staffName)) names.push(staffName);
        bartenderNamesByBarId.set(barId, names);
      }
    }
  }

  const barsWithBartenderLabels = (barsRes.data ?? []).map((bar) => {
    const bartenderNames = bartenderNamesByBarId.get(bar.id) ?? [];
    return bartenderNames.length
      ? {
        ...bar,
        bartender_name: bartenderNames.join(", "),
        bartender_names: bartenderNames,
      }
      : bar;
  });
  // BARBACK_BARTENDER_BAR_LABELS_END

  const openingParResult = normalizeSessionOpeningPar(
    session.opening_par_config,
    itemsRes.data ?? [],
  );
  if (openingParResult.malformed) {
    // Safe diagnostic only: no PIN, token, item IDs, quantities, or config.
    console.warn("[barback-login] malformed Opening PAR config; feature disabled for session");
  }

  // ── Audit ────────────────────────────────────────────────────────
  await svc.from("barback_audit_log").insert({
    session_id: session.id,
    staff_id:   body.staff_id,
    action:     "login_ok",
    ip,
    user_agent: ua,
    // BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 — record which token version
    // was accepted so we can grep for legacy v1 in audit and decide when
    // it's safe to drop v1 acceptance entirely.
    detail:     { jwt_exp: exp, token_version: tokenVersion },
  });

  return jsonResponse({
    jwt,
    expires_at: new Date(exp * 1000).toISOString(),
    session: {
      session_id:    session.id,
      venue_id:      session.venue_id,
      night_id:      session.night_id,
      bar_id:        scopedPrimaryBarId,
      allowed_bars:  scopedAllowedBars,
      nickname:      session.nickname,
      issued_by:     session.issued_by,
      issued_at:     session.issued_at,
      expires_at:    session.expires_at,
    },
    staff: {
      id:   body.staff_id,
      name: staffRow?.name ?? "unknown",
      role: staffRow?.role ?? null,   // comma-separated labels; frontend derives operator mode
    },
    opening_par: openingParResult.value,
    bundle: {
      items: itemsRes.data ?? [],
      bars:  barsWithBartenderLabels,
      staff: staffRes.data ?? [],
    },
  });
});
