const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Bluefy diagnostics panel and bounded trace contract are present', () => {
  assert.match(html, /BLUEFY-WEIGHT-DIAG-20260919/);
  assert.match(html, /BLUEFY_WEIGHT_DIAGNOSTICS_START/);
  assert.match(html, /id="bluefy-diag-panel"/);
  assert.match(html, /id="bluefy-diag-output"/);
  assert.match(html, /CLEAR/);
  assert.match(html, /COPY DIAGNOSTICS/);
  assert.match(html, /BLUEFY_DIAG_HISTORY_LIMIT = 40/);
  assert.match(html, /window\.__BARINV_BLUEFY_DIAGNOSTICS/);
});

test('diagnostics cover scan-to-weigh, selection, and scale transitions', () => {
  assert.match(html, /flow: 'DISPATCH_SCAN_LAUNCH'/);
  assert.match(html, /flow: 'DISPATCH_SCAN_TO_WEIGH'/);
  assert.match(html, /flow: 'WEIGH_OPEN'/);
  assert.match(html, /flow: 'SCALE_CONNECT_ATTEMPT'/);
  assert.match(html, /flow: 'SCALE_CONNECTED'/);
  assert.match(html, /flow: 'SCALE_READING'/);
  assert.match(html, /flow: 'SCALE_DISCONNECT'/);
  assert.match(html, /flow: 'SCALE_ERROR'/);
});

test('diagnostics are safe and do not add credential or persistence reads', () => {
  const start = html.indexOf('BLUEFY_WEIGHT_DIAGNOSTICS_START - observation only');
  const end = html.indexOf('BLUEFY_WEIGHT_DIAGNOSTICS_END', start);
  assert.ok(start >= 0 && end > start, 'diagnostics source markers must be present');
  const source = html.slice(start, end);
  assert.doesNotMatch(source, /access_token|service_role|anonKey|password|secret|session_token/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
