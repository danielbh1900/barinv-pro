# BARINV Pro

Production-grade, multi-venue, offline-capable hospitality bar inventory & operations platform.

## Stack

- **Frontend:** Single-file vanilla JS/HTML/CSS PWA (`index.html`)
- **Backend:** Supabase (PostgreSQL) with Row Level Security
- **Auth:** Supabase Auth (admin) + 6-digit barback room codes
- **POS:** Square API via Supabase Edge Function (`square-sync`)
- **Deployment:** GitHub Pages (static)
- **Service Worker:** Stale-while-revalidate caching

## Files

| File | Purpose |
|------|---------|
| `index.html` | Entire app (~10,300 lines, ~285 functions) |
| `sw.js` | Service worker with offline caching |
| `manifest.json` | PWA manifest |
| `img/` | Product images & PWA icons |
| `schema.sql` | Full database schema (reference) |
| `pos_tables_patch.sql` | POS tables patch (reference) |

## Features

- Multi-venue support (3 active venues)
- 26 pages: Dashboard, Dispatch, Variance, Accountability, POS Monitor, and more
- Square POS integration with auto-discover locations
- Excel export via SheetJS
- Barcode scanning (BarcodeDetector API)
- Receipt OCR (Tesseract.js)
- Offline-first with service worker

## Deploy

Push to `main` — GitHub Pages auto-deploys.
