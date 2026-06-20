# Barback Link — Show-Mode Scale Instructions (2026-06-19)

Frozen build: tag `barback-link-stable-scale-final-v1` (commit `5c9fc726`, scale feature `271c1944`).
Operator URL: `https://danielbh1900.github.io/barinv-pro/barback.html?v=scale-final1`
Manager URL: `https://danielbh1900.github.io/barinv-pro/barback_manager.html`

## The plan (read first)
- Use **ONE Android Chrome device** as the dedicated **scale station**. Keep it **beside the physical scale**.
- Route **ALL weighing** through that station: **RETURN grams** and **Partial / weighed** bottles.
- **iPhone staff can scan / TAKEN / search**, but **weighing must go through the Android scale station** (iPhone has no Web Bluetooth — by design it shows no Connect button).

## Android scale station — setup (once at start of night)
1. Open the operator URL in **Chrome on the Android device**.
2. Log in with the PIN (link generated from the manager page).
3. Turn on the **Arboleaf / QN-KS scale**.
4. You only need to **Connect Scale once** — the same connection serves both the Partial sheet and the RETURN form.

## Android scale station — RETURN grams
1. Pick **RETURN**. The **"Scale return weight"** row appears under QTY.
2. Tap **📶 Connect scale** (first time) → pick the scale in the chooser.
3. Place the bottle on the scale. Watch the **Live weight:** line.
4. **Wait until it shows "stable"**, then tap **Use latest stable weight** → it fills the **QTY** field (RETURN qty = grams).
5. Confirm the number, then tap **ADD TO REVIEW**. (Nothing is submitted automatically.)

## Android scale station — TAKEN / Partial / weighed
1. Scan or search the item → in the confirm sheet pick **Partial / weighed**.
2. The **Scale** row appears with **📶 Connect scale** (or already connected).
3. Place the bottle → wait for **"stable"** → tap **Use latest stable weight** → it fills the **Weight (g)** field and the **Remaining %** recalculates (uses the DB/local bottle profile).
4. Confirm, then tap **ADD TO REVIEW**.

## iPhone limitation (expected, not a bug)
- iPhone shows **no Connect Scale button** — instead a hint: *"Scale connection is available on Android Chrome. On iPhone, enter grams manually."*
- For this show, **do not assign weighing to iPhone staff**. iPhone is for **scan / TAKEN / search** only.
- Manual grams entry still works on iPhone as a fallback, but **weighing should go through the Android scale station**.

## If something goes wrong
- **Scale won't connect / drops:** tap **Disconnect** then **📶 Connect scale** again; if still stuck, **refresh the page** and re-connect.
- **Page acts stale / old data:** **refresh** and **re-login** with the link.
- **Scanner slow:** use **Browse / Search** to pick the item.
- **Scale totally down:** **last-resort manual grams, entered by the manager only** — then **ADD TO REVIEW** as normal.
- Always **review the list before tapping Submit All**. Both **ADD TO REVIEW** and **Submit All** are **manual** — the scale never submits anything by itself.

## Hard rules during the show
- **Do NOT change code during the show** unless it is a true emergency.
- **Never run `git add .`** — if an emergency edit is unavoidable, stage the single file explicitly.
- Manager: keep the manager page open, hand out **fresh links**, and **do not change setup mid-show** unless necessary.

## Rollback (only if needed)
```sh
cd ~/Documents/barinv-pro
git fetch --all --tags
git checkout barback-link-stable-scale-final-v1
```
