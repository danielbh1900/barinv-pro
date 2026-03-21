# BARINV Pro

Production-grade, multi-venue, offline-capable hospitality operations platform.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- React Router v6
- TanStack Query v5
- React Hook Form + Zod
- Supabase (Auth, Postgres, Realtime, Storage, Edge Functions)
- vite-plugin-pwa (Workbox)
- Vitest + Playwright
- GitHub Actions (CI/CD)
- Sentry

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/your-org/barinv-pro.git
cd barinv-pro
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

### 3. Set up Supabase locally

```bash
npx supabase start
npx supabase db reset
```

### 4. Run development server

```bash
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Typecheck + production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright E2E tests |

## Branch Strategy

| Branch | Environment | Auto-deploy |
|--------|-------------|-------------|
| `feature/*` | Local | No |
| `develop` | Local | No |
| `staging` | Staging | Yes (Vercel + Supabase staging) |
| `main` | Production | Yes (Vercel + Supabase prod) |

## Required GitHub Secrets

```
STAGING_SUPABASE_URL
STAGING_SUPABASE_ANON_KEY
STAGING_SUPABASE_PROJECT_REF
PROD_SUPABASE_URL
PROD_SUPABASE_ANON_KEY
PROD_SUPABASE_PROJECT_REF
SUPABASE_ACCESS_TOKEN
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
SENTRY_DSN
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
```

## Architecture

See `docs/architecture/` and `docs/adr/` for architecture decision records.

Key contracts:
- All timestamps stored in UTC. Timezone is per-venue.
- Permissions enforced in Supabase RLS — UI gating is secondary.
- Offline writes use client operation UUIDs for idempotency.
- Audit log is append-only — no UPDATE or DELETE permitted.
- `stock_movements` and `cost_snapshots` are immutable ledgers.

## Current Build Phase

See `BUILD-START-v3.md` for the full execution plan.
