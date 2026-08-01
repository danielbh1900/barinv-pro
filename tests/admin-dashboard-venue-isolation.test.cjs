'use strict';

// Admin dashboard venue-isolation smoke test.
// Extracts the real Supabase wrapper + venue switch + dashboard/realtime code
// out of index.html and runs it against a recording mock client, so the
// dashboard can never again render another venue's counters or activity.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing marker: ${start}`);
  const b = source.indexOf(end, a);
  assert.notEqual(b, -1, `missing marker: ${end}`);
  return source.slice(a, b);
}

const SRC = [
  between(app, 'function initSupabase(url, key) {', 'async function saveConfig()'),
  between(app, '// ── Venue Management ──', 'function openAddVenue()'),
  between(app, 'function eventBelongsToActiveVenue(ev)', 'function eventRow(e)'),
].join('\n');

// ── Minimal DOM ───────────────────────────────────────────────────────────
function makeEl(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    children: [],
    firstChild: null,
    lastChild: null,
    style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    insertBefore(node) { this.children.unshift(node); this.firstChild = node; this.lastChild = this.children[this.children.length - 1]; },
    removeChild(node) { this.children = this.children.filter(c => c !== node); this.lastChild = this.children[this.children.length - 1] || null; },
  };
}

// ── Recording Supabase mock ───────────────────────────────────────────────
function makeClient(rowsByTable, calls) {
  const filterProto = {
    eq(col, val) { this._filters.push([col, val]); return this; },
    order() { return this; },
    limit() { return this; },
    single() { this._single = true; return this; },
    then(resolve) {
      const rows = (rowsByTable[this._table] || []).filter(r =>
        this._filters.every(([c, v]) => String(r[c]) === String(v)));
      calls.push({ table: this._table, filters: this._filters.slice() });
      return Promise.resolve(resolve({ data: this._single ? (rows[0] || null) : rows, error: null }));
    },
  };
  const queryProto = {
    select(cols) {
      const f = Object.create(filterProto);
      f._table = this._table; f._cols = cols; f._filters = []; f._single = false;
      return f;
    },
    insert(data) { const f = this.select(); f._insert = data; return f; },
    update(data) { const f = this.select(); f._update = data; return f; },
    delete() { return this.select(); },
  };
  const channel = { on() { return this; }, subscribe() { return this; } };
  return {
    from(table) { const q = Object.create(queryProto); q._table = table; return q; },
    channel(name) { channel._name = name; return channel; },
    auth: {},
  };
}

const VENUE_A = '11111111-1111-1111-1111-111111111111'; // has data
const VENUE_B = '22222222-2222-2222-2222-222222222222'; // Anima Festival — fresh

