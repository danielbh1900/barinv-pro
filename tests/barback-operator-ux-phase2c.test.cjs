const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'barback.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
}

test('Phase 2C keeps a visible static boot screen before JavaScript routing', () => {
  assert.match(html, /<div class="screen active" id="screen-token">/);
  assert.match(html, /function startBarbackApp\(\)/);
  assert.match(html, /function renderSafeBootError\(errorLike\)/);
  assert.match(html, /App startup error\. Please reload or report this screen\./);
});

test('Phase 2C startup path does not execute scanner-only helpers', () => {
  const start = functionSource('startBarbackApp');
  assert.doesNotMatch(start, /canonicalBarcodeCooldownKey|rapidScanAddItem|onBarcodeScanned|openQtyModal|rapidScanBusy/);
  assert.match(start, /refreshNetBanner\(\)/);
  assert.match(start, /boot\(\)/);
});

test('Phase 2C converts a startup exception into a safe visible diagnostic', () => {
  const classes = new Set();
  const token = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const body = { firstChild: null, style: {}, insertBefore(node) { this.panel = node; } };
  const document = {
    body,
    getElementById(id) { return id === 'screen-token' ? token : id === 'barback-boot-error' ? body.panel || null : null; },
    createElement() { return { id: '', style: {}, setAttribute() {}, textContent: '' }; },
    querySelectorAll() { return [token]; },
  };
  const window = { addEventListener() {} };
  const context = { document, window, barbackBootComplete: false };
  vm.createContext(context);
  vm.runInContext(functionSource('renderSafeBootError'), context);
  context.renderSafeBootError({ name: 'TypeError' });
  assert.equal(classes.has('active'), true);
  assert.match(body.panel.textContent, /App startup error/);
  assert.match(body.panel.textContent, /TypeError/);
  assert.doesNotMatch(body.panel.textContent, /token|localStorage|https?:\/\//i);
});

test('Phase 2C preserves Phase 2B scanner hardening and prior Review/weight paths', () => {
  for (const marker of [
    'canonicalBarcodeCooldownKey', 'rapidScanAddItem', 'Ready for next scan',
    "bottleStateOverride: 'UNOPENED'", 'safeReviewRowHTML', 'buildDegradedReviewRow',
    'resolveQuantityAndWeightSemantics', 'phase1-gross-weight',
    'CONNECT / DETAILS', 'VOICE GUIDE', 'SPEAK ITEM NAMES',
  ]) assert.ok(html.includes(marker), `missing ${marker}`);
});
