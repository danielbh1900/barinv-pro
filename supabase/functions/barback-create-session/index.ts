// ════════════════════════════════════════════════════════════════════
// barback-create-session
// ────────────────────────────────────────────────────────────────────
// Called by the manager UI (`barback_manager.html`) to mint a new
// shareable link for a night/bar/staff combo.
//
// Input (POST JSON, with Authorization: Bearer <manager_jwt>):
//   {
//     venue_id:     uuid,
//     night_id:     uuid,
//     bar_id?:      uuid,            // primary bar; null = multi
//     allowed_bars?: uuid[],         // empty = bar_id only
//     allowed_staff?: uuid[],        // empty = any venue staff
//     nickname?:    string,
//     expires_at:   ISO timestamp,
//     pin_rotate_for?: uuid[],       // staff whose PIN to rotate
//   }
//
// Output:
//   {
//     session: barback_sessions row,
//     token: "base64url-json-payload",       // unsigned, for URL
//     url:   "<origin>/barback.html?token=...",
//     pin_assignments: [
//       { staff_id, staff_name, pin?: "1234" }   // pin set only for newly-created/rotated
//     ]
//   }
// ════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsPreflight, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { authenticateManager, clientMeta, ManagerAuthError, requireVenueManager } from "../_shared/manager.ts";
import { generateSalt, hashPin, generateRandomPin } from "../_shared/pin.ts";
// BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 — sign the session token so leakage
// of session_id alone does not enable login attempts. See _shared/jwt.ts.
import { signBarbackSessionToken } from "../_shared/jwt.ts";
import { diagnoseMissingEnv, getSupabaseJwtSecret, getSupabaseServiceKey, getSupabaseUrl } from "../_shared/env.ts";

interface CreateSessionBody {
  venue_id: string;
  night_id: string;
  bar_id?: string | null;
  allowed_bars?: string[];
  allowed_staff?: string[];
  link_type?: "bar" | "table";
  opening_par_enabled?: boolean;
  opening_par_items?: Array<{ item_id: string; qty: number }>;
  nickname?: string;
  expires_at: string;
  pin_rotate_for?: string[];
  public_url_base?: string;        // optional: where the barback opens the link
}

type SessionLinkMode = "bar" | "table";

class SessionInputError extends Error {}

function uniqueIdArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new SessionInputError(field + " must be an array");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new SessionInputError(field + " contains an invalid id");
    }
    const id = raw.trim();
    if (!seen.has(id)) { seen.add(id); result.push(id); }
  }
  return result;
}

// BARBACK_CREATE_SESSION_VALIDATION_START
const SESSION_TABLE_TYPES = ["table", "vip", "booth"];
const SESSION_BAR_ROLE_KEYWORDS = ["barback"];
const SESSION_BAR_VIP_BUSSER_ROLE = "busser";
const SESSION_TABLE_ROLE_KEYWORDS = ["server", "table", "vip", "manager", "admin", "lead", "supervisor"];
const OPENING_PAR_REGULAR_MODES = ["regular_bar", "bar", "bar_only", "all_bars", "both"];
const OPENING_PAR_MAX_ITEMS = 500;

function sessionModeForBarType(value: unknown): SessionLinkMode | null {
  const type = String(value || "").toLowerCase().trim();
  if (!type) return null;
  if (SESSION_TABLE_TYPES.includes(type)) return "table";
  // `bars` is BARINV PRO's generic operational-destination table. Any active,
  // night-activated non-table type (bar, internal station, dispatch, storage,
  // liquor room, or a future operational type) belongs to Barback/Bars mode.
  return "bar";
}

