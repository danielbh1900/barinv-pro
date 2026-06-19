# Restore Point — Barback Link Stable (Manual Scale v1)

**Date/time:** 2026-06-19 00:47 PDT
**Repo path:** `~/Documents/barinv-pro`
**Branch:** `main`
**HEAD commit (full):** `2c981acf73ff557c9929d3bd944131022427f2df`
**Short HEAD:** `2c981acf`
**Tag:** `barback-link-stable-manual-scale-v1` (annotated)
**Tag points to:** `2c981acf73ff557c9929d3bd944131022427f2df`
**Pushed tag status:** pushed to `origin` ✓ (`[new tag] barback-link-stable-manual-scale-v1`)
**origin/main alignment:** local == origin/main ✓

## Latest stable test URL
`https://danielbh1900.github.io/barinv-pro/barback.html?v=partial1bar1`

## Feature checklist (verified stable at this commit)
- [x] Destination scope fix — destinations restricted to session scope
- [x] Manual weight option in scan confirm sheet
- [x] Android sheet scroll fix (keyboard)
- [x] Remaining % calculation from saved weight profile (localStorage)
- [x] Partial / weighed works with Multi-Bar ON + **exactly 1** selected bar
- [x] Multi-Bar with **2+** selected bars still **blocks** Partial
- [x] Not weighed / Unopened unchanged
- [x] Submit payload unchanged (PARTIAL note flattening intact)
- [x] Live submit/sync confirmed

## Restore commands
```sh
git fetch --all --tags
git checkout barback-link-stable-manual-scale-v1
```

## Backup
- MiniSSD backup folder: `/Volumes/MiniSSD/BARINV WEBSITE BACKUP JUNE_19th`
- Backup zip path: `/Volumes/MiniSSD/BARINV WEBSITE BACKUP JUNE_19th/barinv-pro_BARBACK_LINK_STABLE_MANUAL_SCALE_v1_20260619_0047_2c981acf.zip`
- Integrity: verified with `zip -T` (see Part D in session report)
