# P0-07 App Legal and Support URLs - Local Validation

Date: 2026-07-30
Repository: `/Users/saiedbeikhosseini/Documents/barinv-pro`
Branch: `fix/p0-app-legal-support-urls-v1`
Starting commit: `37910f3d23a9cad8300ee1bd927da67b08df201a`

## Result

**PASS - local implementation is ready for owner and legal review.**

The repository now contains a static, app-specific Privacy Policy, Terms of Use,
and Support page intended for these stable public URLs:

- `https://barinv.ca/privacy-policy.html`
- `https://barinv.ca/app/terms`
- `https://barinv.ca/support.html`

No website deployment, Production command, Supabase command, Git push, tag, iOS
change, signing change, build, or secret access was performed.

## Root Cause

Read-only inspection confirmed:

| Live URL | Result | Scope |
|---|---:|---|
| `https://barinv.ca/privacy` | 200 | Marketing website only; explicitly excludes operational software |
| `https://barinv.ca/terms` | 200 | Marketing website only; operational software uses separate terms |
| `https://barinv.ca/terms.html` | 308 to `/terms` | Conflicts with the marketing-only route |
| `https://barinv.ca/privacy-policy.html` | 404 | Missing |
| `https://barinv.ca/support.html` | 404 | Missing |

The Phase 0 freeze evidence also confirmed that no authoritative current
version-controlled BARINV.ca source repository was identified. Historical
website backups exist, but they are not a safe substitute for a selected
canonical source and deployment pipeline.

## Implementation

### App Privacy Policy

`privacy-policy.html` covers the actual operational surfaces and data categories
identified in the release-readiness audit:

- BARINV PRO Admin app and web Admin
- Barback Link and Barback Manager
- account, role, Venue, Night, staff, and Bar scope
- inventory movements, Events, review, and audit records
- Barback sessions, drafts, offline outbox, and synchronization
- camera/barcode use
- direct Bluetooth scale readings, manual grams, and derived estimates
- configured integrations
- Supabase authentication and backend processing
- device storage, retention, access, correction, deletion, and support requests

The policy does not claim a compliance certification, fixed retention period,
guaranteed deletion outcome, or completed App Store release.

### App Terms

`app/terms.html` defines:

- venue authority and account responsibilities
- scoped operational access
- manager review and PENDING Event rules
- operator responsibility for inventory entries
- scale and barcode limitations
- offline/outbox and connectivity expectations
- third-party integrations
- acceptable use and security restrictions
- service-availability limitations
- privacy-policy integration

The Terms do not identify an unverified legal entity or promise an SLA. They
preserve separate signed venue agreements where applicable and use the same
British Columbia/Canada governing-law posture as the existing public website.

### App Support

`support.html` uses the existing verified public contact
`info@barinv.ca` and provides:

- safe issue-reporting details
- event-night operational precautions
- login, PIN, assigned-scope, and session guidance
- outbox/storage-failure guidance
- scanner, Bluetooth, manual-weight, and Scale Bridge guidance
- privacy and account-request routing
- explicit warnings not to send credentials or complete authentication tokens

No guaranteed response time is claimed.

### Static Presentation

`legal.css` provides a shared responsive BARINV-styled presentation without
JavaScript, third-party runtime libraries, trackers, cookies, or remote fonts.
All three pages have:

- HTML5 document structure
- mobile viewport metadata
- descriptive title and metadata
- stable canonical URL
- keyboard skip link
- app legal/support navigation
- cross-links to the other two pages
- BARINV.ca home link

## Local Tests

### Content, structure, and links

Command:

```sh
node --test tests/app-legal-support-pages.test.cjs
```

Result: **PASS - 8 passed, 0 failed**

Assertions cover:

1. All pages and shared CSS exist and are non-empty.
2. Basic HTML structure, title, viewport, and canonical URL.
3. Every local link and stylesheet target resolves.
4. Privacy content covers actual app data and permissions.
5. Terms cover authority, review, measurements, and availability.
6. Support content provides safe operational and privacy guidance.
7. No placeholder, unsupported certification, or completed-release claim.
8. Three complete, distinct canonical App Store URL candidates.

### Loopback static HTTP check

A temporary server was bound only to `127.0.0.1`. Results:

```text
200 /privacy-policy.html
200 /app/terms.html
200 /support.html
200 /legal.css
```

The server was stopped automatically after the check. No log file was written.

### Source and scope checks

- Static pages contain no JavaScript: **PASS**
- Local link validation: **PASS**
- `git diff --check`: **PASS**
- Supabase migrations/functions changed: **NO**
- iOS files or iOS repository touched: **NO**
- Production/deployment command run: **NO**

## Files

- `privacy-policy.html`
- `app/terms.html`
- `support.html`
- `legal.css`
- `tests/app-legal-support-pages.test.cjs`
- `docs/P0_07_APP_LEGAL_SUPPORT_URLS_LOCAL_VALIDATION_20260730.md`

## Owner Decisions Before Deployment

1. Select the canonical BARINV.ca source repository and deployment pipeline.
2. Confirm the legal/service-provider identity that should appear publicly.
3. Approve or revise the support contact and any contractual support commitment.
4. Obtain appropriate legal review for the Privacy Policy and Terms.
5. Confirm the final public URL convention. This implementation uses stable
   `/privacy-policy.html`, `/app/terms`, and `/support.html` to repair the known
   missing paths without replacing the existing marketing-only `/privacy` and
   `/terms` pages.
6. Decide whether BARINV.ca navigation, sitemap, and robots files should expose
   the app pages after deployment.
7. Add live URLs to App Store metadata and in-app surfaces only under separate
   iOS/App Store approval.

## Release Status

P0-07 is locally implemented but is **not yet closed in Production**. Closure
requires owner/legal approval, deployment through the selected BARINV.ca source,
live HTTP/content verification, and approved App Store metadata. No such remote
action was performed in this phase.

## Rollback

Before deployment, rollback is a source-only revert of the eventual P0-07
commit. After deployment, preserve the pages at stable URLs whenever possible;
use a forward correction for wording changes so existing App Store links do not
break.

## Owner Review Gate

Approve one local commit containing exactly the six files listed above, or
provide wording/URL corrections. Deployment remains a separate approval.
