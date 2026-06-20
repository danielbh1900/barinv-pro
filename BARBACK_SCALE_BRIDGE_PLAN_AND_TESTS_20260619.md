# Barback Link Scale — Bridge Plan + Test Checklist (2026-06-19)

Repo: `~/Documents/barinv-pro` · file `barback.html` · HEAD `68d337e3` · stable tag `barback-link-stable-scale-final-v1`.

## Confirmed reality
- iPhone Safari/Chrome do **not** expose `navigator.bluetooth` → **direct Web Bluetooth is impossible** there. Live screenshot: HTTPS, secure context = yes, device = iPhone, `navigator.bluetooth: missing`.
- This is **not a Barback Link bug** — the app correctly detects the missing API and shows the diagnostic panel (no broken Connect button). Verified in code: existence-based gating, diagnostic spans, manual fallback all present.
- Direct Web Bluetooth works on **Android Chrome / Desktop Chrome** (and any iOS WebBLE browser, e.g. **Bluefy/WebBLE**, that exposes `navigator.bluetooth`).

---

## Phase A — Validation test checklist

### A1. Android Chrome (direct Web Bluetooth)
- [ ] Open operator link in Android Chrome (HTTPS). SCALE panel diag shows `Browser BLE: available`, `Secure: yes`, `Device: Android`.
- [ ] **📶 Connect Scale** button is visible.
- [ ] Filtered connect: tap Connect Scale → scale appears in chooser (advertises FFF0) → pick it.
- [ ] Mode advances: `chooser filtered FFF0 → connecting → service FFF0 found → characteristic FFF1 found → notifications started — waiting for frames → last frame decoded`.
- [ ] All-devices fallback: if the scale is NOT in the filtered chooser, tap **Can't find scale? Try all BLE devices** → pick it.
- [ ] Live frames: `Live weight: <g> · stable/unstable`; a >1000 g bottle reads ~1200 g (not ~120 g).
- [ ] Stable grams display; **Use latest stable weight** fills Weight (g) (TAKEN/Partial, remaining % recalcs) or QTY (RETURN). ADD TO REVIEW still manual.

### A2. iPhone WebBLE / Bluefy
- [ ] Open the **same** operator link in **Bluefy** (or WebBLE).
- [ ] Check the SCALE panel diag: does `Browser BLE` become `available` and `Device: iPhone`?
- [ ] If available → **Connect Scale appears** → run the same FFF0/FFF1 path as A1 (chooser → service → characteristic → frames → stable grams).
- [ ] If unavailable → mark **iPhone web-direct path BLOCKED** for that browser; rely on bridge/station/manual.

---

## Phase B — Bridge options (iPhone barbacks without Web Bluetooth)

“Scale Bridge Mode”: one device reads the scale and publishes the latest stable weight to a shared channel; iPhone Barback Link reads it and the operator taps **Use latest stable weight**. No auto-submit; manual fallback stays.

