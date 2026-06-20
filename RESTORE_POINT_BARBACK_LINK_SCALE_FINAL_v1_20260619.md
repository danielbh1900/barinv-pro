# Restore Point — Barback Link Scale Final (v1)

**Date/time:** 2026-06-19 22:19 PDT
**State:** Pre-show freeze. Scale support finalized and verified live. No risky feature work.

## Freeze
- **Repo:** `~/Documents/barinv-pro`
- **Branch:** `main`
- **Scale-final feature commit:** `271c1944` — fix(operator): make scale support clear in barback flows
- **Tag:** `barback-link-stable-scale-final-v1` → this checkpoint commit (contains `271c1944` + this report)
- **origin/main:** aligned (pushed) ✓
- **Operator URL:** `https://danielbh1900.github.io/barinv-pro/barback.html?v=scale-final1`
- **Manager URL:** `https://danielbh1900.github.io/barinv-pro/barback_manager.html`

## Live verification (Phase B)
- Operator page reachable (HTTP 200, ~330 KB); manager page HTTP 200.
- Deployed page contains `qm-ble` (Partial helper), `rf-ble` (RETURN helper), the iPhone manual hint, the "Live weight:" label, and capability gating → **scale-final code is live**.
- iPhone-hint count live == local (match) → deployed copy matches working tree.

## Pre-show readiness checklist (Phase C — code/live audit)
- [x] 1. Manager page loads (HTTP 200)
- [x] 2. Operator page loads (HTTP 200)
- [x] 3. PIN/login flow unchanged (`barback-pin-login`; not modified this cycle)
- [x] 4. Staff/operator generated links unchanged (token/PIN/access_code behavior untouched)
- [x] 5. TAKEN flow works (scan sheet + Add to Review path intact)
- [x] 6. RETURN flow works (QTY = grams; RETURN scale helper present)
- [x] 7. Manual quantity works (`qty-input`)
- [x] 8. Manual grams works (`weight-g-input`, `qm-weight`)
- [x] 9. Partial / weighed works (`qm-weight` + bottle-state)
- [x] 10. DB bottle profile path exists (`resolveBottleProfile` / `dbProfileForItem`)
- [x] 11. Remaining % path exists (`calcRemaining` / `REMAINING_PERCENT`)
- [x] 12. iPhone: no broken BLE button (capability-gated; manual hint shown instead)
- [x] 13. Android/Desktop Chrome: capability-gated BLE only (`navigator.bluetooth` + `getAvailability`)
- [x] 14. Add to Review still manual (operator taps ADD TO REVIEW)
- [x] 15. Submit All still manual
- [x] 16. No auto-submit from BLE (no `addToReview`/`qtyModalAdd`/submit call inside any `_ble*` handler)
- [x] 17. No schema/RLS/Edge/iOS/ESP32/website changes this cycle
- [x] 18. No token/PIN/access_code printed

## Rollback
```sh
cd ~/Documents/barinv-pro
git fetch --all --tags
git checkout barback-link-stable-scale-final-v1
```
Prior restore points: `barback-link-stable-db-profiles-v1`, `barback-link-stable-manual-scale-v1`.

---

## Event-night operating notes

### For staff (operators)
- Use the **manager page** to generate your link.
- Open the generated **Barback Link** and log in with your PIN.
- **iPhone:** enter grams **manually** (no scale button — that's expected).
- **Android Chrome:** **Connect Scale** is **optional** — manual entry always works too.
- **Always review** the items list **before tapping Submit All**.
- If anything fails: **refresh the link**, **re-login**, and **use manual grams**.

### For manager
- Keep the **manager page open** during the show.
- Hand out **fresh links** to staff.
- **Do not change setup** during the live show unless necessary.
- If **BLE fails** → use **manual weight**.
- If the **scanner is slow** → use **Browse / Search**.
- If **old data appears** → **re-login / clear the old session**.

---

## Confirmation
No iOS/Admin, Capacitor/Xcode, Supabase schema/RLS/Edge, ESP32, or BARINV.ca changes. Manual entry + DB/local profiles remain the universal fallback. BLE is capability-gated and never auto-submits.