function resolveSessionDestinations(
  linkType: unknown,
  primaryBarId: string | null,
  allowedBarIds: string[],
  activeNightAreas: Array<{ id: string; bar_type?: string | null }>,
) {
  const explicitMode: SessionLinkMode | null = linkType === "bar" || linkType === "table" ? linkType : null;
  if (linkType != null && !explicitMode) throw new SessionInputError("link_type must be bar or table");
  const byId = new Map(activeNightAreas.map((area) => [area.id, area]));
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const id of [primaryBarId, ...allowedBarIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const area = byId.get(id);
    if (!area) throw new SessionInputError("selected destination is not active for this venue/night");
    const mode = sessionModeForBarType(area.bar_type);
    if (!mode) throw new SessionInputError("selected destination has no supported operational type");
    if (explicitMode === "table" && mode !== "table") {
      throw new SessionInputError("selected destination is invalid for the requested link type");
    }
    selected.push(id);
  }
  const selectedModes = new Set(selected.map((id) => sessionModeForBarType(byId.get(id)?.bar_type)).filter(Boolean));
  if (!explicitMode && selectedModes.size > 1) {
    throw new SessionInputError("selected destinations mix bar and table link types");
  }
  const derivedMode = selectedModes.size === 1 ? Array.from(selectedModes)[0] as SessionLinkMode : null;
  return { mode: explicitMode || derivedMode, effectiveDestinationIds: selected };
}

function staffHasModeCoverage(
  assignment: { allowed_bar_ids?: string[] | null },
  mode: SessionLinkMode,
  activeAreaModeById: Map<string, SessionLinkMode>,
) {
  return (assignment?.allowed_bar_ids || []).some((id) => activeAreaModeById.get(id) === mode);
}

function staffEligibleForSession(
  staff: { role?: string | null },
  assignment: { role?: string | null; allowed_bar_ids?: string[] | null; revoked?: boolean | null },
  mode: SessionLinkMode,
  activeAreaModeById: Map<string, SessionLinkMode>,
) {
  if (!staff || !assignment || assignment.revoked === true) return false;
  const selectedNightRoles = new Set(
    String(assignment.role || "").toLowerCase().split(/[,;|/]+/).map((part) => part.trim()).filter(Boolean),
  );
  if (mode === "table") {
    return SESSION_TABLE_ROLE_KEYWORDS.some((role) => selectedNightRoles.has(role)) &&
      staffHasModeCoverage(assignment, "table", activeAreaModeById);
  }
  const hasAnyActiveDestination = (assignment.allowed_bar_ids || []).some((id) => activeAreaModeById.has(id));
  if (SESSION_BAR_ROLE_KEYWORDS.some((role) => selectedNightRoles.has(role))) {
    return hasAnyActiveDestination;
  }
  return selectedNightRoles.has(SESSION_BAR_VIP_BUSSER_ROLE) &&
    staffHasModeCoverage(assignment, "table", activeAreaModeById);
}

function staffDestinationEligible(
  assignment: { role?: string | null; revoked?: boolean | null },
  mode: SessionLinkMode,
  destinationMode: SessionLinkMode | undefined,
) {
  if (!assignment || assignment.revoked === true || !destinationMode) return false;
  const selectedNightRoles = new Set(
    String(assignment.role || "").toLowerCase().split(/[,;|/]+/).map((part) => part.trim()).filter(Boolean),
  );
  if (mode === "table") {
    return destinationMode === "table" &&
      SESSION_TABLE_ROLE_KEYWORDS.some((role) => selectedNightRoles.has(role));
  }
  if (SESSION_BAR_ROLE_KEYWORDS.some((role) => selectedNightRoles.has(role))) return true;
  return selectedNightRoles.has(SESSION_BAR_VIP_BUSSER_ROLE) && destinationMode === "table";
}

function isOpeningRegularItem(item: { active?: boolean | null; service_mode?: string | null }) {
  if (!item || item.active === false) return false;
  return OPENING_PAR_REGULAR_MODES.includes(String(item.service_mode || "").toLowerCase().trim());
}

