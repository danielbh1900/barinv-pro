/* BARINV Staff attempt journal for the canonical Staff page.
 * The caller must run the existing Staff authorization and exact-row acknowledgment
 * checks. This journal never submits inventory or stores auth credentials.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BarInvStaffAttemptJournal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DB_NAME = 'barinv_staff_attempt_journal_v1';
  const STORE = 'attempts';
  const MODES = new Set(['opening', 'taking', 'returning', 'transfer']);
  const DEFINITE_REJECTION_CODES = new Set(['42501', '23502', '23503', '23514', '22023', '22P02', 'P0001']);
  const RECORD_FIELDS = new Set(['client_event_id', 'venue_id', 'night_id', 'bar_id', 'destination_bar_id',
    'item_id', 'qty', 'action', 'status', 'submitted_by', 'notes', 'staff_id', 'source', 'session_id']);
  const SECRET_KEY = /^(?:password|passcode|night_?code|access_?code|token|secret|credential|authorization|api_?key|service_?role_?key)$/i;
  const copy = value => JSON.parse(JSON.stringify(value));
  const error = (code, message) => Object.assign(new Error(message), { code });
  function nonempty(value) { return typeof value === 'string' && value.length > 0; }
  function scopeKey(scope) {
    if (!scope || !nonempty(scope.projectRef) || !nonempty(scope.venueId) ||
        !nonempty(scope.staffId) || !nonempty(scope.nightId) || !MODES.has(scope.mode))
      throw error('INVALID_SCOPE', 'Staff attempt scope is incomplete.');
    return JSON.stringify([scope.projectRef, scope.venueId, scope.staffId, scope.nightId, scope.mode]);
  }
  function cleanAuth(auth) {
    if (!auth || !nonempty(auth.assignmentId) || !Array.isArray(auth.allowedBarIds) ||
        !auth.allowedBarIds.every(nonempty)) throw error('INVALID_AUTH_SCOPE', 'Current assignment scope is incomplete.');
    return { assignmentId: auth.assignmentId, allowedBarIds: [...new Set(auth.allowedBarIds)].sort() };
  }
  function sameAuth(a, b) {
    return !!a && !!b && a.assignmentId === b.assignmentId &&
      JSON.stringify(a.allowedBarIds) === JSON.stringify(b.allowedBarIds);
  }
  function rejectSecrets(value, path = '') {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw error('FORBIDDEN_FIELD', `Credential-shaped field at ${path || 'payload'} is not journaled.`);
      rejectSecrets(child, path ? `${path}.${key}` : key);
    }
  }
  function cleanAttempt(scope, auth, attempt) {
    if (!attempt || !nonempty(attempt.entryId) || !nonempty(attempt.attemptId) ||
        !Array.isArray(attempt.records) || !attempt.records.length || !attempt.draft || typeof attempt.draft !== 'object')
      throw error('INVALID_ATTEMPT', 'A frozen Staff batch and draft are required.');
    rejectSecrets(attempt.draft);
    const records = copy(attempt.records), ids = new Set();
    for (const row of records) {
      if (!row || Object.keys(row).some(key => !RECORD_FIELDS.has(key)) ||
          !nonempty(row.client_event_id) || ids.has(row.client_event_id) ||
          row.venue_id !== scope.venueId || row.night_id !== scope.nightId ||
          !auth.allowedBarIds.includes(row.bar_id) ||
          (scope.mode === 'transfer' && !auth.allowedBarIds.includes(row.destination_bar_id)) ||
          !nonempty(row.item_id) ||
          !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0 || row.status !== 'PENDING')
        throw error('INVALID_ATTEMPT', 'Frozen event rows are not unique and in scope.');
      ids.add(row.client_event_id);
    }
    return { entryId: attempt.entryId, attemptId: attempt.attemptId, records, draft: copy(attempt.draft) };
  }

  // Every update below is one readwrite transaction on the same object store.
  // IndexedDB serializes conflicting transactions across same-origin tabs.
  function indexedDbStore(indexedDB) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw error('JOURNAL_UNAVAILABLE', 'IndexedDB is unavailable; Staff submission must remain blocked.');
    let opened;
    function db() {
      if (opened) return opened;
      opened = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        let blocked = false;
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
        };
        req.onsuccess = () => {
          if (blocked) { req.result.close(); return; }
          req.result.onversionchange = () => req.result.close();
          resolve(req.result);
        };
        req.onerror = () => reject(error('JOURNAL_UNAVAILABLE', 'Staff attempt journal could not open.'));
        req.onblocked = () => { blocked = true; reject(error('JOURNAL_UNAVAILABLE', 'Staff attempt journal is blocked by another tab.')); };
      }).catch(cause => { opened = null; throw cause; });
      return opened;
    }
    async function get(key) {
      const handle = await db();
      return new Promise((resolve, reject) => {
        const tx = handle.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        tx.oncomplete = () => resolve(req.result ? copy(req.result) : null);
        tx.onerror = () => reject(error('JOURNAL_UNAVAILABLE', 'Staff attempt journal read failed.'));
        tx.onabort = () => reject(error('JOURNAL_UNAVAILABLE', 'Staff attempt journal read aborted.'));
      });
    }
    async function update(key, decide) {
      const handle = await db();
      return new Promise((resolve, reject) => {
        const tx = handle.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let result, decisionError;
        const req = store.get(key);
        req.onsuccess = () => {
          try {
            const choice = decide(req.result ? copy(req.result) : null);
            result = choice.result;
            if (choice.write) store.put({ ...copy(choice.write), key });
          } catch (cause) { decisionError = cause; tx.abort(); }
        };
        tx.oncomplete = () => resolve(copy(result));
        tx.onerror = () => reject(decisionError || error('JOURNAL_UNAVAILABLE', 'Staff attempt journal write failed.'));
        tx.onabort = () => reject(decisionError || error('JOURNAL_UNAVAILABLE', 'Staff attempt journal write aborted.'));
      });
    }
    return { get, update };
  }

  function createJournal(store, now = () => Date.now()) {
    if (!store || typeof store.get !== 'function' || typeof store.update !== 'function')
      throw error('JOURNAL_UNAVAILABLE', 'Atomic Staff attempt storage is required.');
    function guard(row, auth) {
      if (row && !sameAuth(row.auth, auth)) throw error('SCOPE_CHANGED', 'Staff assignment changed; retain prior attempt for authorized reconciliation.');
    }
    async function read(scope, authInput) {
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      const row = await store.get(key);
      guard(row, auth);
      return row;
    }
    async function claim(scope, authInput, attemptInput) {
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      const attempt = cleanAttempt(scope, auth, attemptInput);
      return store.update(key, prior => {
        guard(prior, auth);
        if (prior && !(prior.state === 'new_entry' && prior.entryId === attempt.entryId))
          return { result: { claimed: false, state: prior.state, attemptId: prior.attemptId || null } };
        const row = { key, scope: copy(scope), auth, ...attempt, state: 'frozen', createdAt: now(),
          previousReceipt: prior?.previousReceipt || null };
        return { write: row, result: { claimed: true, state: row.state, attemptId: row.attemptId } };
      });
    }
    async function markSending(scope, authInput, attemptId) {
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (!row || row.attemptId !== attemptId || row.state !== 'frozen')
          throw error('ATTEMPT_NOT_FROZEN', 'No owned frozen Staff attempt can start a write.');
        row.state = 'sending'; row.writeStartedAt = now();
        return { write: row, result: { state: row.state, attemptId } };
      });
    }
    async function markUnknown(scope, authInput, attemptId) {
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (!row || row.attemptId !== attemptId || !['sending', 'unknown'].includes(row.state))
          throw error('ATTEMPT_MISMATCH', 'Unknown status applies only to the frozen sent attempt.');
        row.state = 'unknown';
        return { write: row, result: { state: row.state, attemptId } };
      });
    }
    async function markVerified(scope, authInput, attemptId, acknowledgment) {
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (!row || row.attemptId !== attemptId || !['sending', 'unknown', 'verified'].includes(row.state))
          throw error('ATTEMPT_MISMATCH', 'Verified status applies only to the sent attempt.');
        const expected = row.records.map(record => record.client_event_id).sort();
        const observed = Array.isArray(acknowledgment?.rows) ? acknowledgment.rows.map(record => record.client_event_id).sort() : [];
        if (acknowledgment?.acknowledged !== expected.length || acknowledgment?.missing !== 0 ||
            acknowledgment?.mismatched !== 0 || acknowledgment?.unexpected !== 0 ||
            JSON.stringify(expected) !== JSON.stringify(observed))
          throw error('INCOMPLETE_ACK', 'All frozen client event IDs must be independently verified before completion.');
        row.state = 'verified'; row.receipt = copy(acknowledgment); row.verifiedAt = now();
        return { write: row, result: { state: row.state, attemptId } };
      });
    }
    async function markRejected(scope, authInput, attemptId, sqlstate) {
      if (!DEFINITE_REJECTION_CODES.has(String(sqlstate)))
        throw error('UNCERTAIN_REJECTION', 'Ambiguous errors cannot release a Staff attempt.');
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (!row || row.attemptId !== attemptId || row.state !== 'sending')
          throw error('ATTEMPT_MISMATCH', 'Only a sent frozen attempt can be definitely rejected.');
        row.state = 'rejected'; row.rejectionSqlstate = String(sqlstate);
        return { write: row, result: { state: row.state, attemptId } };
      });
    }
    // A frozen row has not passed markSending, so no POST may have started.
    // This transaction races safely with markSending in another same-origin tab:
    // exactly one transition wins, and the loser cannot write.
    async function abandonFrozen(scope, authInput, attemptId, newEntryId) {
      if (!nonempty(newEntryId)) throw error('INVALID_ATTEMPT', 'A new entry ID is required.');
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (!row || row.attemptId !== attemptId || row.state !== 'frozen')
          throw error('ATTEMPT_NOT_FROZEN', 'Only a never-sent frozen attempt can be discarded.');
        const next = { key, scope: copy(scope), auth, entryId: newEntryId, state: 'new_entry',
          createdAt: now(), previousReceipt: row.previousReceipt || null };
        return { write: next, result: { state: next.state, entryId: newEntryId } };
      });
    }
    // Explicit New/Cancel after a VERIFIED result (or after a definite rejection)
    // atomically changes the entry generation. Old tabs cannot freeze their old draft.
    async function beginNew(scope, authInput, newEntryId) {
      if (!nonempty(newEntryId)) throw error('INVALID_ATTEMPT', 'A new entry ID is required.');
      const key = scopeKey(scope), auth = cleanAuth(authInput);
      return store.update(key, row => {
        guard(row, auth);
        if (row && !['verified', 'rejected'].includes(row.state))
          throw error('ATTEMPT_UNRESOLVED', 'An uncertain Staff attempt cannot be discarded or replaced.');
        const previousReceipt = row?.state === 'verified'
          ? { attemptId: row.attemptId, verifiedAt: row.verifiedAt, receipt: row.receipt }
          : row?.previousReceipt || null;
        const next = { key, scope: copy(scope), auth, entryId: newEntryId, state: 'new_entry',
          createdAt: now(), previousReceipt };
        return { write: next, result: { state: next.state, entryId: newEntryId } };
      });
    }
    return { read, claim, markSending, markUnknown, markVerified, markRejected, abandonFrozen, beginNew };
  }
  // Thin page API. Callers pass the canonical current Staff claims and their
  // already-frozen records; this layer never constructs a new event ID or POST.
  function createStaffPageJournal({ indexedDB, projectRef, store = null }) {
    if (!nonempty(projectRef)) throw error('INVALID_SCOPE', 'Supabase project reference is required.');
    const journal = createJournal(store || indexedDbStore(indexedDB));
    function parts(mode, context) {
      if (!context) throw error('INVALID_SCOPE', 'Current Staff context is required.');
      return {
        scope: { projectRef, venueId: context.venueId, staffId: context.staffId, nightId: context.nightId, mode },
        auth: { assignmentId: context.assignmentId, allowedBarIds: context.allowedBarIds }
      };
    }
    async function get(mode, context) {
      const { scope, auth } = parts(mode, context);
      return journal.read(scope, auth);
    }
    async function claim(mode, context, records, draft) {
      const { scope, auth } = parts(mode, context);
      const attemptId = context.attemptId || records?.[0]?.client_event_id;
      const entryId = context.entryId || attemptId;
      return journal.claim(scope, auth, { entryId, attemptId, records, draft });
    }
    async function markSending(mode, context, attemptId) {
      const { scope, auth } = parts(mode, context);
      return journal.markSending(scope, auth, attemptId);
    }
    async function markVerified(mode, context, attemptId, acknowledgment) {
      const { scope, auth } = parts(mode, context);
      return journal.markVerified(scope, auth, attemptId, acknowledgment);
    }
    async function markRejected(mode, context, attemptId, sqlstate) {
      const { scope, auth } = parts(mode, context);
      return journal.markRejected(scope, auth, attemptId, sqlstate);
    }
    async function release(mode, context, newEntryId) {
      const { scope, auth } = parts(mode, context);
      return journal.beginNew(scope, auth, newEntryId);
    }
    async function abandonFrozen(mode, context, attemptId, newEntryId) {
      const { scope, auth } = parts(mode, context);
      return journal.abandonFrozen(scope, auth, attemptId, newEntryId);
    }
    // readRows must be the existing authorized, scoped events SELECT. verifyRows
    // must be the movement's exact-row acknowledgment matcher. An empty or
    // filtered result is UNKNOWN, never proof that the POST did not commit.
    async function reconcile(mode, context, readRows, verifyRows) {
      if (typeof readRows !== 'function' || typeof verifyRows !== 'function')
        throw error('INVALID_RECONCILIATION', 'Read-only query and exact-row verifier are required.');
      const { scope, auth } = parts(mode, context);
      const row = await journal.read(scope, auth);
      if (!row || !row.records?.length) return { state: row?.state || 'absent', acknowledged: 0 };
      if (row.state === 'verified') return { state: 'verified', acknowledged: row.records.length, receipt: row.receipt };
      if (!['sending', 'unknown'].includes(row.state)) return { state: row.state, acknowledged: 0 };
      const collected = [];
      for (let offset = 0; offset < row.records.length; offset += 100) {
        const ids = row.records.slice(offset, offset + 100).map(record => record.client_event_id);
        const page = await readRows({ venueId: scope.venueId, nightId: scope.nightId, ids, mode });
        if (!Array.isArray(page)) throw error('STATUS_UNAVAILABLE', 'Exact-ID status could not be read.');
        collected.push(...page);
      }
      const current = await journal.read(scope, auth);
      if (!current || current.attemptId !== row.attemptId)
        throw error('ATTEMPT_CHANGED', 'Staff attempt changed during status read.');
      const ack = verifyRows(row, collected);
      if (ack?.acknowledged === row.records.length && ack.missing === 0 && ack.mismatched === 0 && ack.unexpected === 0) {
        await journal.markVerified(scope, auth, row.attemptId, ack);
        return { state: 'verified', acknowledged: row.records.length, receipt: ack };
      }
      await journal.markUnknown(scope, auth, row.attemptId);
      return { state: 'unknown', acknowledged: Number(ack?.acknowledged) || 0 };
    }
    return { get, claim, markSending, markVerified, markRejected, abandonFrozen, release, reconcile };
  }
  return { indexedDbStore, createJournal, createStaffPageJournal, scopeKey, DEFINITE_REJECTION_CODES };
});
