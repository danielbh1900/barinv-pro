'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = app.indexOf('function eventLogNoteMetadata(notes) {');
const end = app.indexOf('async function loadEvents()', start);
assert.notEqual(start, -1, 'missing Event Log helper block');
assert.notEqual(end, -1, 'missing loadEvents marker');

function harness() {
  const elements = new Map([
    ['event-correction-qty', { value: '1' }],
    ['event-correction-weight', { value: '', disabled: true }],
    ['event-correction-weight-wrap', { style: {} }],
    ['event-correction-save', { disabled: true }],
  ]);
  const calls = [];
  const toasts = [];
  const modal = {};
  let selectedMode = '';
  let reloads = 0;
  let closes = 0;

  const context = {
    Object,
    Number,
    String,
    EVENT_REVIEW: { rows: [] },
    EVENT_CORRECTION: { eventId: null, venueId: null },
    SESSION: { venueId: 'venue-a' },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) {
        if (selector === 'input[name="event-correction-mode"]:checked' && selectedMode) {
          return { value: selectedMode };
        }
        return null;
      },
    },
    esc(value) {
      if (value == null) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    openModal(title, body, callback, footer) {
      Object.assign(modal, { title, body, callback, footer });
    },
    closeModal() { closes += 1; },
    toast(message, type) { toasts.push({ message, type }); },
    eventReviewSafeError(error, fallback) { return error?.message || fallback; },
    async loadEvents() { reloads += 1; },
    SB: {
      async rpc(name, payload) {
        calls.push({ name, payload });
        return {
          data: {
            event_id: payload.p_event_id,
            qty: payload.p_qty,
            correction_mode: payload.p_mode,
            weight_g: payload.p_weight_g,
          },
          error: null,
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);

  return {
    context,
    elements,
    calls,
    toasts,
    modal,
    setMode(mode) { selectedMode = mode; },
    get reloads() { return reloads; },
    get closes() { return closes; },
  };
}

test('Edit control is available only for PENDING events', () => {
  const h = harness();
  assert.match(h.context.eventCorrectionEditButton({ id: 'p1', status: 'PENDING' }), /✎/);
  assert.equal(h.context.eventCorrectionEditButton({ id: 'a1', status: 'APPROVED' }), '');
  assert.equal(h.context.eventCorrectionEditButton({ id: 'r1', status: 'REJECTED' }), '');
});

test('opening a correction requires manual mode selection without magnitude inference', () => {
  const h = harness();
  h.context.EVENT_REVIEW.rows = [{
    id: 'p1', venue_id: 'venue-a', status: 'PENDING', qty: 681.5,
    notes: '', action: 'RETURNED', items: { name: 'Legacy Bottle' },
    bars: { name: 'Main Bar' }, stations: { name: 'Well 1' },
  }];
  h.context.openEventCorrection('p1');
  assert.equal(h.modal.title, 'Correct Pending Event');
  assert.doesNotMatch(h.modal.body, /type="radio"[^>]*checked/);
  assert.equal(h.elements.get('event-correction-save').disabled, true);
  assert.equal(h.elements.get('event-correction-weight-wrap').style.display, 'none');
  assert.doesNotMatch(app.slice(start, end), /qty\s*>\s*10/i);
  assert.doesNotMatch(app.slice(start, end), /qty\s*>=\s*10/i);
});

test('Quantity mode sends structured intent and no weight', async () => {
  const h = harness();
  h.context.EVENT_CORRECTION = { eventId: 'p1', venueId: 'venue-a' };
  h.setMode('QUANTITY');
  h.elements.get('event-correction-qty').value = '1';
  h.elements.get('event-correction-weight').value = '681.5';
  await h.context.saveEventCorrection();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{
    name: 'barinv_correct_pending_event',
    payload: {
      p_venue_id: 'venue-a', p_event_id: 'p1', p_mode: 'QUANTITY',
      p_qty: 1, p_weight_g: null,
    },
  }]);
  assert.equal(h.toasts.at(-1).message, 'Event corrected: qty 1');
  assert.equal(h.closes, 1);
  assert.equal(h.reloads, 1);
});

test('Weight mode sends the human-selected quantity and decimal weight', async () => {
  const h = harness();
  h.context.EVENT_CORRECTION = { eventId: 'p2', venueId: 'venue-a' };
  h.setMode('WEIGHT');
  h.elements.get('event-correction-qty').value = '1';
  h.elements.get('event-correction-weight').value = '681.5';
  await h.context.saveEventCorrection();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), {
    name: 'barinv_correct_pending_event',
    payload: {
      p_venue_id: 'venue-a', p_event_id: 'p2', p_mode: 'WEIGHT',
      p_qty: 1, p_weight_g: 681.5,
    },
  });
  assert.equal(h.toasts.at(-1).message, 'Event corrected: qty 1 • 681.5 g');
});

test('invalid quantity and weight are blocked before the RPC call', async () => {
  const h = harness();
  h.context.EVENT_CORRECTION = { eventId: 'p1', venueId: 'venue-a' };
  h.setMode('QUANTITY');
  for (const value of ['0', '-1', '1.5']) {
    h.elements.get('event-correction-qty').value = value;
    await h.context.saveEventCorrection();
  }
  h.setMode('WEIGHT');
  h.elements.get('event-correction-qty').value = '1';
  for (const value of ['', '0', '-1', 'not-a-number']) {
    h.elements.get('event-correction-weight').value = value;
    await h.context.saveEventCorrection();
  }
  assert.equal(h.calls.length, 0);
});

test('venue change blocks the RPC and reloads the Event Log', async () => {
  const h = harness();
  h.context.EVENT_CORRECTION = { eventId: 'p1', venueId: 'venue-a' };
  h.context.SESSION.venueId = 'venue-b';
  h.setMode('QUANTITY');
  await h.context.saveEventCorrection();
  assert.equal(h.calls.length, 0);
  assert.equal(h.closes, 1);
  assert.equal(h.reloads, 1);
});

test('existing approval and rejection buttons remain PENDING-only', () => {
  const setStatusEnd = app.indexOf('async function setStatus(', end);
  const loadEventsSource = app.slice(end, setStatusEnd);
  assert.match(loadEventsSource, /eventCorrectionEditButton\(e\)/);
  assert.match(loadEventsSource, /e\.status === 'PENDING'.*setStatus\('\$\{esc\(e\.id\)\}','APPROVED'\)/s);
  assert.match(loadEventsSource, /e\.status === 'PENDING'.*setStatus\('\$\{esc\(e\.id\)\}','REJECTED'\)/s);
});