function boot() {
  const calls = [];
  const els = new Map();
  const rows = {
    venues: [
      { id: VENUE_A, name: 'Harbour Event Centre', active: true },
      { id: VENUE_B, name: 'Anima Festival', active: true },
    ],
    events: [
      { id: 'e1', venue_id: VENUE_A, status: 'PENDING', action: 'REQUEST', created_at: '2026-07-01T00:00:00Z', qty: 1 },
      { id: 'e2', venue_id: VENUE_A, status: 'DONE', action: 'DELIVERED', created_at: '2026-07-01T01:00:00Z', qty: 1 },
      { id: 'e3', venue_id: VENUE_A, status: 'DONE', action: 'RETURNED', created_at: '2026-07-01T02:00:00Z', qty: 1 },
    ],
  };

  const ctx = {
    console,
    Promise,
    Set,
    Date,
    setTimeout,
    calls,
    els,
    supabase: { createClient: () => makeClient(rows, calls) },
    SB: null,
    SESSION: {
      type: 'admin', role: 'admin', user: { email: 'a@b.c' },
      venueId: VENUE_A, venueName: 'Harbour Event Centre', venues: [],
      cache: { bars: [], stations: [], items: [], staff: [], nights: [], placements: [] },
    },
    DSP_STATE: {}, DSP_STAFF_MAP: {},
    localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    document: {
      getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
      createElement() { return makeEl('tr'); },
    },
    esc: s => String(s ?? ''),
    toast: () => {},
    eventRow: () => '<td>row</td>',
    navigateTo: id => { if (id === 'dashboard') return ctx.loadDashboard(); },
    preload: async () => {
      const { data } = await ctx.SB.from('nights').select('*');
      ctx.SESSION.cache.nights = data || [];
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.initSupabase('https://x.supabase.co', 'anon');
  return ctx;
}

test('1. dashboard event query is scoped to the active venue', async () => {
  const ctx = boot();
  ctx.calls.length = 0;
  await ctx.loadDashboard();
  const q = ctx.calls.find(c => c.table === 'events');
  assert.ok(q, 'dashboard did not query events');
  assert.ok(q.filters.some(([c, v]) => c === 'venue_id' && v === VENUE_A),
    `events query missing venue_id filter: ${JSON.stringify(q.filters)}`);
});

test('2. fresh venue renders zeroed counters and an empty activity table', async () => {
  const ctx = boot();
  await ctx.loadDashboard();
  assert.match(ctx.document.getElementById('dash-stats').innerHTML, /class="stat-val">1</);

  await ctx.switchVenue(VENUE_B);
  const stats = ctx.document.getElementById('dash-stats').innerHTML;
  const counters = [...stats.matchAll(/class="stat-val">(\d+)</g)].map(m => m[1]);
  assert.deepEqual(counters, ['0', '0', '0', '0'], `stale counters after venue switch: ${stats}`);
  assert.match(ctx.document.getElementById('dash-tbody').innerHTML, /No events yet/);
});

test('3. venue switch clears dashboard DOM before the refetch resolves', async () => {
  const ctx = boot();
  await ctx.loadDashboard();
  ctx.document.getElementById('last-update').textContent = 'Updated 10:00:00';

  let cleared = null;
  const realLoad = ctx.loadDashboard;
  ctx.loadDashboard = async () => {
    // snapshot the DOM at the moment the reload starts
    cleared = {
      stats: ctx.document.getElementById('dash-stats').innerHTML,
      tbody: ctx.document.getElementById('dash-tbody').innerHTML,
      updated: ctx.document.getElementById('last-update').textContent,
    };
    return realLoad();
  };
  await ctx.switchVenue(VENUE_B);

  assert.ok(cleared, 'venue switch never reloaded the dashboard');
  assert.doesNotMatch(cleared.stats, /stat-val">[1-9]/, 'prior venue counters survived the switch');
  assert.equal(cleared.tbody, '', 'prior venue activity rows survived the switch');
  assert.equal(cleared.updated, '', 'prior venue timestamp survived the switch');
});

test('4. venue switch drops the prior venue cached lists', async () => {
  const ctx = boot();
  ctx.SESSION.cache.nights = [{ id: 'n1', name: 'Other Venue Night' }];
  ctx.SESSION.cache.bars = [{ id: 'b1', name: 'Other Venue Bar' }];
  let sawStale = false;
  const realPreload = ctx.preload;
  ctx.preload = async () => {
    if (ctx.SESSION.cache.nights.length || ctx.SESSION.cache.bars.length) sawStale = true;
    return realPreload();
  };
  await ctx.switchVenue(VENUE_B);
  assert.equal(sawStale, false, 'prior venue cache was still populated when the new venue loaded');
  assert.deepEqual(ctx.SESSION.cache.nights, []);
});

test('5. realtime inserts from another venue never reach the dashboard', () => {
  const ctx = boot();
  let handler = null;
  ctx.SB.channel = () => ({ on: (_e, _f, cb) => { handler = cb; return { subscribe: () => {} }; } });
  ctx.setupRealtime();
  assert.ok(handler, 'realtime handler not registered');

  const tbody = ctx.document.getElementById('dash-tbody');
  handler({ new: { id: 'x1', venue_id: VENUE_B, created_at: '2026-07-02T00:00:00Z', action: 'REQUEST', status: 'PENDING', qty: 1 } });
  assert.equal(tbody.children.length, 0, 'foreign-venue realtime event leaked into Recent Events');

  handler({ new: { id: 'x2', venue_id: VENUE_A, created_at: '2026-07-02T00:00:00Z', action: 'REQUEST', status: 'PENDING', qty: 1 } });
  assert.equal(tbody.children.length, 1, 'own-venue realtime event was dropped');
});

test('6. a failed dashboard refetch does not leave the prior venue on screen', async () => {
  const ctx = boot();
  await ctx.loadDashboard();
  const origFrom = ctx.SB.from.bind(ctx.SB);
  ctx.SB.from = table => {
    if (table !== 'events') return origFrom(table);
    throw new Error('network down');
  };
  ctx.SESSION.venueId = VENUE_B;
  await ctx.loadDashboard();
  assert.doesNotMatch(ctx.document.getElementById('dash-stats').innerHTML, /stat-val">[1-9]/,
    'failed refetch left the prior venue counters on screen');
});
