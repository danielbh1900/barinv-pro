const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('barback.html', 'utf8');
const start = html.indexOf('const PHASE1_SCALE_FRESH_MS =');
const end = html.indexOf('// END BARINV_LEGACY_PENDING_SCALE_V1', start);

assert.ok(start >= 0 && end > start);

test('Pending bottle scale safety guard', () => {
  let beta = true;
  const ctx = {
    phase1WeighPendingItem: {id: 'BOTTLE_B'},
    phase1WeighStartedAt: 10000,
    phase1MeasureUnit: 'WEIGHT',
    state: {
      selectedItemId: 'BOTTLE_B',
      selectedAction: 'TAKEN'
    },
    bleScale: {connected: true, latest: null},
    _scaleBetaEnabled: () => beta,
    _isTrustedLocalScaleReading: r =>
      !!r && r.trusted === true &&
      r.source === 'local_web_bluetooth' &&
      Number.isFinite(r.grams)
  };

  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);

  function check(label, grams, ts, stable, expected,
                 trusted = true, now = 11000) {
    ctx.bleScale.latest = {
      grams, raw: grams, ts, stable, trusted,
      source: 'local_web_bluetooth'
    };
    assert.equal(
      !!ctx.phase1PendingScaleReading(now),
      expected,
      label
    );
    console.log('PASS:', label);
  }

  check('Old timestamp', 1202, 9900, true, false);
  check('Previous bottle blocked', 1202, 10100, true, false);
  check('Empty scale detected', 0, 10400, true, false);
  check('Unstable new bottle blocked', 850, 10600, false, false);
  check('Stable new bottle accepted', 850, 10900, true, true);
  check('Untrusted reading blocked', 850, 10900, true, false, false);
  check('Future timestamp blocked', 850, 12000, true, false);
  check('Expired reading blocked', 850, 10900, true, false, true, 14000);

  beta = false;
  check('Beta disabled', 850, 10900, true, false);
  beta = true;

  ctx.bleScale.connected = false;
  check('Disconnected scale blocked', 850, 10900, true, false);
  ctx.bleScale.connected = true;

  ctx.state.selectedItemId = 'OTHER_BOTTLE';
  check('Wrong item blocked', 850, 10900, true, false);
  ctx.state.selectedItemId = 'BOTTLE_B';

  ctx.phase1WeighStartedAt = 10800;
  check('New scan requires empty scale', 850, 10900, true, false);
});
