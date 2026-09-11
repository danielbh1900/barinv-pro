const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'barback_manager.html'), 'utf8');
const barback = fs.readFileSync(path.join(root, 'barback.html'), 'utf8');
const createEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-create-session/index.ts'), 'utf8');
const loginEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-pin-login/index.ts'), 'utf8');
const listEdge = fs.readFileSync(path.join(root, 'supabase/functions/barback-manager-sessions/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260911122000_barback_sessions_allowed_movements.sql'), 'utf8');

test('manager defaults both movements and exposes all presets', () => {
  assert.match(manager, /id="c-allow-take" checked/);
  assert.match(manager, /id="c-allow-return" checked/);
  assert.match(manager, /data-movement-preset="both"/);
  assert.match(manager, /data-movement-preset="return"/);
  assert.match(manager, /data-movement-preset="take"/);
  assert.match(manager, /Actions:<\/b>.*movementLabel/);
});

test('manager validates movement selection and Return-only Opening PAR conflict', () => {
  assert.match(manager, /at least one movement must be enabled|Enable TAKE \/ OUT or RETURN \/ BACK/);
  assert.match(manager, /Opening PAR requires TAKE\. Return-only cleanup sessions cannot require Opening PAR\./);
  assert.match(manager, /allowed_movements: allowedMovements/);
});

test('create-session normalizes, validates, persists, signs, and audits movements', () => {
  assert.match(createEdge, /allowed_movements\?: unknown/);
  assert.match(createEdge, /return \{ take: true, return: true \}/);
  assert.match(createEdge, /at least one movement must be enabled/);
  assert.match(createEdge, /Opening PAR requires TAKE\. Return-only cleanup sessions cannot require Opening PAR\./);
  assert.match(createEdge, /allowed_movements: allowedMovements/);
  assert.match(createEdge, /allowed_movements: session\.allowed_movements/);
});

test('PIN login and manager listing propagate legacy-safe movement data', () => {
  assert.match(loginEdge, /normalizeAllowedMovements\(session\.allowed_movements\)/);
  assert.match(loginEdge, /allowed_movements: normalizeAllowedMovements/);
  assert.match(listEdge, /allowed_movements/);
  assert.match(listEdge, /movement_mode/);
  assert.match(listEdge, /return \"BOTH\"/);
});

test('barback UI guards render, action selection, direct save, review, edits, sync, and undo', () => {
  assert.match(barback, /function normalizeAllowedMovements/);
  assert.match(barback, /This link is RETURN only\./);
  assert.match(barback, /btn\.disabled = !enabled/);
  assert.match(barback, /if \(!isMovementAllowed\(btn\.dataset\.action\)\)/);
  assert.match(barback, /if \(!isMovementAllowed\(payload && payload\.action\)\)/);
  assert.match(barback, /if \(!isMovementAllowed\(state\.selectedAction\)\)/);
  assert.match(barback, /if \(!isMovementAllowed\(action\)\)/);
  assert.match(barback, /if \(!isMovementAllowed\(reverseAction\)\)/);
  assert.match(barback, /if \(!isMovementAllowed\(rec\.action\)\)/);
  assert.match(barback, /Remove or edit the blocked draft before submitting/);
  assert.match(barback, /async function submitAllDraftsToBarinv\(\)[\s\S]*isMovementAllowed\(d\.action\)/);
});

test('migration adds BOTH-default storage, narrow check, and server enforcement', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS allowed_movements jsonb NOT NULL/);
  assert.match(migration, /\{"take":true,"return":true\}/);
  assert.match(migration, /jsonb_typeof\(allowed_movements -> 'take'\) = 'boolean'/);
  assert.match(migration, /jsonb_typeof\(allowed_movements -> 'return'\) = 'boolean'/);
  assert.match(migration, /allowed_movements - 'take' - 'return'/);
  assert.match(migration, /does not allow TAKE movements/);
  assert.match(migration, /does not allow RETURN movements/);
  assert.match(migration, /CREATE TRIGGER trg_events_session_allowed_movements/);
});