| # | Option | Speed | Reliability | Effort | Risk | iPhone Safari? | Firmware? | Supabase schema/Edge? |
|---|--------|-------|-------------|--------|------|----------------|-----------|------------------------|
| 1 | **Android scale station only** | Immediate (built) | High (direct BLE) | None | Low; single point of failure / weighing bottleneck | iPhone doesn't weigh — station does | No | No |
| 2 | **ESP32 bridge** reads BLE scale, publishes weight | Slow | High once built | High | Med-high (firmware, BLE central, field robustness; ESP32 currently paused) | **Yes** (iPhone reads channel over HTTPS) | **Yes** | Yes, if it posts to Supabase (or use its own channel) |
| 3 | **Local network bridge** (laptop/RPi serves weight over LAN) | Medium | Medium | Med-high | High — **HTTPS page → http LAN = mixed-content blocked**; self-signed cert trust on iPhone; venue WiFi/firewall | Fragile (cert/mixed-content) | No (native script) | No |
| 4 | **Supabase Realtime / polling** (station writes latest weight, iPhone subscribes) | Medium | High (HTTPS, no mixed-content; Supabase is already the backbone) | Medium | Medium — **needs Supabase Realtime auth / a session-scoped weight table + RLS** (and barback writes likely via Edge) | **Yes** | No (Android station is the BLE reader) | **Yes** |
| 5 | **QR / session pairing** (pair iPhone session to a station) | Slower | Depends on transport | High | Med-high | Yes (if transport does) | No | Yes (it's a UX layer over #4/#3) |

Notes:
- A browser tab **cannot** be a server, so any cross-device path needs either Supabase (#4), dedicated hardware (#2), or a native LAN bridge (#3) / 3rd-party relay (Ably/Pusher/MQTT-over-WSS variant of #3, works on iPhone over WSS but adds a vendor).
- #4 detail: Barback Link already holds a custom JWT (`barback_user`, signed with the project JWT secret), so Realtime would accept it. Securing the channel properly = **Realtime Authorization RLS on `realtime.messages`** (a migration), or a small `scale_weights` table (session_id, grams, stable, updated_at) + RLS + an Edge write endpoint. Either is a Supabase change → needs approval. Realtime **broadcast** (ephemeral, no table) is the lightest.

---

## Phase C — Recommendation (fastest path to “barbacks don’t type weight”)

1. **Immediate (today, zero code):** **Android Chrome scale station** (option 1). Already shipped and working. Route all weighing through it; iPhone staff scan/TAKEN/search.
2. **Next build (the real iPhone fix):** **Scale Bridge Mode via Supabase Realtime broadcast** (option 4). One Android Chrome station reads the scale (existing decoder) and broadcasts the latest **stable** weight on a session/night-scoped channel; iPhone Barback Link subscribes and the existing **Use latest stable weight** buttons fill the field. Works on iPhone Safari over HTTPS, no firmware. **Requires Supabase Realtime/RLS wiring → needs explicit approval** (no submit-schema change).
3. **Later (robust, unattended):** **ESP32 dedicated bridge** (option 2) — always-on hardware reads the scale and posts weight, removing the babysat Android device. Higher effort + firmware; ESP32 is paused.

---

## Exact files/functions to change in the next phase (Scale Bridge Mode, option 4)

**Frontend — `barback.html` only (no submit/profile changes):**
- Add a **“Scale station mode”** opt-in (one device publishes). When on + connected, in `_bleOnFrame` (on a stable high-confidence frame) call a new `_scaleBroadcast(grams, stable)` → Supabase Realtime channel `scale:<venue_id>:<night_id>` (or `:<session_id>`).
- Add a **receiver** `_scaleBridgeSubscribe()` (runs after login on devices without Web Bluetooth): on message, set `bleScale.latest = {grams, stable}`, update the main panel `Live weight` line, and reveal the existing **Use latest stable weight** buttons. **Reuses unchanged** `_bleUseLatest` / `_bleUseLatestReturn` / `_bleUseLatestMain` (field-fill) and `_bleDecodeFrame` (station-side decode).
- Add a Realtime client (supabase-js Realtime, or a raw `wss://<ref>.supabase.co/realtime/v1` connection authorized with the existing barback JWT). Show a small `bridge: receiving from station` status in the panel.
- Untouched: `addCurrentSelectionToReview`, `buildProfileNotes`, `resolveBottleProfile`, Multi-Bar, destination scope, token/PIN/link format.

**Supabase (needs approval; no submit-schema change):**
- Realtime Authorization (RLS on `realtime.messages`) scoping the topic to the venue/night for `barback_user` — OR a `scale_weights` table (session-scoped) + RLS + an Edge write endpoint for the station.

**ESP32:** none for option 4 (only if/when option 2 is approved later).

**Before implementing:** cut a restore tag (e.g. `barback-link-stable-scale-bridge-pre-v1`) first.

> Not implementing the bridge in this pass — design + approval gate only.
