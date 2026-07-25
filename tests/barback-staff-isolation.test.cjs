const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pinLogin = fs.readFileSync(
  path.join(root, 'supabase/functions/barback-pin-login/index.ts'),
  'utf8',
);
const openingChecklist = fs.readFileSync(
  path.join(root, 'supabase/functions/barback-opening-par-checklist/index.ts'),
  'utf8',
);

test('PIN login scopes multi-staff links to the staff member assignment', () => {
  assert.match(pinLogin, /BARBACK_STAFF_SCOPED_DESTINATIONS_START/);
  assert.match(pinLogin, /staff assignment scope lookup failed/);
  assert.match(pinLogin, /scopedAllowedBars = sessionDestinationIds\.filter/);
  assert.match(pinLogin, /allowed_bars:\s*scopedAllowedBars\.join\(","\)/);
  assert.match(pinLogin, /allowed_bars:\s*scopedAllowedBars/);
  assert.match(pinLogin, /\.in\("id", scopedAllowedBars\)/);
  assert.doesNotMatch(
    pinLogin,
    /allowed_bars:\s*\(Array\.isArray\(session\.allowed_bars\)/,
  );
});

test('Opening PAR narrows session destinations using signed staff-scoped JWT destinations', () => {
  assert.match(openingChecklist, /BARBACK_OPENING_PAR_CLAIM_DESTINATIONS_START/);
  assert.match(openingChecklist, /BARBACK_OPENING_PAR_STAFF_SCOPED_DESTINATIONS_START/);
  assert.match(openingChecklist, /const claimDestinationSet = new Set\(claimAllowedBarIds\)/);
  assert.match(openingChecklist, /sessionDestinationIds\.filter\(\(id\) => claimDestinationSet\.has\(id\)\)/);
  assert.match(openingChecklist, /Opening PAR has no authorized destinations for this staff member/);
  assert.doesNotMatch(openingChecklist, /allowedDestinationIds\.add\(session\.bar_id\)/);
});
