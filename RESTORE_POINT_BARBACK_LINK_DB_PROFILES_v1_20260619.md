# Restore Point — Barback Link DB Bottle Profiles (v1)

**Date/time:** 2026-06-19 12:25 PDT
**State:** DB bottle-weight profiles working in Barback Link (confirmed by user).

## Frontend — `~/Documents/barinv-pro`
- **Branch:** `main`
- **HEAD (full):** `0812a537eb065583603ffbc8f0a20ca4efdec650`
- **Short:** `0812a537` — feat(operator): use db bottle profiles for remaining percent
- **origin/main:** aligned (pushed) ✓
- **Tag:** `barback-link-stable-db-profiles-v1` → `0812a537`
- **Prior stable tag:** `barback-link-stable-manual-scale-v1` → `2c981acf`
- **Test URL:** `https://danielbh1900.github.io/barinv-pro/barback.html?v=dbprofile1`

## Edge — `~/Documents/BARINV`
- **Function:** `barback-pin-login` — items SELECT now includes `empty_bottle_weight_g, full_bottle_weight_g` (additive; verify_jwt preserved false).
- **Deployed:** live to project `uzommuafouvaerdvirzf` (CLI deploy).
- **Source commit (original):** `b18f25e` on `chore/repo-prod-reconciliation-20260609` (local; 5 commits ahead of remote — kept local).
- **Published (isolated):** cherry-picked to `14a06c9e9e53dfaea7eadaedf8923d61dddd48ca` on branch **`edge/barback-bottle-weight-fields`** (pushed to origin). Only the additive edge change was published; 4 unrelated local commits and the firmware working-tree drift stayed local/uncommitted.

## Working feature checklist (this restore point)
- [x] DB profile primary: `items.empty_bottle_weight_g`/`full_bottle_weight_g`/`bottle_size_ml` surfaced in the login bundle and used first for Remaining %.
- [x] Source priority: local override > DB profile > manual entry; labels `Using DB bottle profile` / `Using local profile` / `Profile needed`.
- [x] Edit writes a LOCAL override only (never DB); Reset removes the local override and falls back to DB (hidden for pure-DB items).
- [x] Submit emits TARE/FULL/REMAINING_PERCENT/LIQUID/REMAINING_ML for DB profiles too; no DB writes from frontend; submit payload schema unchanged.
- [x] Partial works with Multi-Bar ON + exactly 1 bar; blocked with 2+; destination scope intact; Android sheet scroll intact.
- [x] No schema/RLS/iOS/ESP32/BLE changes.

## Restore commands
Frontend (operator page):
```sh
cd ~/Documents/barinv-pro
git fetch --all --tags
git checkout barback-link-stable-db-profiles-v1      # or: git checkout 0812a537
```
Edge source (additive bundle change):
```sh
cd ~/Documents/BARINV
git fetch origin
git checkout edge/barback-bottle-weight-fields        # commit 14a06c9 (== content of b18f25e)
# redeploy if needed:
supabase functions deploy barback-pin-login --no-verify-jwt --project-ref uzommuafouvaerdvirzf
```

## Next phase (recommended, NOT started)
iOS/Admin native BLE verification using the validated QN-KS decoder (`scale_decoder_lab.html` / `qnksDecoder.js`). BLE not started.
