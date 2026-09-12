'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');

test('Diagnostics UI is disabled without querying missing telemetry views', () => {
  assert.match(manager, /const BARBACK_DIAGNOSTICS_ENABLED = false;/);
  assert.match(manager, /Diagnostics temporarily disabled — telemetry migration not installed\./);
  assert.match(manager, /diagnosticsTabButton\.hidden = true/);
  assert.match(manager, /if \(BARBACK_DIAGNOSTICS_ENABLED\) \{[\s\S]*renderDiagnostics\(\); renderAnalyticsSummary\(\); startDiagAutoRefresh\(\);/);
  assert.match(manager, /if \(!BARBACK_DIAGNOSTICS_ENABLED\) \{[\s\S]*renderDiagnosticsDisabled\(\);[\s\S]*\}/);
  assert.match(manager, /async function renderAnalyticsSummary\(\) \{[\s\S]*if \(!BARBACK_DIAGNOSTICS_ENABLED\) \{[\s\S]*renderDiagnosticsDisabled\(\);/);
  assert.match(manager, /async runChecks\(\) \{[\s\S]*if \(!BARBACK_DIAGNOSTICS_ENABLED\) \{[\s\S]*return;/);
  assert.match(manager, /async exportBundle\(\) \{[\s\S]*if \(!BARBACK_DIAGNOSTICS_ENABLED\) \{[\s\S]*return;/);
});