function buildOpeningParConfig(
  enabled: unknown,
  requestedItems: unknown,
  venueItems: Array<{ id: string; active?: boolean | null; service_mode?: string | null }>,
  configuredAt: string,
) {
  if (enabled !== true) {
    if (requestedItems !== undefined) {
      throw new SessionInputError("opening_par_items requires opening_par_enabled=true");
    }
    return null;
  }
  if (!Array.isArray(requestedItems)) throw new SessionInputError("opening_par_items must be an array");
  const validRegularCount = venueItems.filter(isOpeningRegularItem).length;
  const itemLimit = Math.min(OPENING_PAR_MAX_ITEMS, validRegularCount);
  if (requestedItems.length > itemLimit) throw new SessionInputError("opening_par_items exceeds the venue item limit");
  const byId = new Map(venueItems.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const positive: Array<{ item_id: string; qty: number }> = [];
  for (const raw of requestedItems) {
    if (!raw || typeof raw !== "object") throw new SessionInputError("opening_par_items contains an invalid row");
    const itemId = (raw as { item_id?: unknown }).item_id;
    const qty = (raw as { qty?: unknown }).qty;
    if (typeof itemId !== "string" || !itemId.trim()) throw new SessionInputError("opening_par item_id is invalid");
    if (seen.has(itemId)) throw new SessionInputError("opening_par_items contains a duplicate item_id");
    seen.add(itemId);
    const item = byId.get(itemId);
    if (!item) throw new SessionInputError("opening_par item is unknown or outside the venue");
    if (item.active === false) throw new SessionInputError("opening_par item is inactive");
    if (!isOpeningRegularItem(item)) throw new SessionInputError("opening_par item is not valid for regular bars");
    if (typeof qty !== "number" || !Number.isFinite(qty)) throw new SessionInputError("opening_par qty must be finite");
    if (!Number.isInteger(qty)) throw new SessionInputError("opening_par qty must be an integer");
    if (qty < 0) throw new SessionInputError("opening_par qty must not be negative");
    if (qty > 0) positive.push({ item_id: itemId, qty });
  }
  if (!positive.length) throw new SessionInputError("opening_par requires at least one positive item quantity");
  return { enabled: true as const, version: 1 as const, configured_at: configuredAt, items: positive };
}
// BARBACK_CREATE_SESSION_VALIDATION_END

function base64UrlEncode(s: string): string {
  let out = "";
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req: Request) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("method not allowed", 405);

  // Granular env diagnostic — surfaces exactly which env var the operator
  // needs to set. Supports legacy SUPABASE_SERVICE_ROLE_KEY plus new
  // SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS formats. See _shared/env.ts.
  // JWT_SECRET is also checked here because this function signs barback
  // session tokens (BARINV_SECURITY_PHASE2B_TRANCHE_B_F6).
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

  // ── Authenticate the manager ─────────────────────────────────────
  let mgr;
  try {
    mgr = await authenticateManager(req, svc);
  } catch (e) {
    if (e instanceof ManagerAuthError) return errorResponse(e.message, e.status);
    return errorResponse((e as Error).message, 500);
  }
  const { ip, ua } = clientMeta(req);

  // ── Parse body ───────────────────────────────────────────────────
  let body: CreateSessionBody;
  try { body = await req.json(); }
  catch { return errorResponse("invalid JSON body", 400); }

  if (!body?.venue_id || !body?.night_id || !body?.expires_at) {
    return errorResponse("missing venue_id / night_id / expires_at", 400);
  }

  // Real manager role check (Phase 4): caller must be manager+ for this venue.
  try {
    await requireVenueManager(mgr, svc, body.venue_id);
  } catch (e) {
    if (e instanceof ManagerAuthError) return errorResponse(e.message, e.status);
    return errorResponse((e as Error).message, 500);
  }
  const expiresAt = new Date(body.expires_at);
  if (Number.isNaN(+expiresAt) || expiresAt <= new Date()) {
    return errorResponse("expires_at must be a future ISO timestamp", 400);
  }
  // Hard ceiling so a misclick can't create a year-long token
  const maxExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (expiresAt > maxExp) {
    return errorResponse("expires_at exceeds 7-day ceiling", 400);
  }

  // ── Validate venue/night/destination/staff scope server-side ─────
  // The browser selectors are UX only. The service-role insert below uses
  // only IDs that have been re-resolved inside the manager-authorized venue.
  let primaryBarId: string | null;
  let allowedBars: string[];
  let allowedStaff: string[];
  let pinRotateFor: string[];
  try {
    if (body.bar_id != null && (typeof body.bar_id !== "string" || !body.bar_id.trim())) {
      throw new SessionInputError("bar_id is invalid");
    }
    primaryBarId = body.bar_id ? body.bar_id.trim() : null;
    allowedBars = uniqueIdArray(body.allowed_bars, "allowed_bars");
    allowedStaff = uniqueIdArray(body.allowed_staff, "allowed_staff");
    pinRotateFor = uniqueIdArray(body.pin_rotate_for, "pin_rotate_for");
    if (!allowedStaff.length) {
      throw new SessionInputError("at least one allowed_staff member is required");
    }
    const allowedStaffSet = new Set(allowedStaff);
    if (pinRotateFor.some((id) => !allowedStaffSet.has(id))) {
      throw new SessionInputError("pin_rotate_for must be a subset of allowed_staff");
    }
  } catch (e) {
    if (e instanceof SessionInputError) return errorResponse(e.message, 400);
    return errorResponse("invalid session scope", 400);
  }

  const { data: venueExistsRow, error: venueErr } = await svc
    .from("venues").select("id").eq("id", body.venue_id).maybeSingle();
  if (venueErr) return errorResponse("venue validation failed: " + venueErr.message, 500);
  if (!venueExistsRow) return errorResponse("venue not found", 400);

  const { data: scopedNight, error: nightErr } = await svc
    .from("nights").select("id, venue_id, active")
    .eq("id", body.night_id).eq("venue_id", body.venue_id).maybeSingle();
  if (nightErr) return errorResponse("night validation failed: " + nightErr.message, 500);
  if (!scopedNight) return errorResponse("night does not belong to the authorised venue", 400);
  if (scopedNight.active === false) {
    return errorResponse(
      "This night is closed. Reopen it in BARINV PRO before creating a Barback session.",
      409,
    );
  }

  const [nightBarsRes, venueBarsRes] = await Promise.all([
    svc.from("night_bars").select("bar_id").eq("night_id", body.night_id),
    svc.from("bars").select("id, venue_id, bar_type, active").eq("venue_id", body.venue_id),
  ]);
  if (nightBarsRes.error) return errorResponse("night destination validation failed: " + nightBarsRes.error.message, 500);
  if (venueBarsRes.error) return errorResponse("venue destination validation failed: " + venueBarsRes.error.message, 500);
  const activeNightIds = new Set((nightBarsRes.data ?? []).map((row) => row.bar_id).filter(Boolean));
  const activeNightAreas = (venueBarsRes.data ?? []).filter((area) =>
    area.active !== false && activeNightIds.has(area.id)
  );

  let resolvedScope: { mode: SessionLinkMode | null; effectiveDestinationIds: string[] };
  try {
    resolvedScope = resolveSessionDestinations(body.link_type, primaryBarId, allowedBars, activeNightAreas);
  } catch (e) {
    if (e instanceof SessionInputError) return errorResponse(e.message, 400);
    return errorResponse("invalid destination scope", 400);
  }
  if (!resolvedScope.mode || !resolvedScope.effectiveDestinationIds.length) {
    return errorResponse("at least one validated destination is required", 400);
  }
  const resolvedMode = resolvedScope.mode;

  if (allowedStaff.length) {
    const [staffRes, assignmentRes] = await Promise.all([
      svc.from("staff").select("id, venue_id, role, active")
        .eq("venue_id", body.venue_id).in("id", allowedStaff),
      svc.from("night_staff_assignments")
        .select("staff_id, role, allowed_bar_ids, revoked")
        .eq("night_id", body.night_id).eq("venue_id", body.venue_id).eq("revoked", false),
    ]);
    if (staffRes.error) return errorResponse("staff validation failed: " + staffRes.error.message, 500);
    if (assignmentRes.error) return errorResponse("staff assignment validation failed: " + assignmentRes.error.message, 500);
    const staffById = new Map((staffRes.data ?? []).map((row) => [row.id, row]));
    const assignmentsByStaff = new Map<string, Array<{
      staff_id: string;
      role: string | null;
      allowed_bar_ids: string[] | null;
      revoked: boolean;
    }>>();
    for (const assignment of assignmentRes.data ?? []) {
      const rows = assignmentsByStaff.get(assignment.staff_id) ?? [];
      rows.push(assignment);
      assignmentsByStaff.set(assignment.staff_id, rows);
    }
    const activeAreaModeById = new Map<string, SessionLinkMode>();
    for (const area of activeNightAreas) {
      const mode = sessionModeForBarType(area.bar_type);
      if (mode) activeAreaModeById.set(area.id, mode);
    }
    const assignedDestinationIds = new Set<string>();
    for (const staffId of allowedStaff) {
      const staff = staffById.get(staffId);
      if (!staff || staff.active === false) return errorResponse("allowed_staff contains an inactive or cross-venue staff id", 400);
      const assignments = assignmentsByStaff.get(staffId) ?? [];
      const eligible = assignments.some((assignment) =>
        staffEligibleForSession(staff, assignment, resolvedMode, activeAreaModeById)
      );
      if (!eligible) return errorResponse("allowed_staff contains a staff member not eligible for this venue/night/link type", 400);
      for (const assignment of assignments) {
        for (const destinationId of assignment.allowed_bar_ids ?? []) {
          if (staffDestinationEligible(
            assignment,
            resolvedMode,
            activeAreaModeById.get(destinationId),
          )) {
            assignedDestinationIds.add(destinationId);
          }
        }
      }
    }
    for (const destinationId of resolvedScope.effectiveDestinationIds) {
      if (!assignedDestinationIds.has(destinationId)) {
        return errorResponse("selected destination is not assigned to allowed_staff", 400);
      }
    }
  }

  let openingParConfig: {
    enabled: true;
    version: number;
    configured_at: string;
    items: Array<{ item_id: string; qty: number }>;
  } | null = null;
  try {
    if (body.opening_par_enabled === true) {
      if (resolvedScope.mode !== "bar" || !resolvedScope.effectiveDestinationIds.length) {
        throw new SessionInputError("Opening PAR requires at least one validated operational destination");
      }
      const { data: venueItems, error: itemErr } = await svc
        .from("items").select("id, active, service_mode").eq("venue_id", body.venue_id);
      if (itemErr) return errorResponse("Opening PAR item validation failed: " + itemErr.message, 500);
      openingParConfig = buildOpeningParConfig(
        true,
        body.opening_par_items,
        venueItems ?? [],
        new Date().toISOString(),
      );
    } else {
      openingParConfig = buildOpeningParConfig(false, body.opening_par_items, [], new Date().toISOString());
    }
  } catch (e) {
    if (e instanceof SessionInputError) return errorResponse(e.message, 400);
    return errorResponse("invalid Opening PAR configuration", 400);
  }

  // ── Insert the session row ───────────────────────────────────────
  const issuedBy = mgr.staffId; // may be null if no staff linkage
  if (!issuedBy) {
    return errorResponse(
      "manager auth.users id is not linked to a staff record (set staff.auth_user_id)",
      403,
    );
  }
  const { data: session, error: insErr } = await svc
    .from("barback_sessions")
    .insert({
      venue_id:      body.venue_id,
      night_id:      body.night_id,
      bar_id:        primaryBarId,
      allowed_bars:  allowedBars,
      allowed_staff: allowedStaff,
      nickname:      body.nickname ?? null,
      issued_by:     issuedBy,
      expires_at:    expiresAt.toISOString(),
      opening_par_config: openingParConfig,
    })
    .select(
      "id, venue_id, night_id, bar_id, allowed_bars, allowed_staff, nickname, issued_by, issued_at, expires_at, opening_par_config",
    )
    .single();
  if (insErr || !session) {
    return errorResponse("failed to create session: " + (insErr?.message ?? "?"), 500);
  }

  // ── For staff that don't yet have a PIN (or pin_rotate_for), assign one ──
  const targetStaff = allowedStaff.length > 0
    ? allowedStaff
    : []; // unbounded staff sessions use the empty list — admin sets PINs separately

  const rotateSet = new Set<string>(pinRotateFor);

  const pinAssignments: Array<{ staff_id: string; staff_name: string; pin?: string }> = [];

  if (targetStaff.length > 0) {
    const { data: existing } = await svc
      .from("barback_pins")
      .select("staff_id")
      .in("staff_id", targetStaff);
    const have = new Set((existing ?? []).map((r) => r.staff_id));

    // Resolve display names
    const { data: staffRows } = await svc
      .from("staff")
      .select("id, name")
      .in("id", targetStaff);
    const nameById = new Map<string, string>(
      (staffRows ?? []).map((r) => [r.id, r.name ?? "unknown"]),
    );

    for (const sid of targetStaff) {
      const needsAssign = !have.has(sid) || rotateSet.has(sid);
      if (!needsAssign) {
        pinAssignments.push({ staff_id: sid, staff_name: nameById.get(sid) ?? "unknown" });
        continue;
      }
      const pin = generateRandomPin(4);
      const salt = generateSalt();
      const hash = await hashPin(pin, salt);
      const { error: pinErr } = await svc
        .from("barback_pins")
        .upsert({
          staff_id: sid,
          pin_hash: hash,
          pin_salt: salt,
          pin_algo: "pbkdf2_sha256_100000",
          failed_count: 0,
          locked_until: null,
          rotated_at: new Date().toISOString(),
          rotated_by: issuedBy,
        }, { onConflict: "staff_id" });
      if (pinErr) {
        return errorResponse("PIN write failed for staff " + sid + ": " + pinErr.message, 500);
      }
      pinAssignments.push({
        staff_id: sid,
        staff_name: nameById.get(sid) ?? "unknown",
        pin, // surfaced ONCE; never persisted plain
      });
    }
  }

  // ── Build the unsigned token (still useful to convey scope to client) ──
  // The signed JWT is issued only at `barback-login`. The token in the
  // URL is just an identifier the barback paste/QR-scans; it includes
  // the session_id so the page can show meta and call barback-login.
  //
  // Embed staff/bar name hints so the PIN screen can render readable
  // names even when the barback's phone has never opened the BARINV
  // production app (and so has no offline cache). The hints are
  // UI-only — auth still flows through `allowed_staff`/`allowed_bars`.
  let allowedStaffMeta: Array<{ id: string; name: string }> | undefined;
  if (Array.isArray(session.allowed_staff) && session.allowed_staff.length > 0) {
    const { data: srows } = await svc
      .from("staff")
      .select("id, name")
      .in("id", session.allowed_staff);
    allowedStaffMeta = (srows ?? []).map((r) => ({ id: r.id, name: r.name ?? "?" }));
  }
  const { data: venueRow } = await svc
    .from("venues").select("name").eq("id", session.venue_id).maybeSingle();
  const { data: barRow } = session.bar_id
    ? await svc.from("bars").select("name").eq("id", session.bar_id).maybeSingle()
    : { data: null };
  const { data: nightRow } = await svc
    .from("nights").select("date, name").eq("id", session.night_id).maybeSingle();

  // BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 — `v` will be stamped to 2 by
  // signBarbackSessionToken below; we leave the literal here at 1 in case
  // a downstream caller inspects the payload before signing, but the
  // signed token's payload uses v=2.
  const tokenPayload = {
    v: 1,
    session_id:        session.id,
    venue_id:          session.venue_id,
    night_id:          session.night_id,
    bar_id:            session.bar_id ?? null,
    allowed_bars:      session.allowed_bars,
    allowed_staff:     session.allowed_staff,
    allowed_staff_meta: allowedStaffMeta,
    venue_name:        venueRow?.name ?? null,
    bar_name:          barRow?.name ?? null,
    night_label:       nightRow
      ? `${nightRow.date ?? ""}${nightRow.name ? " · " + nightRow.name : ""}`
      : null,
    nickname:          session.nickname ?? null,
    expires_at:        session.expires_at,
    test_mode:         false,
  };
  // BARINV_SECURITY_PHASE2B_TRANCHE_B_F6 — HMAC-sign the token. Output is
  // "<payload_b64u>.<sig_b64u>"; legacy unsigned format (single-part) is
  // still accepted on the verify side during the migration window.
  const token = await signBarbackSessionToken(tokenPayload, JWT_SECRET);
  const urlBase = body.public_url_base ?? "";
  const url = urlBase
    ? `${urlBase.replace(/\/+$/, "")}/barback.html?token=${token}`
    : `barback.html?token=${token}`;

  // ── Audit log ────────────────────────────────────────────────────
  await svc.from("barback_audit_log").insert({
    session_id: session.id,
    staff_id:   issuedBy,
    action:     "session_created",
    ip,
    user_agent: ua,
    detail:     {
      pin_assignments: pinAssignments.map((p) => ({ staff_id: p.staff_id, rotated: !!p.pin })),
      nickname: session.nickname,
      expires_at: session.expires_at,
      opening_par_enabled: openingParConfig?.enabled === true,
      opening_par_item_count: openingParConfig?.items.length ?? 0,
    },
  });

  return jsonResponse({
    session,
    token,
    url,
    pin_assignments: pinAssignments,
  });
});
